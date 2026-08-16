import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo, setAdapter, FIXED_TIMESTAMP, type CoordinationBackend } from '../helpers/tmp-repo.js';
import { runCli, binPath } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// #164-② gate判定ステップの adapter 層（launch_gate_reviewer）+ 起動ラッパー
// （.agent-skill-chain/scripts/gate-launch-reviewer.sh）を実際の bash で駆動して検証する:
//   T2 claude（完了経路・認証未設定フェイルセーフ）、T3 human（非同期 deferred）、
//   T4 codex（未構成 fail-safe）、T5 ラッパーの終了コード分岐（0/3/error）。
// モデル（レビュア）呼び出しは GATE_REVIEWER_CMD または fake CLI で stub 化し、実 API・実 gh へは
// 一切アクセスしない。

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 起動ラッパー（gate-launch-reviewer.sh）を bash で実行し、終了コードをそのまま観測する。 */
function runLauncher(
  repoDir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ScriptResult {
  const script = path.join(repoDir, '.agent-skill-chain', 'scripts', 'gate-launch-reviewer.sh');
  try {
    const stdout = execFileSync('bash', [script, ...args], { cwd: repoDir, encoding: 'utf8', env });
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

/** 消費者環境の node_modules/.bin/agent-skill-chain 相当を tmp repo へ用意し、パッケージ CLI へ結線する。 */
function installCliShim(repoDir: string): void {
  const binDir = path.join(repoDir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, 'agent-skill-chain');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(binPath)} "$@"\n`, { mode: 0o755 });
}

/** issue start → SPEC.md → checkpoint → gate review を行い、pending gate-report を得る共通準備。 */
function setupGateReview(opts: { backend?: CoordinationBackend; env?: NodeJS.ProcessEnv } = {}) {
  const { backend = 'local', env = process.env } = opts;
  const repo = createTmpRepo({ backend });
  installCliShim(repo.dir);

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n', 'utf8');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const targetSha = checkpoint.stdout.trim();

  const review = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath, env });
  assert.equal(review.status, 0, review.stderr);
  const reportPath = /gate_report_path:\s*(\S+)/.exec(review.stdout)![1];

  return { repo, worktreePath, reportPath, targetSha };
}

function readFinal(reportPath: string): string {
  return (parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string; conformance: string } }).gate.final;
}

const REVIEW_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_AUTH_PROBE_CMD',
  'CLAUDE_EXECUTABLE',
  'CLAUDE_CORE_REVIEW_MODEL',
  'CLAUDE_CORE_REVIEW_MODEL_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD',
  'CODEX_AUTH_PROBE_CMD',
  'CODEX_EXECUTABLE',
  'CODEX_REVIEWER_CMD',
  'CODEX_REVIEWER_MODEL',
  'CODEX_REVIEWER_REASONING_EFFORT',
  'CODEX_CORE_REVIEWER_ATTESTED',
  'GATE_REVIEWER_CMD',
  'GATE_REVIEWER_RETRIES',
  'GATE_REVIEWER_RETRY_INTERVAL_SEC',
  'ASC_REVIEWER_SANITIZED_ROOT',
  'ASC_BASE_REF',
  'ASC_REVIEW_SUBJECT',
  'ASC_REVIEW_ADAPTER_REQUESTED',
] as const;

/** 呼出元のレビュー設定を除去し、テストが明示した値だけを加えた hermetic env を作る。 */
function envWithout(keys: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of new Set([...REVIEW_ENV_KEYS, ...keys])) delete env[k];
  return { ...env, ...extra };
}

/** Claude CLI互換のstubを作り、受け取った引数をログへ保存してverdictを返す。 */
function createClaudeStub(dir: string, verdict: string): { executable: string; argsLog: string } {
  const executable = path.join(dir, 'claude-core-stub');
  const argsLog = path.join(dir, 'claude-args.log');
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${JSON.stringify(argsLog)}\ncat >/dev/null\nprintf '%s' ${JSON.stringify(verdict)}\n`,
    { mode: 0o755 },
  );
  return { executable, argsLog };
}

/**
 * codex exec互換のstubを作る。対象CLIの仕様と乖離が疑われる場合は実機で引数受理を再検証する。
 * 未対応の--ask-for-approvalを拒否し、approval_policy="never"のconfig overrideだけを受理する。
 */
function createCodexStub(dir: string, verdict: string): { executable: string; argsLog: string } {
  const executable = path.join(dir, 'codex-exec-stub');
  const argsLog = path.join(dir, 'codex-args.log');
  fs.writeFileSync(
    executable,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}`,
      'approval_policy_found=false',
      'for arg in "$@"; do',
      '  [[ "$arg" != "--ask-for-approval" ]] || exit 64',
      '  [[ "$arg" != \'approval_policy="never"\' ]] || approval_policy_found=true',
      'done',
      '[[ "$approval_policy_found" == "true" ]] || exit 65',
      'cat >/dev/null',
      `printf '%s' ${JSON.stringify(verdict)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { executable, argsLog };
}

// --- T2: claude launch_gate_reviewer ---------------------------------------------------

test('claude launch_gate_reviewer: read-only レビュアの verdict を gate-report へ結線し exit 0（final=approved）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: pass/pass を返す stub レビュア（GATE_REVIEWER_CMD）と認証キーあり。
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-logged',
    GATE_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${stubVerdict}'`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  // When: 起動ラッパー経由で launch_gate_reviewer を実行する。
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  // Then: exit 0・final=approved・approved_artifacts が digest 付きで結線される。
  assert.equal(res.status, 0, res.stderr);
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: { final: string; conformance: string; falsification: string; approved_artifacts: { path: string; digest: string }[] };
  };
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.conformance, 'pass');
  assert.equal(report.gate.falsification, 'pass');
  assert.equal(report.gate.approved_artifacts[0].path, 'SPEC.md');
  assert.match(report.gate.approved_artifacts[0].digest, /^sha256:[0-9a-f]{64}$/);
});

