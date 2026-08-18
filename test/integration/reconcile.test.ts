import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { ARTIFACT_ABSENT_DIGEST, artifactDigestOf } from '../../src/lib/digest.js';
import { reviewFilePath as productionReviewFilePath } from '../../src/lib/local-state.js';

// このファイルは名前が近い2つの別コマンドをまとめて検証する:
//   1. `gate reconcile <issue_id> <target_sha>`（src/commands/gate.ts の reconcile 関数）
//      承認済みgate-reportのapproved_artifactsが新しいcommit時点で変化していれば無効化し、
//      下流ゲートも連鎖的に無効化する。
//   2. `reconcile`（トップレベル、src/commands/reconcile.ts）
//      期限切れwriter leaseを一括回収する（安全なら回収、未push/未commitが残るなら人間判断へ昇格）。
// gate.ts の reconcile と reconcile.ts の run はどちらも「reconcile」という語を共有するが無関係な
// 別機能である。

// Issue #309: 実在成果物の内容digestは artifactDigestOf（ドメイン分離済み）と同一アルゴリズムで
// 自前計算する。gate.tsのartifactDigestAtShaが比較する期待値と一致させるため。
function sha256(content: Buffer | string): string {
  return artifactDigestOf(content);
}

function hideLooseBlob(repoDir: string, targetSha: string, artifactPath: string): void {
  const blobSha = execFileSync('git', ['rev-parse', `${targetSha}:${artifactPath}`], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
  const objectPath = path.resolve(repoDir, commonDir, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
  assert.equal(fs.existsSync(objectPath), true);
  fs.renameSync(objectPath, `${objectPath}.unreadable`);
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

  if (backend === 'github') {
    for (const gateId of ['spec', 'design']) {
      // Issue #399: GitHubモードの `gate publish` はroot直下 `issues/` を汚染しないよう
      // os.tmpdir() 配下（`reviewFilePath(..., 'github')`）へ書くよう変更済み。コピー元は
      // その実際の書込み先を参照する。コピー先（worktree内）は `readReconcileReport` が
      // git-showで読む相対パス規約（root相対、`reviewPath` ヘルパー）に合わせたままにする。
      const source = productionReviewFilePath(repo.dir, '1', gateId, 'github');
      const destination = reviewPath(worktreePath, gateId);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    const checkpointReports = runCli(['checkpoint', 'test: trusted recorder reports'], { cwd: worktreePath, env });
    assert.equal(checkpointReports.status, 0, checkpointReports.stderr);
  }

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

test('gate reconcile: 存在しないtarget SHAを不在継続として扱わない', (t) => {
  const { repo } = setupApprovedSpecAndDesignGates();
  t.after(() => repo.cleanup());
  const designReportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'design.yaml');
  const designReport = parse(fs.readFileSync(designReportPath, 'utf8')) as GateReport;
  designReport.gate.approved_artifacts.push({ path: 'PLAN.md', digest: ARTIFACT_ABSENT_DIGEST });
  fs.writeFileSync(designReportPath, stringify(designReport));
  const before = fs.readFileSync(designReportPath, 'utf8');

  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', 'f'.repeat(40)], { cwd: repo.dir });

  assert.notEqual(reconcile.status, 0);
  assert.match(reconcile.stderr, /target_sha が有効なcommitとして解決できません/);
  assert.equal(fs.readFileSync(designReportPath, 'utf8'), before);
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

test('gate reconcile: 承認時の不在標識は不在継続なら一致し、成果物出現なら無効化する', (t) => {
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates();
  t.after(() => repo.cleanup());
  const designReportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'design.yaml');
  const designReport = parse(fs.readFileSync(designReportPath, 'utf8')) as GateReport;
  designReport.gate.approved_artifacts.push({ path: 'PLAN.md', digest: ARTIFACT_ABSENT_DIGEST });
  fs.writeFileSync(designReportPath, stringify(designReport));

  const unchanged = runCli(['gate', 'reconcile', 'ISSUE-1', sha1], { cwd: repo.dir });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /reissued: spec, design/);

  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN\n\nnewly present\n');
  const checkpoint = runCli(['checkpoint', 'test: materialize absent artifact'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const appeared = runCli(['gate', 'reconcile', 'ISSUE-1', checkpoint.stdout.trim()], { cwd: repo.dir });
  assert.equal(appeared.status, 0, appeared.stderr);
  assert.match(appeared.stdout, /invalidated: design/);
});

test('gate reconcile: target treeに存在する成果物のblob読み取り失敗を不在継続として扱わない', (t) => {
  const { repo, worktreePath } = setupApprovedSpecAndDesignGates();
  t.after(() => repo.cleanup());
  const designReportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'design.yaml');
  const designReport = parse(fs.readFileSync(designReportPath, 'utf8')) as GateReport;
  designReport.gate.approved_artifacts.push({ path: 'PLAN.md', digest: ARTIFACT_ABSENT_DIGEST });
  fs.writeFileSync(designReportPath, stringify(designReport));

  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN\n\npresent but unreadable\n');
  const checkpoint = runCli(['checkpoint', 'test: add unreadable artifact'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const targetSha = checkpoint.stdout.trim();
  hideLooseBlob(repo.dir, targetSha, 'PLAN.md');

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', targetSha], { cwd: repo.dir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target SHAの必須成果物を読めません: PLAN\.md/);
});

function makeGhStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-reconcile-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

interface CheckRunRecord {
  id: number;
  name: string;
  head_sha: string;
  conclusion: string;
  check_suite: { id: number };
  output?: { text?: string };
}

function checkpointUnrelatedChange(worktreePath: string, env: NodeJS.ProcessEnv, marker: string): string {
  fs.writeFileSync(path.join(worktreePath, 'reconcile-marker.txt'), `${marker}\n`, 'utf8');
  const checkpoint = runCli(['checkpoint', `test: ${marker}`], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  return checkpoint.stdout.trim();
}

function seedPullCommits(stub: ReturnType<typeof createGhStub>, commits: string[], repoDir: string): void {
  const state = stub.readState();
  state.pullCommits = commits.map((sha) => ({ sha }));
  state.commitPulls = [{ number: 1 }];
  stub.writeState(state);
  const targetSha = commits.at(-1)!;
  execFileSync('git', ['update-ref', `refs/agent-skill-chain/targets/${targetSha}`, targetSha], {
    cwd: repoDir,
    stdio: 'pipe',
  });
}

function checkRuns(stub: ReturnType<typeof createGhStub>): CheckRunRecord[] {
  return (stub.readState().checkRuns ?? []) as CheckRunRecord[];
}

function reviewPath(repoDir: string, gateId: string): string {
  return path.join(repoDir, 'issues', '1', '.agent-skill-chain', 'reviews', `${gateId}.yaml`);
}

/** Issue #399: GitHubモードで `gate publish`/`gate reconcile` が実際にローカル併記する場所
 * （os.tmpdir() 配下）。`repo.dir` 自体（メイン作業ツリー）を基点に読み書きする箇所でのみ使う
 * （worktree内へ複製したコピーは `readReconcileReport` のgit-show相対パス規約に合わせるため
 * `reviewPath` のまま変えない）。 */
function githubReviewPath(repoDir: string, gateId: string): string {
  return productionReviewFilePath(repoDir, '1', gateId, 'github');
}

function addForgedSpecCheck(
  stub: ReturnType<typeof createGhStub>,
  approvedSha: string,
  workflowPath: string,
  event: string,
): void {
  const state = stub.readState();
  const trustedSpec = (state.checkRuns as CheckRunRecord[]).find((run) => run.name.endsWith('/spec-gate'))!;
  const forgedReport = JSON.parse(trustedSpec.output!.text!) as GateReport;
  forgedReport.gate.approved_artifacts[0].digest = `sha256:${'f'.repeat(64)}`;
  state.checkRuns!.push({
    ...trustedSpec,
    id: 9000,
    check_suite: { id: 9000 },
    output: { text: JSON.stringify(forgedReport) },
  });
  state.actionRuns!.push({ id: 9000, check_suite_id: 9000, head_sha: approvedSha, path: workflowPath, event });
  stub.writeState(state);
}

test('gate reconcile (github backend): 過去のtrusted baselineから成果物不変の新commitへ成功を再発行する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'approved artifacts unchanged');
  seedPullCommits(stub, [sha1, sha2], repo.dir);
  fs.rmSync(path.dirname(githubReviewPath(repo.dir, 'spec')), { recursive: true, force: true });
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  // Then: 以前は「local バックエンドのみ対応」で必ず失敗していたが、githubモードでも成功し、
  // 両ゲートについてsha2へのsuccess Check Runが追加発行されること。
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
    [sha2, sha2],
  );
  assert.ok(
    !(stub.readState().apiCalls ?? []).some((call) => call.path.includes(`/commits/${sha2}/pulls`)),
    'pr_number指定時はtarget_shaからPRを再検索しないこと',
  );
});

test('gate reconcile (github backend): 成果物とlocal review digestを同時改ざんしてもtrusted baselineとの差で無効化する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: spec/design gateが共に承認済みの状態から、SPEC.md（spec gateのapproved_artifacts）を
  // 変更して新しいcommitを作る。
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: 変更後のサンプル\n', 'utf8');
  const specReportPath = reviewPath(worktreePath, 'spec');
  const tamperedReport = parse(fs.readFileSync(specReportPath, 'utf8')) as GateReport;
  tamperedReport.gate.approved_artifacts[0].digest = sha256(fs.readFileSync(path.join(worktreePath, 'SPEC.md')));
  fs.writeFileSync(specReportPath, stringify(tamperedReport), 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC変更'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha2 = checkpoint.stdout.trim();
  seedPullCommits(stub, [sha1, sha2], repo.dir);

  // When: 変更後のsha2を対象に gate reconcile を呼ぶ。
  const reconcile = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

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

test('gate reconcile (github backend): success baseline不在時はCheck Runもlocal reportも更新しない', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'no approved baseline');
  seedPullCommits(stub, [sha1, sha2], repo.dir);
  const state = stub.readState();
  state.checkRuns = [];
  state.actionRuns = [];
  stub.writeState(state);
  const before = fs.readFileSync(githubReviewPath(repo.dir, 'spec'), 'utf8');

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reissued: \(none\)/);
  assert.match(result.stdout, /invalidated: \(none\)/);
  assert.equal(checkRuns(stub).length, 0);
  assert.equal(fs.readFileSync(githubReviewPath(repo.dir, 'spec'), 'utf8'), before);
});

test('gate reconcile (github backend): target ref不在時はbase側reportへfallbackせず照合をskipする', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'missing target ref');
  const state = stub.readState();
  state.pullCommits = [sha1, sha2].map((sha) => ({ sha }));
  state.commitPulls = [{ number: 1 }];
  stub.writeState(state);
  const before = fs.readFileSync(githubReviewPath(repo.dir, 'spec'), 'utf8');
  const beforeCount = checkRuns(stub).length;

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reissued: \(none\)/);
  assert.match(result.stdout, /invalidated: \(none\)/);
  assert.equal(checkRuns(stub).length, beforeCount);
  assert.equal(fs.readFileSync(githubReviewPath(repo.dir, 'spec'), 'utf8'), before);
});

test('gate reconcile (github backend): Check Run API失敗はbaseline不在扱いにせずコマンドを失敗させる', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'api failure');
  seedPullCommits(stub, [sha1, sha2], repo.dir);
  const state = stub.readState();
  state.failApiPaths = ['/check-runs?'];
  stub.writeState(state);

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Check Run履歴を取得できません/);
  assert.equal(checkRuns(stub).length, 2, 'API失敗後に新しいCheck Runを発行しないこと');
});

