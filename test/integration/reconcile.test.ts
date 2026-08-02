import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// このファイルは名前が近い2つの別コマンドをまとめて検証する:
//   1. `gate reconcile <issue_id> <target_sha>`（src/commands/gate.ts の reconcile 関数）
//      承認済みgate-reportのapproved_artifactsが新しいcommit時点で変化していれば無効化し、
//      下流ゲートも連鎖的に無効化する。
//   2. `reconcile`（トップレベル、src/commands/reconcile.ts）
//      期限切れwriter leaseを一括回収する（安全なら回収、未push/未commitが残るなら人間判断へ昇格）。
// gate.ts の reconcile と reconcile.ts の run はどちらも「reconcile」という語を共有するが無関係な
// 別機能である。

function sha256(content: Buffer | string): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

interface GateReport {
  gate: {
    conformance: string;
    falsification: string;
    final: string;
    approved_artifacts: { path: string; digest: string }[];
  };
}

interface WriterLease {
  writer_lease: { expires_at: string; segment: string };
}

/** issue start + SPEC.md/DESIGN.mdをcommit・push（checkpoint）した状態を作る共通準備。
 * checkpointは `git push -u origin <branch>` でupstream追跡を設定するため、以後の
 * `git show <sha>:<path>`（gate reconcileがrepo.dir側から実行する）やupstream依存の判定でも
 * 一貫した状態になる。backend: 'github' の場合、envにgh-stubのPATH注入環境を渡すこと
 * （gate publishがCheck Run発行のためgh apiを呼ぶため）。 */
function setupApprovedSpecAndDesignGates(opts: { backend?: 'local' | 'github'; env?: NodeJS.ProcessEnv } = {}) {
  const { backend = 'local', env = process.env } = opts;
  const repo = createTmpRepo({ backend });
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n', 'utf8');
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN\n\nサンプル設計\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC/DESIGN追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha1 = checkpoint.stdout.trim();

  approveGate(repo, worktreePath, 'spec', 'SPEC.md', env);
  approveGate(repo, worktreePath, 'design', 'DESIGN.md', env);

  return { repo, worktreePath, sha1 };
}

function approveGate(
  repo: ReturnType<typeof createTmpRepo>,
  worktreePath: string,
  gateId: string,
  artifactRelPath: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', gateId], { cwd: repo.dir, env });
  assert.equal(acquire.status, 0, acquire.stderr);
  assert.doesNotMatch(acquire.stdout + acquire.stderr, /token:/);

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', gateId, 'standard'], { cwd: worktreePath, env });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const reportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  const report = parse(fs.readFileSync(reportPath, 'utf8')) as GateReport;
  const artifactContent = fs.readFileSync(path.join(worktreePath, artifactRelPath));
  report.gate.approved_artifacts.push({ path: artifactRelPath, digest: sha256(artifactContent) });
  report.gate.conformance = 'pass';
  report.gate.falsification = 'pass';
  report.gate.final = 'approved';
  fs.writeFileSync(reportPath, stringify(report), 'utf8');

  const gatePublish = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir, env });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);

  const release = runCli(['lease', 'release', 'ISSUE-1'], { cwd: repo.dir, env });
  assert.equal(release.status, 0, release.stderr);
}

test('gate reconcile: 成果物が変化していないcommitへは両ゲートともreissuedされる', async (t) => {
  const { repo, sha1 } = setupApprovedSpecAndDesignGates();
  t.after(() => repo.cleanup());

  // Given: spec/design gateが共に承認済み（target_sha=sha1時点のSPEC.md/DESIGN.mdで承認）。
  // When: 承認時と同じsha1（＝成果物が変化していないcommit）を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha1], { cwd: repo.dir });

  // Then: 両ゲートとも無効化されずreissuedされること。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reissued: spec, design/);
  assert.match(reconcile.stdout, /invalidated: \(none\)/);
});