test('gate reviewer credential boundary: GitHub token・git/gh configをAI subprocessへ継承しない', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const command = [
    'cat >/dev/null',
    'test -z "${GH_TOKEN:-}"',
    'test -z "${GITHUB_TOKEN:-}"',
    'test "${GIT_CONFIG_GLOBAL:-}" = /dev/null',
    'test "${GH_CONFIG_DIR:-}" != "${CALLER_GH_CONFIG_DIR:-}"',
    `printf '%s' '${stubVerdict}'`,
  ].join('; ');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key-not-forwarded',
    GH_TOKEN: 'ghp_credential_boundary_test_value',
    GITHUB_TOKEN: 'github-token-boundary-test',
    CALLER_GH_CONFIG_DIR: '/credential-bearing/gh',
    GH_CONFIG_DIR: '/credential-bearing/gh',
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: macOS Keychainログインでは認証probeとreviewerが同じHOMEを使う（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-keychain-issue691-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  const claudeStub = path.join(stubDir, 'claude');
  const unameStub = path.join(stubDir, 'uname');
  const expectedHome = process.env.HOME!;
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  fs.writeFileSync(
    claudeStub,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `test "\${HOME:-}" = ${JSON.stringify(expectedHome)}`,
      'if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then exit 0; fi',
      'cat >/dev/null',
      `printf '%s' ${JSON.stringify(stubVerdict)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(unameStub, '#!/usr/bin/env bash\nprintf \'Darwin\\n\'\n', { mode: 0o755 });

  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    PATH: `${stubDir}:${process.env.PATH}`,
    CLAUDE_EXECUTABLE: claudeStub,
    CLAUDE_AUTH_PROBE_CMD: `${JSON.stringify(claudeStub)} auth status`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: macOS以外ではcaller HOMEを隔離HOMEへ置換する', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-isolation-'));
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-reviewer-root-'));
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));
  const unameStub = path.join(stubDir, 'uname');
  fs.writeFileSync(unameStub, '#!/usr/bin/env bash\nprintf \'Linux\\n\'\n', { mode: 0o755 });
  const expectedReviewerHome = path.join(isolatedRoot, 'home');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const command = [
    'cat >/dev/null',
    `test "\${HOME:-}" = ${JSON.stringify(expectedReviewerHome)}`,
    `printf '%s' ${JSON.stringify(stubVerdict)}`,
  ].join('; ');
  const env = envWithout([], {
    PATH: `${stubDir}:${process.env.PATH}`,
    ANTHROPIC_API_KEY: 'dummy-key',
    ASC_REVIEWER_SANITIZED_ROOT: isolatedRoot,
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: 認証未設定かつ実疎通確認も失敗する場合は安全側（human_required）へ倒し exit が 0 でも 3 でもない（真の認証欠如、regressionなし）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN 未設定。Issue #185で認証チェックが
  // env非空→claude auth statusの実疎通フォールバックの2段化になったため、CLAUDE_AUTH_PROBE_CMD=false
  // でプローブを常に失敗させ、実行機のclaude CLIの実際の認証状態に依存せずhermeticにする。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    CLAUDE_AUTH_PROBE_CMD: 'false',
  });

  // When: 起動する。
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  // Then: final=human_required・exit は error（0/3 以外）。
  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
});

// Issue #185 AC-4: env認証情報が無くても、実疎通確認（CLAUDE_AUTH_PROBE_CMDでモック）が成功すれば
// 認証欠如として誤判定せず起動処理へ進むことを検証する。
test('claude launch_gate_reviewer: env認証情報が無くてもCLAUDE_AUTH_PROBE_CMDの実疎通確認が成功すれば認証欠如と誤判定せず起動処理へ進む（AC-4）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  // Given: env認証情報は無いが、実疎通確認（CLAUDE_AUTH_PROBE_CMD）はexit0（認証済み）を模す。
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    GATE_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${stubVerdict}'`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  // Then: 認証欠如のfail-safe（human_required）は発火せず、通常の判定経路（final=approved）になる。
  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: レビュア起動失敗は human_required へ倒す（silent pass しない）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: 認証キーはあるが、レビュアが非ゼロ終了する（API 障害相当）。
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy-key',
    GATE_REVIEWER_CMD: 'cat >/dev/null; exit 1',
    GATE_REVIEWER_RETRIES: '2',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
});

