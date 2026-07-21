import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo, setWorkerAdapter, FIXED_TIMESTAMP, type CoordinationBackend } from '../helpers/tmp-repo.js';
import { runCli, binPath } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// #166 launch_worker（セグメント作業ワーカー起動）の adapter 層 + 起動ラッパー
// （.agent-skill-chain/scripts/worker-launch.sh）を実際の bash で駆動して検証する:
//   (a) claude 成功経路（WORKER_CMD stubがcheckpoint+report completedまで行う） -> exit 0・lease解放
//   (b) claude 起動失敗（非0終了） -> blocked報告・lease解放・exit≠0,≠3（silent passしない）
//   (c) claude 認証未設定 -> 同上のフェイルセーフ
//   (d) claude 完了を騙るケース（WORKER_CMDはexit 0だがreport未達） -> blocked扱い（I8直接検証）
//   (e) codex 未構成 -> lease取得前にexit 2、leaseは一切取得されない
//   (f) human (local/github) -> exit 3・lease解放しない・通知内容
//   (g) lease acquireのwip.limit事前チェック・issue内他segmentコンフリクト検査（AC-2/AC-8）
//
// モデル（ワーカー実行系）呼び出しは WORKER_CMD で stub 化し、実 API・実 gh へは一切アクセスしない。

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface WorkerReport {
  schema_version: string;
  issue_id: string;
  role: string;
  segment: string;
  status: 'completed' | 'blocked';
  target_sha: string;
  blocked_reason?: string;
  human_escalation_requested?: boolean;
}

/** 起動ラッパー（worker-launch.sh）を bash で実行し、終了コードをそのまま観測する。 */
function runWorkerLauncher(worktreePath: string, args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  const script = path.join(worktreePath, '.agent-skill-chain', 'scripts', 'worker-launch.sh');
  try {
    const stdout = execFileSync('bash', [script, ...args], { cwd: worktreePath, encoding: 'utf8', env });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/**
 * 消費者環境の node_modules/.bin/agent-skill-chain 相当を対象dirへ用意し、パッケージ CLI へ結線する。
 * launch_worker は cwd=対象Issueのworktree内で動く前提（DESIGN.md）のため、repo.dir だけでなく
 * worktreePath 側にもCLI解決シムが必要になる（worktreeはgit worktree add由来の独立した
 * 作業ディレクトリであり、node_modules/binは git 追跡外のためrepo.dir側の設置が伝播しない）。
 */
function installCliShim(dir: string): void {
  const binDir = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, 'agent-skill-chain');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(binPath)} "$@"\n`, { mode: 0o755 });
}

/** issue start を行い、CLIシムを repo.dir・worktree 双方に設置した状態を作る共通準備。 */
function setupWorkerIssue(opts: { backend?: CoordinationBackend; env?: NodeJS.ProcessEnv; issueId?: string } = {}) {
  const { backend = 'local', env = process.env, issueId = 'ISSUE-1' } = opts;
  const repo = createTmpRepo({ backend });
  installCliShim(repo.dir);

  const start = runCli(['issue', 'start', issueId, 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  installCliShim(worktreePath);

  return { repo, worktreePath };
}

/** ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN を必ず除去した env を作る。 */
function envWithout(keys: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of keys) delete env[k];
  return env;
}

// Issue #185: report status（worker report）は repoRoot()（共通/メイン作業ツリー）基点で書かれる
// ため、worktreePath ではなく repo.dir（メイン作業ツリー）からの相対パスで読む必要がある
// （ADR-0004。修正前はworktree内へ分裂して書かれていたバグの解消）。
function readWorkerReport(repoDir: string, segment: string): WorkerReport {
  const reportPath = path.join(repoDir, 'issues', '1', '.agent-skill-chain', 'reports', `${segment}.yaml`);
  return parse(fs.readFileSync(reportPath, 'utf8')) as WorkerReport;
}

// --- (a) claude launch_worker: 成功経路 --------------------------------------------------

test('claude launch_worker: WORKER_CMDが成果物commit+push+report completedまで行った場合、exit 0でlease解放・完了確認される', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: role_contractを標準入力で受け取り、成果物をcommit+pushし、その場で
  // report status completedを自ら発行するWORKER_CMD stub。
  const workerCmd = [
    'cat >/tmp/worker-received-contract.txt',
    'echo "worker output" > WORKER_OUTPUT.md',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: spec worker output")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA"`,
  ].join(' && ');

  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    WORKER_CMD: workerCmd,
  });

  // When: worker-launch.sh 経由で launch_worker を実行する。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: exit 0・成果物push済み・report completed・lease解放済み（再取得できることで検証）。
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(worktreePath, 'WORKER_OUTPUT.md')));
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'lease解放済みのため再取得できること: ' + reacquire.stderr);

  // role_contract全文（stdin経由）がworkerへ渡っていること（AC-3）。
  const receivedContract = fs.readFileSync('/tmp/worker-received-contract.txt', 'utf8');
  assert.match(receivedContract, /^role: spec_worker/);
  fs.rmSync('/tmp/worker-received-contract.txt', { force: true });
});

