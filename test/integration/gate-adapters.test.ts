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
  cwd = repoDir,
): ScriptResult {
  const script = path.join(repoDir, '.agent-skill-chain', 'scripts', 'gate-launch-reviewer.sh');
  try {
    const stdout = execFileSync('bash', [script, ...args], { cwd, encoding: 'utf8', env });
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
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_EXECUTABLE',
  'CLAUDE_CORE_REVIEW_MODEL',
  'CLAUDE_CORE_REVIEW_MODEL_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_TIER',
  'CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD',
  'CODEX_AUTH_PROBE_CMD',
  'CODEX_HOME',
  'CODEX_EXECUTABLE',
  'CODEX_REVIEWER_CMD',
  'CODEX_REVIEWER_MODEL',
  'CODEX_REVIEWER_REASONING_EFFORT',
  'CODEX_CORE_REVIEWER_ATTESTED',
  'GATE_REVIEWER_CMD',
  'GATE_REVIEWER_RETRIES',
  'GATE_REVIEWER_RETRY_INTERVAL_SEC',
  'GATE_REVIEWER_TIMEOUT_SEC',
  'ASC_REVIEWER_ORIGINAL_HOME',
  'ASC_REVIEWER_SANITIZED_ROOT',
  'ASC_BASE_REF',
  'ASC_REVIEW_SUBJECT',
  'ASC_REVIEW_ADAPTER_REQUESTED',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_CONFIG_DIR',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
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
    CLAUDE_AUTH_PROBE_CMD: 'true',
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

test('claude launch_gate_reviewer: 非標準ディレクトリのCLIとenv shebang runtimeを隔離PATHで起動できる（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runtime-issue691-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const runtimeName = `issue691-runtime-${process.pid}-${Date.now()}`;
  const runtime = path.join(runtimeDir, runtimeName);
  const executable = path.join(runtimeDir, 'claude-nonstandard');
  const runtimeLog = path.join(runtimeDir, 'runtime.log');
  const pathLog = path.join(runtimeDir, 'path.log');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  fs.writeFileSync(
    runtime,
    `#!/bin/bash\nprintf 'runtime\\n' >> ${JSON.stringify(runtimeLog)}\nexec /bin/bash "$@"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    executable,
    [
      `#!/usr/bin/env ${runtimeName}`,
      'set -euo pipefail',
      `printf '%s\\n' "$PATH" >> ${JSON.stringify(pathLog)}`,
      'if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then exit 0; fi',
      'cat >/dev/null',
      `printf '%s' ${JSON.stringify(stubVerdict)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const env = envWithout([], {
    CLAUDE_EXECUTABLE: executable,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.equal(fs.readFileSync(runtimeLog, 'utf8').trim().split('\n').length, 2, '認証probeとreviewerの双方がenv shebang runtimeを使うこと');
  for (const reviewerPath of fs.readFileSync(pathLog, 'utf8').trim().split('\n')) {
    assert.equal(reviewerPath, `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${runtimeDir}`);
  }
});

test('gate reviewer credential boundary: caller HOME・Issue worktree・GitHub token・git/gh configをAI subprocessへ継承しない', async (t) => {
  const { repo, worktreePath, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-caller-home-issue691-'));
  const observationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-observation-issue691-'));
  t.after(() => fs.rmSync(callerHome, { recursive: true, force: true }));
  t.after(() => fs.rmSync(observationDir, { recursive: true, force: true }));
  const envLog = path.join(observationDir, 'env.log');
  const cwdLog = path.join(observationDir, 'cwd.log');
  const worktreeCli = path.join(worktreePath, 'claude-worktree-stub');
  fs.mkdirSync(path.join(callerHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(callerHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(callerHome, '.claude', '.credentials.json'), '{"test":true}\n', 'utf8');
  fs.writeFileSync(path.join(callerHome, '.codex', 'auth.json'), '{"test":true}\n', 'utf8');
  fs.writeFileSync(worktreeCli, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const command = [
    'cat >/dev/null',
    `/usr/bin/env > ${JSON.stringify(envLog)}`,
    `/bin/pwd > ${JSON.stringify(cwdLog)}`,
    `printf '%s' '${stubVerdict}'`,
  ].join('; ');
  const env = envWithout([], {
    HOME: callerHome,
    ANTHROPIC_API_KEY: 'dummy-key-not-forwarded',
    CLAUDE_AUTH_PROBE_CMD: 'true',
    CLAUDE_EXECUTABLE: worktreeCli,
    GH_TOKEN: 'ghp_credential_boundary_test_value',
    GITHUB_TOKEN: 'github-token-boundary-test',
    GH_CONFIG_DIR: path.join(callerHome, '.config', 'gh'),
    GIT_CONFIG_GLOBAL: path.join(callerHome, '.gitconfig'),
    GIT_CONFIG_SYSTEM: path.join(callerHome, 'system.gitconfig'),
    PATH: `${path.join(callerHome, 'bin')}:${process.env.PATH}`,
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env, worktreePath);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');

  const reviewerEnv = fs.readFileSync(envLog, 'utf8');
  assert.doesNotMatch(reviewerEnv, /^(GH_TOKEN|GITHUB_TOKEN)=/m);
  assert.doesNotMatch(reviewerEnv, new RegExp(callerHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(reviewerEnv, new RegExp(worktreePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(reviewerEnv, /^GIT_CONFIG_GLOBAL=\/dev\/null$/m);
  assert.match(reviewerEnv, /^GIT_CONFIG_SYSTEM=\/dev\/null$/m);
  assert.match(reviewerEnv, /^GH_CONFIG_DIR=\/tmp\/agent-skill-chain-reviewer\.[^/]+\/xdg\/gh$/m);
  assert.match(reviewerEnv, /^CLAUDE_CONFIG_DIR=\/tmp\/agent-skill-chain-reviewer\.[^/]+\/auth\/claude$/m);
  assert.doesNotMatch(reviewerEnv, /^CODEX_HOME=/m);
  const reviewerCwd = fs.readFileSync(cwdLog, 'utf8').trim();
  assert.notEqual(reviewerCwd, worktreePath);
  assert.match(reviewerCwd, /^\/tmp\/agent-skill-chain-reviewer\.[^/]+\/workspace$/);
});

test('claude launch_gate_reviewer: TERMを無視するreviewerのプロセスグループをKILLしてhuman_requiredへ倒す（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-watchdog-issue691-'));
  const childPidFile = path.join(markerDir, 'child.pid');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(markerDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    GATE_REVIEWER_CMD: [
      "trap '' TERM",
      `/bin/bash -c 'trap "" TERM; while :; do :; done' &`,
      `printf '%s\\n' "$!" > ${JSON.stringify(childPidFile)}`,
      'while :; do :; done',
    ].join('\n'),
    GATE_REVIEWER_TIMEOUT_SEC: '1',
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const startedAt = Date.now();
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
  const elapsedMs = Date.now() - startedAt;

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /レビュア起動に失敗しました（rc=124, attempts=1）/);
  assert.ok(elapsedMs < 10000, `watchdogが期限と猶予の後にreviewerを停止すること: elapsed=${elapsedMs}ms`);
  assert.ok(fs.existsSync(childPidFile), 'reviewerの子プロセスが起動したこと');
  const childPid = Number(fs.readFileSync(childPidFile, 'utf8').trim());
  assert.throws(() => process.kill(childPid, 0), 'reviewerの子プロセスも残らないこと');
  const adapter = fs.readFileSync(path.join(repo.dir, '.agent-skill-chain', 'adapters', 'claude.sh'), 'utf8');
  const runner = adapter.slice(adapter.indexOf('_run_reviewer_sanitized()'), adapter.indexOf('_claude_reviewer_auth_ok()'));
  assert.doesNotMatch(runner, /(?:\/usr\/bin\/timeout|\/bin\/timeout|command -v timeout)/);
  assert.match(runner, /kill -TERM -- "-\$watched_pid"/);
  assert.match(runner, /kill -KILL -- "-\$watched_pid"/);
});

test('claude launch_gate_reviewer: 不正なtimeout値はreviewer起動前に日本語診断で拒否する（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-invalid-timeout-issue691-'));
  const reviewerMarker = path.join(markerDir, 'reviewer-invoked');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(markerDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'claude');

  const env = envWithout([], {
    CLAUDE_AUTH_PROBE_CMD: 'true',
    GATE_REVIEWER_CMD: `touch ${JSON.stringify(reviewerMarker)}`,
    GATE_REVIEWER_TIMEOUT_SEC: 'not-a-positive-integer',
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.equal(fs.existsSync(reviewerMarker), false, '不正なtimeout値ではreviewerを起動しないこと');
  assert.match(res.stderr, /GATE_REVIEWER_TIMEOUT_SEC は正整数で指定してください/);
});

test('claude launch_gate_reviewer: caller指定rootとsymlink認証ファイルからcaller HOMEへ脱出できない（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-caller-home-issue691-'));
  const outsideCredential = path.join(callerHome, 'outside-credentials.json');
  const claudeConfig = path.join(callerHome, '.claude');
  const observation = path.join(os.tmpdir(), `claude-isolation-observation-${process.pid}-${Date.now()}`);
  t.after(() => fs.rmSync(callerHome, { recursive: true, force: true }));
  t.after(() => fs.rmSync(observation, { force: true }));
  fs.mkdirSync(claudeConfig, { recursive: true });
  fs.writeFileSync(outsideCredential, '{"secret":"must-not-follow"}\n', 'utf8');
  fs.symlinkSync(outsideCredential, path.join(claudeConfig, '.credentials.json'));
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const command = [
    'cat >/dev/null',
    'test -z "${ASC_REVIEWER_ORIGINAL_HOME:-}"',
    'test -z "${ASC_REVIEWER_SANITIZED_ROOT:-}"',
    'test ! -e "${CLAUDE_CONFIG_DIR}/.credentials.json"',
    'test -z "$(/usr/bin/find "${HOME}/.." -type l -print -quit)"',
    `printf '%s\n%s\n%s\n' "\${HOME:-}" "\${CLAUDE_CONFIG_DIR:-}" "\${PWD:-}" > ${JSON.stringify(observation)}`,
    `printf '%s' ${JSON.stringify(stubVerdict)}`,
  ].join('; ');

  const env = envWithout([], {
    HOME: callerHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    ANTHROPIC_API_KEY: 'dummy-key',
    CLAUDE_AUTH_PROBE_CMD: 'true',
    ASC_REVIEWER_ORIGINAL_HOME: '/caller-controlled/reviewer-home',
    ASC_REVIEWER_SANITIZED_ROOT: path.join(callerHome, 'caller-controlled-root'),
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  const observedPaths = fs.readFileSync(observation, 'utf8');
  assert.doesNotMatch(observedPaths, new RegExp(callerHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(observedPaths, /^\/tmp\/agent-skill-chain-reviewer\./m);
});

test('claude launch_gate_reviewer: caller HOME依存の認証不成立は原因と回避手段を診断して再試行しない（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-keychain-home-issue691-'));
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-keychain-root-issue691-'));
  const reviewerMarker = path.join(isolatedRoot, 'reviewer-invoked');
  t.after(() => fs.rmSync(callerHome, { recursive: true, force: true }));
  t.after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));
  const env = envWithout([], {
    HOME: callerHome,
    ASC_REVIEWER_SANITIZED_ROOT: isolatedRoot,
    CLAUDE_AUTH_PROBE_CMD: `test "\${HOME:-}" = ${JSON.stringify(callerHome)}`,
    GATE_REVIEWER_CMD: `touch ${JSON.stringify(reviewerMarker)}`,
    GATE_REVIEWER_RETRIES: '3',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.equal(fs.existsSync(reviewerMarker), false, '決定的な認証不成立ではレビュアを起動しないこと');
  assert.match(res.stderr, /隔離環境でClaude Codeの認証probeに失敗/);
  assert.match(res.stderr, /ANTHROPIC_API_KEYとCLAUDE_CODE_OAUTH_TOKENは未設定/);
  assert.match(res.stderr, /設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりません/);
  assert.match(res.stderr, /隔離環境へ持ち込める認証情報がありません/);
  assert.match(res.stderr, /呼び出し元で `claude auth status` が成功/);
  assert.match(res.stderr, /test -n "\$\{ANTHROPIC_API_KEY:-\}\$\{CLAUDE_CODE_OAUTH_TOKEN:-\}"/);
  assert.match(res.stderr, /test -f "\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/\.credentials\.json"/);
  assert.match(res.stderr, /macOS Keychain/);
  assert.doesNotMatch(res.stderr, new RegExp(callerHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('claude launch_gate_reviewer: tokenが存在しても隔離環境の認証probe失敗を高速経路で迂回しない（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fast-path-issue691-'));
  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-token-home-issue691-'));
  const reviewerMarker = path.join(markerDir, 'reviewer-invoked');
  t.after(() => fs.rmSync(markerDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(callerHome, { recursive: true, force: true }));
  const secretToken = 'issue691-invalid-token-must-not-be-logged';
  const env = envWithout([], {
    HOME: callerHome,
    ANTHROPIC_API_KEY: secretToken,
    CLAUDE_AUTH_PROBE_CMD: 'false',
    GATE_REVIEWER_CMD: `touch ${JSON.stringify(reviewerMarker)}`,
    GATE_REVIEWER_RETRIES: '3',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.equal(fs.existsSync(reviewerMarker), false);
  assert.match(res.stderr, /環境変数による資格情報: 設定されています（実値は表示しません）/);
  assert.match(res.stderr, /設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりません/);
  assert.match(res.stderr, /持ち込み可能な認証情報は検出されましたが、隔離環境の認証probeが失敗/);
  assert.doesNotMatch(res.stderr, new RegExp(secretToken));
  assert.doesNotMatch(res.stderr, new RegExp(callerHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('claude launch_gate_reviewer: 設定ディレクトリのログイン情報があってprobeに失敗した原因を区別する（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const claudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-diagnostic-issue691-'));
  const secretCredential = 'issue691-credential-content-must-not-be-logged';
  t.after(() => fs.rmSync(claudeConfig, { recursive: true, force: true }));
  fs.writeFileSync(path.join(claudeConfig, '.credentials.json'), secretCredential, 'utf8');
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_CONFIG_DIR: claudeConfig,
    CLAUDE_AUTH_PROBE_CMD: 'false',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /ANTHROPIC_API_KEYとCLAUDE_CODE_OAUTH_TOKENは未設定/);
  assert.match(res.stderr, /設定ディレクトリ配下のログイン情報: 隔離領域へ複製可能な通常ファイルが見つかりました/);
  assert.match(res.stderr, /持ち込み可能な認証情報は検出されましたが、隔離環境の認証probeが失敗/);
  assert.doesNotMatch(res.stderr, new RegExp(secretCredential));
  assert.doesNotMatch(res.stderr, new RegExp(claudeConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('claude launch_gate_reviewer: 認証未設定かつ実疎通確認も失敗する場合は安全側（human_required）へ倒し exit が 0 でも 3 でもない（真の認証欠如、regressionなし）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN 未設定。CLAUDE_AUTH_PROBE_CMD=falseで
  // プローブを常に失敗させ、実行機のclaude CLIの実際の認証状態に依存せずhermeticにする。
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
    CLAUDE_AUTH_PROBE_CMD: 'true',
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

  // Given: 隔離サブプロセス内でANTHROPIC_API_KEYの値そのものを検査するコマンド。
  const command = [
    'cat >/dev/null',
    'test "${ANTHROPIC_API_KEY:-}" = "issue562-forwarded-key"',
    'printf \'%s\' \'{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}\'',
  ].join('; ');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'issue562-forwarded-key',
    CLAUDE_AUTH_PROBE_CMD: 'true',
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
    CLAUDE_AUTH_PROBE_CMD: 'true',
    GATE_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
});

test('claude launch_gate_reviewer: CLAUDE_CONFIG_DIRの認証ファイルだけを隔離領域へ複製する（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  const fakeClaudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-issue562-'));
  t.after(() => fs.rmSync(fakeClaudeConfig, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fakeClaudeConfig, '.credentials.json'), '{"marker":"staged-credential"}\n', 'utf8');
  fs.writeFileSync(path.join(fakeClaudeConfig, 'settings.json'), '{"hooks":"must-not-copy"}\n', 'utf8');

  const command = [
    'cat >/dev/null',
    'test -z "${ANTHROPIC_API_KEY:-}"',
    'test -z "${CLAUDE_CODE_OAUTH_TOKEN:-}"',
    `test "\${CLAUDE_CONFIG_DIR:-}" != ${JSON.stringify(fakeClaudeConfig)}`,
    'grep -q staged-credential "${CLAUDE_CONFIG_DIR}/.credentials.json"',
    'test ! -e "${CLAUDE_CONFIG_DIR}/settings.json"',
    'printf \'%s\' \'{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}\'',
  ].join('; ');
  const env = envWithout(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], {
    CLAUDE_AUTH_PROBE_CMD: 'grep -q staged-credential "${CLAUDE_CONFIG_DIR}/.credentials.json"',
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
  assert.match(res.stderr, /隔離環境でCodexの認証が成立しません/);
});

test('codex launch_gate_reviewer: auth.jsonだけを隔離CODEX_HOMEへ複製して起動する（Issue #691）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const callerCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-issue691-'));
  t.after(() => fs.rmSync(callerCodexHome, { recursive: true, force: true }));
  fs.writeFileSync(path.join(callerCodexHome, 'auth.json'), '{"marker":"codex-staged-auth"}\n', 'utf8');
  fs.writeFileSync(path.join(callerCodexHome, 'config.toml'), 'must_not_copy = true\n', 'utf8');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const command = [
    'cat >/dev/null',
    `test "\${CODEX_HOME:-}" != ${JSON.stringify(callerCodexHome)}`,
    'grep -q codex-staged-auth "${CODEX_HOME}/auth.json"',
    'test ! -e "${CODEX_HOME}/config.toml"',
    'test -z "${CLAUDE_CONFIG_DIR:-}"',
    'test -z "${ANTHROPIC_API_KEY:-}"',
    `printf '%s' ${JSON.stringify(stubVerdict)}`,
  ].join('; ');
  const env = envWithout([], {
    CODEX_HOME: callerCodexHome,
    ANTHROPIC_API_KEY: 'must-not-cross-provider-boundary',
    CODEX_AUTH_PROBE_CMD: 'grep -q codex-staged-auth "${CODEX_HOME}/auth.json"',
    CODEX_REVIEWER_CMD: command,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
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
    CLAUDE_AUTH_PROBE_CMD: 'true',
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
      CLAUDE_AUTH_PROBE_CMD: 'true',
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