// --- ISSUE-562: 隔離サブプロセスへのANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN引き継ぎ ----

test('claude launch_gate_reviewer: 呼び出し元のANTHROPIC_API_KEYを隔離サブプロセスへ引き継ぐ（AC-1）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: 隔離サブプロセス内でANTHROPIC_API_KEYの値そのものを検査するコマンド
  // （_claude_auth_ok()の高速パスは呼び出し元プロセスで判定済みのため、ここでは
  // 実際に起動される隔離env -iサブプロセス側に値が渡っているかだけを確認する）。
  const command = [
    'cat >/dev/null',
    'test "${ANTHROPIC_API_KEY:-}" = "issue562-forwarded-key"',
    'printf \'%s\' \'{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}\'',
  ].join('; ');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'issue562-forwarded-key',
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: 呼び出し元のCLAUDE_CODE_OAUTH_TOKENを隔離サブプロセスへ引き継ぐ（AC-1）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const command = [
    'cat >/dev/null',
    'test "${CLAUDE_CODE_OAUTH_TOKEN:-}" = "issue562-forwarded-oauth-token"',
    'test -z "${ANTHROPIC_API_KEY:-}"',
    'printf \'%s\' \'{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}\'',
  ].join('; ');
  const env = envWithout(['ANTHROPIC_API_KEY'], {
    CLAUDE_CODE_OAUTH_TOKEN: 'issue562-forwarded-oauth-token',
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: いずれのトークンも未設定でも既存のCLAUDE_CONFIG_DIRファイルベース認証引き継ぎ挙動は変化しない（AC-2）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const fakeClaudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-issue562-'));
  t.after(() => fs.rmSync(fakeClaudeConfig, { recursive: true, force: true }));

  const command = [
    'cat >/dev/null',
    'test -z "${ANTHROPIC_API_KEY:-}"',
    'test -z "${CLAUDE_CODE_OAUTH_TOKEN:-}"',
    `test "\${CLAUDE_CONFIG_DIR:-}" = ${JSON.stringify(fakeClaudeConfig)}`,
    'printf \'%s\' \'{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}\'',
  ].join('; ');
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    CLAUDE_CONFIG_DIR: fakeClaudeConfig,
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

// --- T3: human launch_gate_reviewer（非同期 deferred） ---------------------------------

test('human launch_gate_reviewer (local): マーカーを生成し final=human_required・exit 3 を返す', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());

  setAdapter(repo.dir, 'human');

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], process.env);

  assert.equal(res.status, 3, `deferred は exit 3。stderr=${res.stderr}`);
  assert.equal(readFinal(reportPath), 'human_required');
  const marker = `${reportPath.replace(/\.yaml$/, '')}.awaiting-human`;
  assert.ok(fs.existsSync(marker), 'ローカルモードで awaiting-human マーカーが生成されること');
  const body = fs.readFileSync(marker, 'utf8');
  for (const field of ['ISSUE-1', 'spec', targetSha, reportPath, 'verdict']) {
    assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `通知本文に ${field} を含むこと`);
  }
});