// --- (h) 既定WORKER_CMD（未指定時）: --allowed-toolsによる責務スコープallowlist ------------
//        ISSUE-183 AC-1: 既定起動が自branchへのgit push等を非対話で完走できる
//        ISSUE-183 AC-2: 既定がbypassPermissions/acceptEditsの安易な採用ではなく責務範囲へ限定

test('claude launch_worker: WORKER_CMD未指定時の既定起動はclaude CLIを--allowed-toolsで起動し、bypassPermissions/acceptEditsを含まない（ISSUE-183 AC-1/AC-2）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: PATH上に「claude」という名のstub実行系を用意する（既定起動系のcommand -v claude判定を
  // 満たすため）。stubは受け取った引数をファイルへ記録したうえで、成果物commit+push+report
  // completedまで行う（(a)のWORKER_CMD stubと同じ最小契約）。
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-claude-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const claudeStub = path.join(stubDir, 'claude');
  fs.writeFileSync(
    claudeStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      'echo "worker output" > WORKER_OUTPUT.md',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: default worker_cmd output")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD', 'WORKER_ALLOWED_TOOLS'], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    PATH: `${stubDir}:${process.env.PATH}`,
  });

  // When: WORKER_CMD未指定のまま worker-launch.sh 経由で launch_worker を実行する。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: 既定起動が完走し（AC-1）、実際にclaude stubへ渡された引数に--allowed-toolsが含まれ、
  // --permission-mode（acceptEdits等）・bypassPermissionsのいずれも含まれないこと（AC-2）。
  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8');
  assert.match(argv, /--allowed-tools/, '既定起動は--allowed-toolsを用いること');
  assert.doesNotMatch(argv, /--permission-mode/, '既定起動はacceptEdits等の--permission-modeを用いないこと');
  assert.doesNotMatch(argv, /bypassPermissions/, '既定起動はbypassPermissionsを用いないこと');
  assert.match(argv, /Bash\(git push:\*\)/, 'allowlistにワーカーの正規責務範囲であるgit pushが含まれること');
  assert.match(argv, /Bash\(git commit:\*\)/, 'allowlistにgit commitが含まれること');
  assert.match(argv, /Bash\(gh pr create:\*\)/, 'allowlistにDraft PR作成（gh pr create）が含まれること');
});