test('gate reconcile: spec成果物の変更commitを渡すとspec/design双方がinvalidatedされる', async (t) => {
  const { repo, worktreePath } = setupApprovedSpecAndDesignGates();
  t.after(() => repo.cleanup());

  // Given: spec/design gateが共に承認済みの状態から、SPEC.md（spec gateのapproved_artifacts）を
  // 変更して新しいcommitを作る。
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: 変更後のサンプル\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC変更'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha2 = checkpoint.stdout.trim();

  // When: 変更後のsha2を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha2], { cwd: repo.dir });

  // Then: spec自体がinvalidatedされ、design（下流）も連鎖的にinvalidatedされること
  // （designのDESIGN.md自体は変更していないが、SEGMENTS順でspec無効化以降は無条件でpendingに落とす仕様）。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reissued: \(none\)/);
  assert.match(reconcile.stdout, /invalidated: spec, design/);

  const specReport = parse(
    fs.readFileSync(path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'spec.yaml'), 'utf8'),
  ) as GateReport;
  assert.equal(specReport.gate.final, 'pending');
  const designReport = parse(
    fs.readFileSync(path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'design.yaml'), 'utf8'),
  ) as GateReport;
  assert.equal(designReport.gate.final, 'pending');
});

function makeGhStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-reconcile-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

interface CheckRunRecord {
  name: string;
  head_sha: string;
  conclusion: string;
}

test('gate reconcile (github backend): 成果物が変化していないcommitへは両ゲートとも成功Check Runが再発行される', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: gate publish（spec/design承認）で既にCheck Runが2件発行済み。
  // When: 承認時と同じsha1（＝成果物が変化していないcommit）を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha1], { cwd: repo.dir, env });

  // Then: 以前は「local バックエンドのみ対応」で必ず失敗していたが、githubモードでも成功し、
  // 両ゲートについてsha1へのsuccess Check Runが追加発行されること。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reissued: spec, design/);
  assert.match(reconcile.stdout, /invalidated: \(none\)/);

  const checkRuns = (stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? [];
  assert.equal(checkRuns.length, 4, 'gate publish時2件 + reconcile時2件のCheck Runが記録されること');
  const reconcileRuns = checkRuns.slice(2);
  assert.deepEqual(
    reconcileRuns.map((r) => r.conclusion),
    ['success', 'success'],
  );
  assert.deepEqual(
    reconcileRuns.map((r) => r.head_sha),
    [sha1, sha1],
  );
});

test('gate reconcile (github backend): spec成果物の変更commitを渡すとspec/design双方でaction_required Check Runが発行される', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: spec/design gateが共に承認済みの状態から、SPEC.md（spec gateのapproved_artifacts）を
  // 変更して新しいcommitを作る。
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: 変更後のサンプル\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC変更'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha2 = checkpoint.stdout.trim();

  // When: 変更後のsha2を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha2], { cwd: repo.dir, env });

  // Then: spec/designともにinvalidatedされ、それぞれについてsha2へのaction_required Check Runが
  // 発行されること（成功のまま放置されず、新SHAでは要再レビューであることが可視化される）。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reissued: \(none\)/);
  assert.match(reconcile.stdout, /invalidated: spec, design/);

  const checkRuns = (stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? [];
  const reconcileRuns = checkRuns.slice(2);
  assert.deepEqual(
    reconcileRuns.map((r) => r.conclusion),
    ['action_required', 'action_required'],
  );
  assert.deepEqual(
    reconcileRuns.map((r) => r.head_sha),
    [sha2, sha2],
  );
});

/** issues/<n>/.agent-skill-chain/lease.yaml のパス（src/lib/local-state.ts の leaseFilePath と
 * 同じ配置規約を直接組み立てる。テストからsrc実装を参照しないため独自に構築する）。 */
function leaseFilePathFor(repoDir: string, issueNumber: string): string {
  return path.join(repoDir, 'issues', issueNumber, '.agent-skill-chain', 'lease.yaml');
}

function expireLease(repoDir: string, issueNumber: string): void {
  const leasePath = leaseFilePathFor(repoDir, issueNumber);
  const lease = parse(fs.readFileSync(leasePath, 'utf8')) as WriterLease;
  lease.writer_lease.expires_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  fs.writeFileSync(leasePath, stringify(lease), 'utf8');
}