test('human launch_gate_reviewer (github): gh issue comment で通知し final=human_required・exit 3 を返す', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-human-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const { repo, reportPath, targetSha } = setupGateReview({ backend: 'github', env });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  setAdapter(repo.dir, 'human');

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 3, `deferred は exit 3。stderr=${res.stderr}`);
  assert.equal(readFinal(reportPath), 'human_required');
  const comments = stub.readState().comments['1'] ?? [];
  assert.equal(comments.length, 1, 'gh issue comment が 1 件発行されること');
  assert.match(comments[0].body, /awaiting-human/);
});

// --- ISSUE-548: 未登録adapter値のallowlist検査 -----------------------------------------

test('gate-launch-reviewer.sh: reviewer-contextが返すadapterが未登録値の場合はsourceせずhuman_required・error終了する', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());

  // reviewer-context出力を偽装し、adapters/配下を逸脱するadapter値を返す不正・旧版CLIを模擬する。
  const fakeCliDir = path.join(repo.dir, 'bin');
  fs.mkdirSync(fakeCliDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeCliDir, 'agents-md.js'),
    [
      "const argv = process.argv.slice(2);",
      "if (argv[0] === 'gate' && argv[1] === 'reviewer-context') {",
      "  process.stdout.write(['adapter=../../../tmp/malicious', 'core_review_required=false', 'core_review_status=ok'].join('\\n') + '\\n');",
      "  process.exit(0);",
      "} else if (argv[0] === 'gate' && argv[1] === 'mark-human-required') {",
      "  process.exit(0);",
      "} else {",
      "  process.exit(1);",
      "}",
    ].join('\n'),
    'utf8',
  );

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], envWithout([]));

  assert.notEqual(res.status, 0, 'source前に検査で止まりexit 0にならないこと');
  assert.notEqual(res.status, 3, 'deferredではなくerrorとして扱われること');
  assert.match(res.stderr, /未登録adapterです/);
  assert.doesNotMatch(res.stderr, /launch_gate_reviewer が定義されていません/, 'sourceまで到達しないこと');
});

// --- T4: codex launch_gate_reviewer（認証不成立 fail-safe） ------------------------------

test('codex launch_gate_reviewer: 認証不成立は gate を approve せず human_required・exit≠0 を返す', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());

  setAdapter(repo.dir, 'codex');
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'false',
    CODEX_REVIEWER_CMD: 'false',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0, '認証不成立は exit 0（完了）にならないこと');
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
});

test('codex launch_gate_reviewer: Codex CLI 不在は cleanup 後も error を返す', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());

  setAdapter(repo.dir, 'codex');
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: '__agent_skill_chain_missing_codex__',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0, 'CLI 不在は cleanup で exit 0 に上書きされないこと');
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
});

test('codex launch_gate_reviewer: exec未対応フラグを使わずapproval_policy=neverで既定起動する', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-exec-stub-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');

  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const stub = createCodexStub(stubDir, stubVerdict);
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: stub.executable,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  const argv = fs.readFileSync(stub.argsLog, 'utf8');
  assert.doesNotMatch(argv, /^--ask-for-approval$/m);
  assert.match(argv, /^approval_policy="never"$/m);
});

test('codex launch_gate_reviewer: 既定起動はread-only sandboxとhigh-capabilityモデルを使う', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${stubVerdict}'`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
  assert.equal(res.status, 0, res.stderr);
  const adapter = fs.readFileSync(path.join(repo.dir, '.agent-skill-chain', 'adapters', 'codex.sh'), 'utf8');
  assert.match(adapter, /--sandbox read-only/, 'reviewerはread-only sandboxで起動すること');
  assert.match(adapter, /CODEX_REVIEWER_MODEL:-gpt-5\.6/, 'reviewerはhigh-capability既定モデルを使うこと');
  assert.match(adapter, /CODEX_REVIEWER_REASONING_EFFORT:-high/, 'reviewerはhigh reasoning effortを使うこと');
});

// --- Issue #271: コア独立レビューのモデル能力強制 -------------------------------------

test('gate-launch-reviewer: core reviewをstandardで起動するとadapter前にhuman_requiredへ止める', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const env = envWithout([], {
    ASC_BASE_REF: 'main',
    ASC_REVIEW_SUBJECT: 'core_audit',
    CODEX_AUTH_PROBE_CMD: 'true',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /profile=strict/);
});