test('claude launch_worker: WORKER_ALLOWED_TOOLS envで既定allowlistを完全上書きできる（ISSUE-183）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-claude-stub-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const argvCapturePath = path.join(stubDir, 'argv.txt');
  const claudeStub = path.join(stubDir, 'claude');
  fs.writeFileSync(
    claudeStub,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${JSON.stringify(argvCapturePath)}`,
      'cat >/dev/null',
      `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: override allowlist")`,
      `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const env = envWithout(['WORKER_CMD'], {
    ANTHROPIC_API_KEY: 'dummy-key',
    PATH: `${stubDir}:${process.env.PATH}`,
    WORKER_ALLOWED_TOOLS: 'Read Edit',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);
  assert.equal(res.status, 0, res.stderr);
  const argv = fs.readFileSync(argvCapturePath, 'utf8').trim();
  assert.equal(argv.split('\n').pop(), 'Read Edit', 'WORKER_ALLOWED_TOOLSの値がそのまま--allowed-toolsへ渡ること');
});

// --- (b)/(c)/(d) claude launch_worker: 異常系はすべてblocked + lease解放 + exit非0非3 ------

test('claude launch_worker: WORKER_CMD起動失敗はblocked報告(human_escalation_requested=true)+lease解放+非0非3で返す（silent passしない）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key',
    WORKER_CMD: 'cat >/dev/null; exit 1',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, 'worker起動失敗はexit 0（完了）にならないこと');
  assert.notEqual(res.status, 3, 'worker起動失敗はexit 3（human deferred）にもならないこと');

  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);
  assert.ok(report.blocked_reason && report.blocked_reason.length > 0);

  // AC-2: lease放置防止 -> lease解放済みのため同issue・同segmentで即座に再取得できること。
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, 'worker起動失敗後もleaseが放置されず解放されていること: ' + reacquire.stderr);
});

test('claude launch_worker: 認証未設定（ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN無し）かつ実疎通確認も失敗する場合はblocked+lease解放+非0非3で返す（真の認証欠如、regressionなし）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Issue #185: 認証チェックがenv非空チェック→claude auth statusの実疎通フォールバックの2段化に
  // なったため、このテストは「真の認証欠如」（env無し・実疎通確認も失敗）を明示的に固定する
  // 必要がある。CLAUDE_AUTH_PROBE_CMD=false でプローブを常に失敗させ、実行機のclaude CLIの
  // 実際の認証状態に依存せずhermeticにする。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], { CLAUDE_AUTH_PROBE_CMD: 'false' });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 3);
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);
  assert.match(report.blocked_reason ?? '', /認証/);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
});

// Issue #185 AC-4: env認証情報（ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN）が無くても、実疎通確認
// （CLAUDE_AUTH_PROBE_CMDでモック）が成功すれば認証欠如として誤判定せず起動処理へ進むことを検証する。
test('claude launch_worker: env認証情報が無くてもCLAUDE_AUTH_PROBE_CMDの実疎通確認が成功すれば認証欠如と誤判定せず起動処理へ進む（AC-4）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  const workerCmd = [
    'cat >/dev/null',
    `SHA=$(node ${JSON.stringify(binPath)} checkpoint "wip: auth probe success")`,
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed "$SHA"`,
  ].join(' && ');

  // Given: env認証情報は無いが、実疎通確認（CLAUDE_AUTH_PROBE_CMD）はexit0（認証済み）を模す。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    WORKER_CMD: workerCmd,
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: 認証欠如のfail-safe（blocked）は発火せず、通常の完了経路になる。
  assert.equal(res.status, 0, res.stderr);
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'completed');
});

test('claude launch_worker (I8直接検証): WORKER_CMDがexit 0でも完了を報告しなければ「完了を騙る」ケースとしてblocked扱いにする（silent passしない）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: サブプロセス自体はexit 0で正常終了するが、report statusを一切呼ばない
  // （commit/reportをサボる・クラッシュ直前で終了コードだけ0を返す等を模す）。
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key',
    WORKER_CMD: 'cat >/dev/null; exit 0',
  });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  // Then: サブプロセスの終了コード0だけでは信頼せず、report-status直近レコード無し/不一致を
  // 検出してblockedへ倒す（silent passでexit 0にはしない）。
  assert.notEqual(res.status, 0, 'report未達のexit 0は「完了」として扱われないこと');
  assert.notEqual(res.status, 3);

  const reportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reports', 'spec.yaml');
  assert.ok(fs.existsSync(reportPath), 'launch_worker自身がblocked reportを書くこと');
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
  assert.equal(report.human_escalation_requested, true);

  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
});

test('claude launch_worker (I8直接検証): target_shaが不一致（workerが古いSHAを騙って報告）の場合もblocked扱いにする', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'claude');

  // Given: commit+pushはせず、でたらめなtarget_shaでcompletedを報告するWORKER_CMD stub。
  const workerCmd = [
    'cat >/dev/null',
    `node ${JSON.stringify(binPath)} report status "$ASC_ISSUE_ID" "$ASC_ROLE" "$ASC_SEGMENT" completed deadbeefdeadbeef`,
  ].join(' && ');

  const env = envWithout([], { ANTHROPIC_API_KEY: 'dummy-key', WORKER_CMD: workerCmd });

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], env);

  assert.notEqual(res.status, 0, 'target_sha不一致はexit 0にならないこと');
  assert.notEqual(res.status, 3);
  // report latestが返す直近レコードはworkerが騙って報告したcompletedのままだが、
  // launch_worker自身は不一致を検出した結果を新たなblocked reportとして上書きする。
  const report = readWorkerReport(repo.dir, 'spec');
  assert.equal(report.status, 'blocked');
});