test('gate reconcile (github backend): untrusted workflow pathの最新候補を棄却しtrusted次点候補を採用する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  addForgedSpecCheck(stub, sha1, '.github/workflows/evil.yml', 'push');
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'untrusted path');
  seedPullCommits(stub, [sha1, sha2], repo.dir);

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reissued: spec, design/);
  assert.equal(checkRuns(stub).filter((run) => run.head_sha === sha2 && run.name.endsWith('/spec-gate'))[0].conclusion, 'success');
});

test('gate reconcile (github backend): trusted pathでも旧push eventの最新候補は棄却する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  addForgedSpecCheck(stub, sha1, '.github/workflows/agent-skill-chain-reconcile.yml', 'push');
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'untrusted event');
  seedPullCommits(stub, [sha1, sha2], repo.dir);

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reissued: spec, design/);
  assert.equal(checkRuns(stub).filter((run) => run.head_sha === sha2 && run.name.endsWith('/spec-gate'))[0].conclusion, 'success');
});

test('gate reconcile (github backend): pr_number省略時はtarget_shaからPRを解決する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'fallback pr lookup');
  seedPullCommits(stub, [sha1, sha2], repo.dir);

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.ok((stub.readState().apiCalls ?? []).some((call) => call.path.includes(`/commits/${sha2}/pulls`)));
});