test('codex core reviewer: gpt-5.6-sol/xhigh/read-onlyのattested overrideだけを許可する', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const env = envWithout([], {
    ASC_BASE_REF: 'main',
    ASC_REVIEW_SUBJECT: 'core_audit',
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${stubVerdict}'`,
    CODEX_REVIEWER_MODEL: 'gpt-5.6-sol',
    CODEX_REVIEWER_REASONING_EFFORT: 'xhigh',
    CODEX_CORE_REVIEWER_ATTESTED: 'true',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  const adapter = fs.readFileSync(path.join(repo.dir, '.agent-skill-chain', 'adapters', 'codex.sh'), 'utf8');
  assert.match(adapter, /--sandbox read-only/);
  assert.match(adapter, /ASC_CODEX_REQUIRED_MODEL/);
  assert.match(adapter, /ASC_CODEX_REQUIRED_REASONING_EFFORT/);
});

test('codex core reviewer: modelまたはeffortの不一致は起動せずhuman_requiredへ止める', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const env = envWithout([], {
    ASC_BASE_REF: 'main',
    ASC_REVIEW_SUBJECT: 'core_audit',
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: 'cat >/dev/null; exit 0',
    CODEX_REVIEWER_MODEL: 'gpt-5.6-terra',
    CODEX_REVIEWER_REASONING_EFFORT: 'high',
    CODEX_CORE_REVIEWER_ATTESTED: 'true',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /project policy と一致しません/);
});

test('claude core reviewer: 実在model・能力attestation・reasoning probeを検証し--modelで起動する', async (t) => {
  const { repo, worktreePath, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const stub = createClaudeStub(worktreePath, stubVerdict);
  const env = envWithout([], {
    ASC_BASE_REF: 'main',
    ASC_REVIEW_SUBJECT: 'core_audit',
    ANTHROPIC_API_KEY: 'dummy',
    CLAUDE_EXECUTABLE: stub.executable,
    CLAUDE_CORE_REVIEW_MODEL: 'claude-frontier-test-model',
    CLAUDE_CORE_REVIEW_MODEL_TIER: 'frontier_coding',
    CLAUDE_CORE_REVIEW_REASONING_TIER: 'maximum_reasoning',
    CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD: 'true',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.match(fs.readFileSync(stub.argsLog, 'utf8'), /--model claude-frontier-test-model/);
  assert.doesNotMatch(fs.readFileSync(stub.argsLog, 'utf8'), /model_reasoning_effort|gpt-5\.6-sol/);
});

test('claude core reviewer: 能力attestationまたはreasoning probe不足はhuman_requiredへ止める', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    ASC_BASE_REF: 'main',
    ASC_REVIEW_SUBJECT: 'core_audit',
    ANTHROPIC_API_KEY: 'dummy',
    CLAUDE_CORE_REVIEW_MODEL: 'claude-frontier-test-model',
    CLAUDE_CORE_REVIEW_MODEL_TIER: 'frontier_coding',
    CLAUDE_CORE_REVIEW_REASONING_TIER: 'maximum_reasoning',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /reasoning.*probe/);
});

// --- T5: ラッパーの終了コード分岐（引数・アダプタ解決） --------------------------------

test('gate-launch-reviewer.sh: 引数不足は exit 1（使い方エラー）', async (t) => {
  const { repo } = setupGateReview();
  t.after(() => repo.cleanup());

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec'], process.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /使い方/);
});

test('gate-launch-reviewer.sh: 完了(0)/deferred(3)/error(≠0,≠3) の終了コードをそのまま伝播する', async (t) => {
  // completed: claude + pass/pass stub → 0
  {
    const { repo, reportPath, targetSha } = setupGateReview();
    t.after(() => repo.cleanup());
    setAdapter(repo.dir, 'claude');
    const env = envWithout([], {
      ANTHROPIC_API_KEY: 'dummy',
      GATE_REVIEWER_CMD: `cat >/dev/null; printf '%s' '{"conformance":"pass","falsification":"pass","blockers":[]}'`,
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    });
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
    assert.equal(res.status, 0, `completed は exit 0。stderr=${res.stderr}`);
  }
  // deferred: human → 3
  {
    const { repo, reportPath, targetSha } = setupGateReview();
    t.after(() => repo.cleanup());
    setAdapter(repo.dir, 'human');
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], process.env);
    assert.equal(res.status, 3, `deferred は exit 3。stderr=${res.stderr}`);
  }
  // error: codex 認証不成立 → ≠0,≠3
  {
    const { repo, reportPath, targetSha } = setupGateReview();
    t.after(() => repo.cleanup());
    setAdapter(repo.dir, 'codex');
    const env = envWithout([], {
      CODEX_AUTH_PROBE_CMD: 'true',
      CODEX_EXECUTABLE: '__agent_skill_chain_missing_codex__',
    });
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
    assert.notEqual(res.status, 0);
    assert.notEqual(res.status, 3);
  }
});