// --- (e) codex launch_worker: 未構成fail-safe（lease取得前） ---------------------------

test('codex launch_worker: 未構成のためlease取得を一切試みずexit 2で即fail-safeを返す（WIP枠を消費しない）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'codex');

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], process.env);

  assert.notEqual(res.status, 0, 'codex未構成はexit 0にならないこと');
  assert.notEqual(res.status, 3);

  // lease取得を試みていないため、即座にacquireが成功すること（先着競合が一切生じていない）。
  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env: process.env });
  assert.equal(acquire.status, 0, 'codexはlease取得を試みないため、後続のacquireが競合しないこと: ' + acquire.stderr);

  // worker-reportも一切書かれていないこと（起動前のため報告対象が存在しない）。
  const reportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reports', 'spec.yaml');
  assert.ok(!fs.existsSync(reportPath), 'lease取得前のためworker-reportは書かれないこと');
});

// --- (f) human launch_worker: 通知＋非同期deferred --------------------------------------

test('human launch_worker (local): マーカーを生成しexit 3・leaseは解放しない（作業継続中）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'human');

  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'spec'], process.env);

  assert.equal(res.status, 3, `human deferredはexit 3であること。stderr=${res.stderr}`);

  const marker = path.join(worktreePath, 'issues', '1', '.agent-skill-chain', 'worker-spec.awaiting-human');
  assert.ok(fs.existsSync(marker), 'ローカルモードでawaiting-humanマーカーが生成されること');
  const body = fs.readFileSync(marker, 'utf8');
  for (const field of ['ISSUE-1', 'spec', 'spec_worker', 'lease renew', 'checkpoint', 'report status', 'lease release']) {
    assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `通知本文に「${field}」を含むこと`);
  }
  // spec segmentのみDraft PR作成手順が案内されること（AC-9: segment分岐は通知文言のみ）。
  assert.match(body, /pr create/);

  // leaseは保持継続（release_leaseを呼んでいない）ため、同issue・同segmentの再取得は競合で失敗する。
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: worktreePath, env: process.env });
  assert.equal(reacquire.status, 1, 'human deferred中はleaseが保持され続けること');
});

test('human launch_worker (local, design segment): Draft PR作成手順は案内されないこと（specのみの非対称性）', async (t) => {
  const { repo, worktreePath } = setupWorkerIssue();
  t.after(() => repo.cleanup());
  setWorkerAdapter(repo.dir, 'human');

  // design segmentを起動する前提として、design segmentのrole_contractが取得できる必要がある
  // （segment startはlease有効性のみ検査しSPEC.md等の内容は見ないため、worktree側の前提整備は不要）。
  const res = runWorkerLauncher(worktreePath, ['ISSUE-1', 'design'], process.env);
  assert.equal(res.status, 3, res.stderr);

  const marker = path.join(worktreePath, 'issues', '1', '.agent-skill-chain', 'worker-design.awaiting-human');
  const body = fs.readFileSync(marker, 'utf8');
  assert.doesNotMatch(body, /pr create/);
});

test('human launch_worker (github): gh issue commentで通知しexit 3・ラベル付与・leaseは解放しない', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-worker-human-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const { repo, worktreePath } = setupWorkerIssue({ backend: 'github', env, issueId: 'ISSUE-9' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });
  setWorkerAdapter(repo.dir, 'human');

  const res = runWorkerLauncher(worktreePath, ['ISSUE-9', 'spec'], env);

  assert.equal(res.status, 3, `human deferredはexit 3であること。stderr=${res.stderr}`);
  // コメントは lease acquire 自体が投稿する lease コメントに加え、human通知コメントの計2件になる。
  const comments = stub.readState().comments['9'] ?? [];
  const notification = comments.find((c) => c.body.includes('awaiting-human'));
  assert.ok(notification, 'gh issue commentでawaiting-human通知が発行されること');
  assert.match(notification!.body, /spec_worker/);

  const labels = stub.readState().issueLabels['9'] ?? [];
  assert.ok(labels.includes('worker:spec:awaiting-human'), '通知ラベルが付与されること');

  // leaseは保持継続 -> WIP判定用ラベル(writer-lease:active)は付いたまま。
  assert.ok((stub.readState().issueLabels['9'] ?? []).includes('writer-lease:active'), 'lease保持中はWIP判定ラベルも付いたままであること');
});