test('gate reconcile (github backend): 下流baseline不在をskipしてもdownstream invalidationを次ゲートへ伝播する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  approveGate(repo, worktreePath, 'implementation', 'DESIGN.md', env);
  // setupApprovedSpecAndDesignGatesはbackend:'github'の場合、返り値のsha1コミット後に
  // 「trusted recorder reports」コミットを追加でpushしている（spec/design報告ファイルの
  // worktreeへの複製）。上記approveGateはこの追加コミット（sha1の子）を対象にimplementation-gate
  // Check Runを発行するため、sha1だけをPRコミット一覧へ渡すとそのCheck Runが一覧に含まれず
  // 見つからない。spec/design-gateのCheck Runはsha1自身に対して発行済みのため、sha1と
  // このimplementation-gate発行対象コミットの両方をPRコミット一覧へ含める必要がある。
  const sha1WithImplementation = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
  }).trim();
  const implementationReport = reviewPath(worktreePath, 'implementation');
  fs.mkdirSync(path.dirname(implementationReport), { recursive: true });
  // Issue #399: コピー元は `gate publish`（GitHubモード）の実際の書込み先（os.tmpdir() 配下）。
  fs.copyFileSync(productionReviewFilePath(repo.dir, '1', 'implementation', 'github'), implementationReport);
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const state = stub.readState();
  const designRun = (state.checkRuns as CheckRunRecord[]).find((run) => run.name.endsWith('/design-gate'))!;
  state.checkRuns = (state.checkRuns as CheckRunRecord[]).filter((run) => run.id !== designRun.id);
  state.actionRuns = state.actionRuns!.filter(
    (run) => (run as { check_suite_id?: number }).check_suite_id !== designRun.check_suite.id,
  );
  stub.writeState(state);
  const designBefore = fs.readFileSync(githubReviewPath(repo.dir, 'design'), 'utf8');
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: downstream invalidation\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'test: downstream invalidation'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha2 = checkpoint.stdout.trim();
  seedPullCommits(stub, [sha1, sha1WithImplementation, sha2], repo.dir);
  const beforeCount = checkRuns(stub).length;

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /invalidated: spec, implementation/);
  assert.equal(fs.readFileSync(githubReviewPath(repo.dir, 'design'), 'utf8'), designBefore);
  const published = checkRuns(stub).slice(beforeCount);
  assert.deepEqual(published.map((run) => run.name), [
    'agent-skill-chain/spec-gate',
    'agent-skill-chain/implementation-gate',
  ]);
  assert.deepEqual(published.map((run) => run.conclusion), ['action_required', 'action_required']);
});