// Issue #349 blocking finding（human-required-publish-clobbers-reconciled-gate）: reconcileの
// unchanged分岐（承認済みapproved_artifactsのdigestが新SHAでも不変な場合）は、修正前は
// conclusionを無条件で'success'に固定していた。永続化済みのgate-reportがまだ確定していない
// （final='human_required'）状態のまま対象ファイルが変化していないpushが来た場合、無条件'success'は
// 未確定gateをmergeブロックしない状態へ誤って昇格させてしまう。unchanged分岐でも
// report.gate.finalに整合したconclusion（human_required→action_required）が再発行されることを
// 検証する。
test('gate reconcile (github backend): 永続化済みgate-reportがhuman_requiredのまま無変更commitへreconcileしてもsuccessへ昇格しない', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: spec gateは承認済み（final=approved）だが、design gateは「レビュー未了・未確定」
  // （gate verify-evidenceが実際に返しうるfinal=human_required、conformance/falsificationとも
  // pending）のまま永続化されている、という想定を作る（reviews/<gate>.yamlを直接書き換える）。
  const designReportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'design.yaml');
  const designReport = parse(fs.readFileSync(designReportPath, 'utf8')) as GateReport;
  designReport.gate.conformance = 'pending';
  designReport.gate.falsification = 'pending';
  designReport.gate.final = 'human_required';
  fs.writeFileSync(designReportPath, stringify(designReport), 'utf8');

  // When: 承認時と同じsha1（＝成果物が変化していないcommit）を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha1], { cwd: repo.dir, env });

  // Then: 両ゲートともreissuedされる（成果物自体は変化していないため）が、Check Runの
  // conclusionはreport.gate.finalに整合する必要がある: spec（final=approved）は'success'、
  // design（final=human_required）は無条件'success'へ昇格せず'action_required'のまま維持される。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reissued: spec, design/);
  assert.match(reconcile.stdout, /invalidated: \(none\)/);

  const checkRuns = (stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? [];
  const reconcileRuns = checkRuns.slice(2);
  assert.deepEqual(
    reconcileRuns.map((r) => r.conclusion),
    ['success', 'action_required'],
  );
  assert.deepEqual(
    reconcileRuns.map((r) => r.head_sha),
    [sha1, sha1],
  );
});

test('reconcile (トップレベル): worktreeが無い期限切れleaseはreclaimedされ、lease.yamlが削除される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: issue startせず（＝対応するworktreeが存在しない）writer leaseだけを取得し、期限切れにする。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireLease(repo.dir, '1');

  // When: reconcile を実行する。
  const reconcile = runCli(['reconcile'], { cwd: repo.dir });

  // Then: worktreeが無い＝保護すべき未push状態も無いため安全に回収され、lease.yamlが削除される。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reclaimed: ISSUE-1:spec/);
  assert.match(reconcile.stdout, /escalated: \(none\)/);
  assert.ok(!fs.existsSync(leaseFilePathFor(repo.dir, '1')), 'reclaimed後はlease.yamlが削除されていること');
});

test('reconcile (トップレベル): worktreeに未commitの変更が残る期限切れleaseはescalatedされ回収されない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: issue startしてworktreeを作り、未commitの変更を残したまま期限切れleaseを作る。
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'DIRTY.md'), 'wip: 未commitの変更\n', 'utf8');

  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  expireLease(repo.dir, '1');

  // When: reconcile を実行する。
  const reconcile = runCli(['reconcile'], { cwd: repo.dir });

  // Then: 未commitの変更が残っているため回収されず human_required として escalated され、
  // lease.yaml はそのまま残ること。
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.match(reconcile.stdout, /reclaimed: \(none\)/);
  assert.match(reconcile.stdout, /escalated: ISSUE-1:spec/);
  assert.match(reconcile.stdout, /human_required/);
  assert.ok(fs.existsSync(leaseFilePathFor(repo.dir, '1')), 'escalated時はlease.yamlが残っていること');
});