// --- (g) lease acquire: wip.limit事前チェック・issue内他segmentコンフリクト検査（AC-2/AC-8） ---

test('lease acquire (local backend): wip.limit（既定3）に達した4件目の取得は拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquire1 = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  const acquire2 = runCli(['lease', 'acquire', 'ISSUE-2', 'spec'], { cwd: repo.dir });
  const acquire3 = runCli(['lease', 'acquire', 'ISSUE-3', 'spec'], { cwd: repo.dir });
  assert.equal(acquire1.status, 0, acquire1.stderr);
  assert.equal(acquire2.status, 0, acquire2.stderr);
  assert.equal(acquire3.status, 0, acquire3.stderr);

  const acquire4 = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir });
  assert.equal(acquire4.status, 1, 'wip.limit=3に達した状態での4件目は拒否されること');
  assert.match(acquire4.stderr, /WIP上限/);

  // 1件解放すればWIP枠が空き、4件目が取得できること。
  const token1 = /token:\s*(\S+)/.exec(acquire1.stdout)![1];
  const release1 = runCli(['lease', 'release', 'ISSUE-1', token1], { cwd: repo.dir });
  assert.equal(release1.status, 0, release1.stderr);

  const acquire4Retry = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir });
  assert.equal(acquire4Retry.status, 0, 'release後はWIP枠が空きacquireできること: ' + acquire4Retry.stderr);
});

test('lease acquire (github backend): writer-lease:activeラベル数によるwip.limit事前チェックが機能する', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-wip-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  for (const n of [1, 2, 3]) {
    const acquire = runCli(['lease', 'acquire', `ISSUE-${n}`, 'spec'], { cwd: repo.dir, env });
    assert.equal(acquire.status, 0, acquire.stderr);
  }
  assert.equal(Object.keys(stub.readState().issueLabels).length, 3);

  const acquire4 = runCli(['lease', 'acquire', 'ISSUE-4', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquire4.status, 1, 'wip.limit=3に達した状態での4件目は拒否されること');
  assert.match(acquire4.stderr, /WIP上限/);
});

test('lease acquire (github backend): 同issue内の他segmentの有効leaseはコンフリクトとして拒否される（AC-2）', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-cross-segment-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  const acquireSpec = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquireSpec.status, 0, acquireSpec.stderr);

  // Then: 同issueの別segment（design）は、activeLeaseForだけでは検出できない
  // （segment不一致のため）はずが、issue横断コンフリクト検査により拒否される。
  const acquireDesign = runCli(['lease', 'acquire', 'ISSUE-9', 'design'], { cwd: repo.dir, env });
  assert.equal(acquireDesign.status, 1, '1 Issueにつき同時1つのwriter leaseのみ許可されるため拒否されること');
  assert.match(acquireDesign.stderr, /他segment/);

  // spec leaseを解放すればdesignが取得できること。
  const token = /token:\s*(\S+)/.exec(acquireSpec.stdout)![1];
  const release = runCli(['lease', 'release', 'ISSUE-9', token], { cwd: repo.dir, env });
  assert.equal(release.status, 0, release.stderr);
  const acquireDesignRetry = runCli(['lease', 'acquire', 'ISSUE-9', 'design'], { cwd: repo.dir, env });
  assert.equal(acquireDesignRetry.status, 0, acquireDesignRetry.stderr);
});

test('lease acquire (local backend): 同issue内の他segmentコンフリクトは既存の1ファイル/issue構造により既に拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquireSpec = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquireSpec.status, 0, acquireSpec.stderr);

  const acquireDesign = runCli(['lease', 'acquire', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(acquireDesign.status, 1, '1 Issueにつき同時1つのwriter leaseのみ許可されるため拒否されること');
});