test('gate reconcile (github backend): success再発行はlocal改ざん値でなくtrusted baselineを埋め込み二段階攻撃を防ぐ', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const futureContent = '# SPEC\n\nAC-1: future unreviewed content\n';
  const futureDigest = sha256(futureContent);
  const specReportPath = reviewPath(worktreePath, 'spec');
  const localReport = parse(fs.readFileSync(specReportPath, 'utf8')) as GateReport;
  const trustedDigest = localReport.gate.approved_artifacts[0].digest;
  localReport.gate.approved_artifacts[0].digest = futureDigest;
  fs.writeFileSync(specReportPath, stringify(localReport), 'utf8');
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'first poisoning push');
  seedPullCommits(stub, [sha1, sha2], repo.dir);
  let state = stub.readState();
  state.publishedCheckWorkflowPath = '.github/workflows/agent-skill-chain-reconcile.yml';
  state.publishedCheckWorkflowEvent = 'pull_request_target';
  stub.writeState(state);

  const first = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });
  assert.equal(first.status, 0, first.stderr);
  const firstRepublish = checkRuns(stub).filter((run) => run.head_sha === sha2 && run.name.endsWith('/spec-gate'))[0];
  const republishedReport = JSON.parse(firstRepublish.output!.text!) as GateReport;
  assert.equal(republishedReport.gate.approved_artifacts[0].digest, trustedDigest);
  assert.notEqual(republishedReport.gate.approved_artifacts[0].digest, futureDigest);

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), futureContent, 'utf8');
  const checkpoint = runCli(['checkpoint', 'test: second poisoning push'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const sha3 = checkpoint.stdout.trim();
  seedPullCommits(stub, [sha1, sha2, sha3], repo.dir);
  const second = runCli(['gate', 'reconcile', 'ISSUE-1', sha3, '1'], { cwd: repo.dir, env });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /invalidated: spec/);
  assert.equal(checkRuns(stub).filter((run) => run.head_sha === sha3 && run.name.endsWith('/spec-gate'))[0].conclusion, 'action_required');
});

test('gate reconcile (github backend): gate workflowのpull_request_review発行は正規baselineとして採用する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const { repo, worktreePath, sha1 } = setupApprovedSpecAndDesignGates({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const state = stub.readState();
  const specRun = (state.checkRuns as CheckRunRecord[]).find((run) => run.name.endsWith('/spec-gate'))!;
  const specAction = state.actionRuns!.find(
    (run) => (run as { check_suite_id?: number }).check_suite_id === specRun.check_suite.id,
  ) as { event: string };
  specAction.event = 'pull_request_review';
  stub.writeState(state);
  const sha2 = checkpointUnrelatedChange(worktreePath, env, 'review event baseline');
  seedPullCommits(stub, [sha1, sha2], repo.dir);

  const result = runCli(['gate', 'reconcile', 'ISSUE-1', sha2, '1'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reissued: spec, design/);
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
