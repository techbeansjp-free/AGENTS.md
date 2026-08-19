import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { setAdapter } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { envWithout, readFinal, runLauncher, setupGateReview } from '../helpers/gate-launcher.js';

// #164-② gate判定ステップの adapter 層（launch_gate_reviewer）+ 起動ラッパー
// （.agent-skill-chain/scripts/gate-launch-reviewer.sh）を実際の bash で駆動して検証する:
//   T2 claude（完了経路・認証未設定フェイルセーフ）、T3 human（非同期 deferred）、
//   T4 codex（未構成 fail-safe）、T5 ラッパーの終了コード分岐（0/3/error）。
// モデル（レビュア）呼び出しは GATE_REVIEWER_CMD または fake CLI で stub 化し、実 API・実 gh へは
// 一切アクセスしない。

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
      '#!/bin/bash -e',
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

/**
 * 受け取った `-m` の値をそのまま model unavailable の stderr へ echo して非ゼロ終了する
 * codex exec 互換 stub。明示 model が無改変で reviewer へ渡ることと、その値を含む
 * stderr が分類器で MODEL_UNAVAILABLE になることを同じ経路で観測する（Issue #744）。
 */
function createCodexModelEchoStub(dir: string, exitCode: number): { executable: string; argsLog: string } {
  const executable = path.join(dir, 'codex-model-echo-stub');
  const argsLog = path.join(dir, 'codex-model-echo-args.log');
  fs.writeFileSync(
    executable,
    [
      '#!/bin/bash',
      'set -uo pipefail',
      `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}`,
      'model=""',
      'prev=""',
      'for arg in "$@"; do',
      '  [[ "$prev" != "-m" ]] || model="$arg"',
      '  prev="$arg"',
      'done',
      'cat >/dev/null',
      `printf "error: model '%s' is not available\\n" "$model" >&2`,
      `exit ${exitCode}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { executable, argsLog };
}

/** setsid(1) は util-linux 由来で macOS には無い。別session detach の再現可否を判定する。 */
function hasSetsid(): boolean {
  try {
    execFileSync('bash', ['-c', 'command -v setsid'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function classifyReviewerStderr(input: string | Buffer): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-stderr-classifier-issue744-'));
  const stateFile = path.join(dir, 'state');
  try {
    execFileSync(
      'bash',
      ['-c', 'source "$1"; _reviewer_classify_stderr "$2"', 'bash', path.join(process.cwd(), '.agent-skill-chain', 'adapters', 'claude.sh'), stateFile],
      { input, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return Object.fromEntries(
      fs.readFileSync(stateFile, 'utf8').trim().split('\n').map((line) => line.split('=', 2)),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function renderFailureEnvelope(internal: string, rc: string, attempts: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-c',
      'source "$1"; _reviewer_failure_envelope "$2" "$3" "$4"',
      'bash',
      path.join(process.cwd(), '.agent-skill-chain', 'adapters', 'claude.sh'),
      internal,
      rc,
      attempts,
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
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
    PATH: `${runtimeDir}:${process.env.PATH}`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.equal(fs.readFileSync(runtimeLog, 'utf8').trim().split('\n').length, 2, '認証probeとreviewerの双方がenv shebang runtimeを使うこと');
  for (const reviewerPath of fs.readFileSync(pathLog, 'utf8').trim().split('\n')) {
    assert.equal(reviewerPath, '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
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
  assert.match(res.stderr, /code=REVIEWER_TIMEOUT classification=TIMEOUT rc=124 attempts=1 stderr_truncated=false/);
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

test('reviewer stderr classifier: model/authの完全一致だけを相互排他的に分類する（Issue #744 AC-1）', () => {
  const modelSignatures = [
    "error: model 'gpt-5.6-sol' is not available",
    "error: model 'gpt-5.6-terra' is not supported",
    "error: model 'gpt-5.6-luna' does not exist",
    "error: unknown model 'gpt-5.6-sol'",
  ];
  const authSignatures = [
    'error: authentication failed',
    'error: unauthorized',
    'error: not authenticated',
    'error: login required',
    'error: not logged in',
    'error: http 401',
    'error: http 403',
  ];
  for (const signature of modelSignatures) {
    assert.equal(classifyReviewerStderr(`${signature}\n`).classification, 'MODEL_UNAVAILABLE', signature);
  }
  for (const signature of authSignatures) {
    assert.equal(classifyReviewerStderr(`${signature}\r\n`).classification, 'AUTHENTICATION_FAILURE', signature);
  }
  assert.equal(classifyReviewerStderr('error: unknown option for model command\n').classification, 'EXECUTION_FAILURE');
  assert.equal(classifyReviewerStderr("error: model 'gpt-5.6-sol' is not available: retry\n").classification, 'EXECUTION_FAILURE');
  assert.equal(
    classifyReviewerStderr("error: model 'gpt-5.6-sol' is not available\nerror: unauthorized\n").classification,
    'EXECUTION_FAILURE',
  );
});

test('reviewer stderr classifier: 64 KiBだけを検査し、超過後も入力をdrainする（Issue #744 AC-2）', () => {
  const exact = classifyReviewerStderr(Buffer.alloc(64 * 1024, 0x78));
  assert.deepEqual(exact, {
    classification: 'EXECUTION_FAILURE',
    stderr_bytes: String(64 * 1024),
    stderr_truncated: 'false',
  });
  const over = classifyReviewerStderr(Buffer.alloc(64 * 1024 + 1, 0x78));
  assert.equal(over.stderr_bytes, String(64 * 1024));
  assert.equal(over.stderr_truncated, 'true');
  const signature = "error: unknown model 'gpt-5.6-sol'";
  const boundarySuffix = `${'x'.repeat(64 * 1024 - signature.length - 1)}\n${signature}x`;
  assert.equal(classifyReviewerStderr(boundarySuffix).classification, 'EXECUTION_FAILURE', '上限位置を偽の行末にしないこと');
});

test('reviewer failure envelope: allowlist検証不能時は固定分類とrcだけへ縮退する（Issue #744 AC-4）', () => {
  const tainted = 'classification=MODEL_UNAVAILABLE;stderr_truncated=false;raw=secret-fragment';
  const output = renderFailureEnvelope(tainted, '41', '3');
  assert.equal(output, 'classification=EXECUTION_FAILURE rc=41');
  assert.doesNotMatch(output, /secret-fragment/);
  assert.ok(Buffer.byteLength(output) <= 4096);
});

test('codex launch_gate_reviewer: 認証不成立は gate を approve せず human_required・exit≠0 を返す', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-failure-issue727-'));
  const authSecret = 'issue727-invalid-auth-secret-must-not-be-logged';
  t.after(() => {
    repo.cleanup();
    fs.rmSync(codexHome, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(codexHome, 'auth.json'), authSecret, 'utf8');

  setAdapter(repo.dir, 'codex');
  const env = envWithout([], {
    CODEX_HOME: codexHome,
    CODEX_AUTH_PROBE_CMD: 'false',
    CODEX_REVIEWER_CMD: 'false',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0, '認証不成立は exit 0（完了）にならないこと');
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /隔離環境でCodexの認証が成立しません/);
  assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, new RegExp(authSecret));
});

test('codex launch_gate_reviewer: HOME配下のenv -S interpreterを絶対パスで起動しshebang引数を保持する（Issue #727 AC-1/AC-2/AC-5）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-caller-home-issue727-'));
  const observationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-observation-issue727-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(callerHome, { recursive: true, force: true });
    fs.rmSync(observationDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');

  const binDir = path.join(callerHome, 'bin');
  const codexHome = path.join(callerHome, '.codex');
  const interpreter = path.join(binDir, 'node');
  const executable = path.join(binDir, 'codex');
  const pathLog = path.join(observationDir, 'path.log');
  const interpreterArgsLog = path.join(observationDir, 'interpreter-args.log');
  const authSecret = 'issue727-auth-secret-must-not-be-logged';
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'auth.json'), authSecret, 'utf8');
  fs.writeFileSync(
    interpreter,
    [
      '#!/bin/bash',
      `printf '%s\\n' "$PATH" >> ${JSON.stringify(pathLog)}`,
      `printf '%s\\n' "$@" >> ${JSON.stringify(interpreterArgsLog)}`,
      'exec /bin/bash "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    executable,
    [
      '#!/usr/bin/env -S node --noprofile',
      'set -euo pipefail',
      'grep -q issue727-auth-secret-must-not-be-logged "${CODEX_HOME}/auth.json"',
      'if [[ "${1:-}" == "login" && "${2:-}" == "status" ]]; then exit 0; fi',
      'cat >/dev/null',
      `printf '%s' ${JSON.stringify(stubVerdict)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const env = envWithout([], {
    HOME: callerHome,
    CODEX_HOME: codexHome,
    CODEX_EXECUTABLE: executable,
    PATH: `${binDir}:${process.env.PATH}`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  const observedPaths = fs.readFileSync(pathLog, 'utf8').trim().split('\n');
  assert.equal(observedPaths.length, 2, '認証probeとreviewerの双方が同じ解決済みinterpreterを使うこと');
  for (const reviewerPath of observedPaths) {
    assert.equal(reviewerPath, '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    assert.doesNotMatch(reviewerPath, new RegExp(binDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const interpreterArgs = fs.readFileSync(interpreterArgsLog, 'utf8');
  assert.match(interpreterArgs, /^--noprofile$/m, 'env -Sのinterpreter引数を欠落させないこと');
  assert.match(interpreterArgs, new RegExp(`^${executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, new RegExp(authSecret));
});

test('codex launch_gate_reviewer: 多段shimのinterpreter解決不能を認証失敗と区別する（Issue #727 AC-3）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-multistage-issue727-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');

  const missingInterpreter = `issue727-missing-runtime-${process.pid}-${Date.now()}`;
  const interpreter = path.join(stubDir, 'node');
  const executable = path.join(stubDir, 'codex');
  fs.writeFileSync(interpreter, `#!/usr/bin/env ${missingInterpreter}\n`, { mode: 0o755 });
  fs.writeFileSync(executable, '#!/usr/bin/env node\n', { mode: 0o755 });
  const env = envWithout([], {
    CODEX_EXECUTABLE: executable,
    PATH: `${stubDir}:${process.env.PATH}`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, new RegExp(`解決できなかった対象: ${missingInterpreter}`));
  assert.match(res.stderr, /隔離環境の固定PATH: \/usr\/local\/bin:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/);
  assert.match(res.stderr, /呼び出し元環境のPATHへ導入するか実行ファイル設定を確認/);
  assert.doesNotMatch(res.stderr, /Codexの認証が成立しません/);
});

test('codex launch_gate_reviewer: ENOEXEC相当の実行失敗を認証失敗と区別する（Issue #727）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-enoexec-issue727-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');
  const executable = path.join(stubDir, 'codex');
  fs.writeFileSync(executable, 'not-an-executable-format\n', { mode: 0o755 });

  const res = runLauncher(
    repo.dir,
    ['ISSUE-1', 'spec', 'standard', reportPath, targetSha],
    envWithout([], { CODEX_EXECUTABLE: executable, GATE_REVIEWER_RETRY_INTERVAL_SEC: '0' }),
  );

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /実行権限不足（EACCES）または実行形式不正（ENOEXEC）/);
  assert.doesNotMatch(res.stderr, /Codexの認証が成立しません/);
});

test('codex launch_gate_reviewer: EACCES相当の実行失敗を認証失敗と区別する（Issue #727）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-eacces-issue727-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');
  const executable = path.join(stubDir, 'codex');
  fs.writeFileSync(executable, '#!/bin/bash\nexit 0\n', { mode: 0o644 });

  const res = runLauncher(
    repo.dir,
    ['ISSUE-1', 'spec', 'standard', reportPath, targetSha],
    envWithout([], { CODEX_EXECUTABLE: executable, GATE_REVIEWER_RETRY_INTERVAL_SEC: '0' }),
  );

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /対象: .*codex。実行権限不足（EACCES）または実行形式不正（ENOEXEC）/);
  assert.doesNotMatch(res.stderr, /Codexの認証が成立しません/);
});

test('reviewer executable resolver: native形式はinterpreterを追加せず絶対パスで実行する（Issue #727 AC-6）', () => {
  const adapterPath = path.join(process.cwd(), '.agent-skill-chain', 'adapters', 'claude.sh');
  const output = execFileSync(
    'bash',
    ['-c', 'source "$1"; resolved="$(_reviewer_resolve_executable_command "$2")"; printf "%s\\n" "$resolved"; eval "$resolved"', 'bash', adapterPath, process.execPath],
    { encoding: 'utf8' },
  );
  assert.equal(output.trim(), `/usr/bin/env -- ${process.execPath}`);
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
  assert.match(argv, /^gpt-5\.6-sol$/m);
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
  assert.match(adapter, /model='gpt-5\.6-sol'/, 'reviewerは利用可能なconcrete既定モデルを使うこと');
  assert.match(adapter, /CODEX_REVIEWER_REASONING_EFFORT:-high/, 'reviewerはhigh reasoning effortを使うこと');
});

test('codex reviewer: 組込み既定のmodel unavailableを安全な専用診断にする（Issue #744 AC-1/AC-5）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');
  const secret = 'issue744-provider-secret-must-not-appear';
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: `cat >/dev/null; printf '%s\\n' "error: model 'gpt-5.6-sol' is not available" ${JSON.stringify(secret)} >&2; exit 41`,
    GATE_REVIEWER_RETRIES: '2',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=2 stderr_truncated=false/);
  assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, new RegExp(secret));
  assert.ok(Buffer.byteLength(res.stderr) <= 4096);
});

test('codex reviewer: chunk分割された認証失敗をretry後の固定診断にする（Issue #744 AC-1/AC-8）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: "cat >/dev/null; printf 'error: una' >&2; printf 'uthorized\\n' >&2; exit 42",
    GATE_REVIEWER_RETRIES: '2',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /code=REVIEWER_AUTHENTICATION_FAILURE classification=AUTHENTICATION_FAILURE rc=42 attempts=2 stderr_truncated=false/);
});

test('codex reviewer: 64 KiB超過をraw非保持でdrainし外部診断へtruncatedを示す（Issue #744 AC-2）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: 'cat >/dev/null; /usr/bin/head -c 65537 /dev/zero >&2; exit 43',
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(res.stderr, /classification=EXECUTION_FAILURE rc=43 attempts=1 stderr_truncated=true/);
  assert.ok(Buffer.byteLength(res.stderr) <= 4096);
});

test('codex reviewer: 明示model overrideを無改変で最優先にする（Issue #744 AC-6）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-model-override-issue744-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const stub = createCodexStub(stubDir, stubVerdict);
  const explicitModel = 'vendor-model_2026.preview';
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: stub.executable,
    CODEX_REVIEWER_MODEL: explicitModel,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.match(fs.readFileSync(stub.argsLog, 'utf8'), new RegExp(`^${explicitModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('codex reviewer: 区切り文字を含む明示modelのmodel unavailableを誤分類しない（Issue #744 AC-1/AC-6）', async (t) => {
  // implementation-gate round 1 の反例: CODEX_REVIEWER_MODEL='vendor/model' は codex.sh を
  // 無改変で通過して reviewer へ渡るが、'/' が model DFA の全分岐を無効化するため
  // model unavailable が EXECUTION_FAILURE へ誤分類されていた。
  const explicitModel = 'vendor/model';
  assert.equal(
    classifyReviewerStderr(`error: model '${explicitModel}' is not available\n`).classification,
    'MODEL_UNAVAILABLE',
  );
  assert.equal(
    classifyReviewerStderr("error: unknown model 'org/team/model:2026-08+preview'\n").classification,
    'MODEL_UNAVAILABLE',
  );
  assert.equal(classifyReviewerStderr('error: unknown option for model command\n').classification, 'EXECUTION_FAILURE');
  assert.equal(
    classifyReviewerStderr(`error: model '${explicitModel}' is not available: retry\n`).classification,
    'EXECUTION_FAILURE',
  );

  const { repo, reportPath, targetSha } = setupGateReview();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-model-charset-issue744-'));
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');
  const stub = createCodexModelEchoStub(stubDir, 41);
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_EXECUTABLE: stub.executable,
    CODEX_REVIEWER_MODEL: explicitModel,
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0);
  assert.equal(readFinal(reportPath), 'human_required');
  assert.match(fs.readFileSync(stub.argsLog, 'utf8'), /^vendor\/model$/m, '明示modelを無改変でreviewerへ渡すこと');
  assert.match(
    res.stderr,
    /code=REVIEWER_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=1 stderr_truncated=false/,
  );
});

test('codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても回収が停止しない（Issue #744 AC-3/AC-8）', async (t) => {
  // implementation-gate round 1 の反例: reviewer が別 session / process group へ子を detach して
  // 正常終了すると、その子は stderr FIFO の write descriptor を継承し、reviewer プロセスグループへの
  // kill では停止しないため、分類drainの回収が EOF を待って無期限に停止していた。
  if (!hasSetsid()) {
    t.skip('setsid(1) が無い環境では別sessionへのdetachを再現できない');
    return;
  }
  const { repo, reportPath, targetSha } = setupGateReview();
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-detached-fifo-issue744-'));
  const detachedInfo = path.join(markerDir, 'detached-child.info');
  const rootLog = path.join(markerDir, 'root.log');
  let detachedPid = 0;
  t.after(() => {
    if (detachedPid > 0) {
      try {
        process.kill(detachedPid, 'SIGKILL');
      } catch {
        /* 既に終了していれば何もしない */
      }
    }
    repo.cleanup();
    fs.rmSync(markerDir, { recursive: true, force: true });
  });
  setAdapter(repo.dir, 'codex');

  const verdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'true',
    CODEX_REVIEWER_CMD: [
      'cat >/dev/null',
      `dirname "$HOME" > ${JSON.stringify(rootLog)}`,
      `setsid /bin/bash -c 'printf "%s %s\\n" "$$" "$(ps -o sid= -p $$ | tr -d " ")" > ${JSON.stringify(detachedInfo)}; exec /bin/sleep 120' &`,
      `printf '%s' ${JSON.stringify(verdict)}`,
    ].join('\n'),
    GATE_REVIEWER_TIMEOUT_SEC: '30',
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const startedAt = Date.now();
  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFinal(reportPath), 'approved');
  assert.ok(elapsedMs < 20000, `detachした子のstderr保持で回収が停止しないこと: elapsed=${elapsedMs}ms`);
  assert.equal(fs.existsSync(fs.readFileSync(rootLog, 'utf8').trim()), false, '隔離rootが残らないこと');

  const [childPid, childSid] = fs.readFileSync(detachedInfo, 'utf8').trim().split(/\s+/);
  detachedPid = Number(childPid);
  const ownSid = execFileSync('ps', ['-o', 'sid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
  assert.notEqual(childSid, ownSid, '子が別sessionへdetachしていること');
  assert.doesNotThrow(() => process.kill(detachedPid, 0), 'detachした子がreviewer終了後も生存していること');

  const adapter = fs.readFileSync(path.join(repo.dir, '.agent-skill-chain', 'adapters', 'claude.sh'), 'utf8');
  const runner = adapter.slice(adapter.indexOf('_run_reviewer_sanitized()'), adapter.indexOf('_claude_reviewer_auth_ok()'));
  const reviewerLaunch = runner.slice(runner.indexOf('classifier_pid=$!'), runner.indexOf('reviewer_pid=$!'));
  assert.match(reviewerLaunch, /exec \{stderr_fifo_fd\}>&-/, 'reviewer subshellがFIFO descriptorを閉じること');
  assert.match(reviewerLaunch, /cd -- "\$isolated_root\/workspace"/, '対象がreviewer起動subshellであること');
});

test('codex reviewer: 成功・失敗ともraw stderrと秘密値を外へ出さず隔離rootを削除する（Issue #744 AC-3/AC-8）', async (t) => {
  const secret = 'issue744-secret-and-raw-stderr-fragment';

  for (const succeeds of [true, false]) {
    const { repo, reportPath, targetSha } = setupGateReview();
    const observationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cleanup-issue744-'));
    const rootLog = path.join(observationDir, 'root.log');
    try {
      setAdapter(repo.dir, 'codex');
      const verdict = '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
      const command = succeeds
        ? `cat >/dev/null; dirname "$HOME" > ${JSON.stringify(rootLog)}; printf '%s\\n' ${JSON.stringify(secret)} >&2; printf '%s' '${verdict}'`
        : `cat >/dev/null; dirname "$HOME" > ${JSON.stringify(rootLog)}; printf '%s' ${JSON.stringify(secret)}; printf '%s\\n' ${JSON.stringify(secret)} >&2; exit 42`;
      const env = envWithout([], {
        CODEX_AUTH_PROBE_CMD: 'true',
        CODEX_REVIEWER_CMD: command,
        GATE_REVIEWER_RETRIES: '1',
        GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
      });

      const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
      assert.equal(res.status === 0, succeeds, res.stderr);
      assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, new RegExp(secret));
      assert.equal(fs.existsSync(fs.readFileSync(rootLog, 'utf8').trim()), false, '隔離rootが残らないこと');
      if (!succeeds) {
        assert.match(res.stderr, /classification=EXECUTION_FAILURE rc=42 attempts=1/);
        assert.equal(readFinal(reportPath), 'human_required');
      }
    } finally {
      repo.cleanup();
      fs.rmSync(observationDir, { recursive: true, force: true });
    }
  }
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

test('gate adapter: reviewer-promptへ証跡投稿と同じPR番号・attempt_idを渡す', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), '.agent-skill-chain', 'adapters', 'claude.sh'),
    'utf8',
  );
  assert.match(
    source,
    /gate reviewer-prompt[^\n]*ASC_EVIDENCE_PR_NUMBER[^\n]*ASC_REVIEW_ATTEMPT_ID/,
  );
  assert.match(source, /prompt_hash="\$\(printf '%s' "\$prompt" \| _sha256_digest\)"/);
  assert.match(source, /gate submit-evidence[\s\S]*"\$prompt_digest"/);
});

test('gate adapter: sha256sum不在時も既存のshasum fallbackでprompt digestを算出する', (t) => {
  const adapter = path.join(process.cwd(), '.agent-skill-chain', 'adapters', 'claude.sh');
  const helper = /^_sha256_digest\(\) \{[\s\S]*?^\}/m.exec(fs.readFileSync(adapter, 'utf8'))?.[0];
  assert.ok(helper, 'promptとcontractが共有するSHA-256 helperを抽出できること');
  const shasum = execFileSync('bash', ['-lc', 'command -v shasum'], { encoding: 'utf8' }).trim();
  const tr = execFileSync('bash', ['-lc', 'command -v tr'], { encoding: 'utf8' }).trim();
  const portableBin = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-prompt-digest-'));
  t.after(() => fs.rmSync(portableBin, { recursive: true, force: true }));
  fs.symlinkSync(shasum, path.join(portableBin, 'shasum'));
  fs.symlinkSync(tr, path.join(portableBin, 'tr'));

  const digest = execFileSync(
    '/bin/bash',
    ['-c', `${helper}\nprintf %s prompt-body | _sha256_digest`],
    { encoding: 'utf8', env: { ...process.env, PATH: portableBin } },
  ).trim();
  assert.equal(digest, '735c5f663a35ca8fef9fb2f2890c0a48aee0c53b00c166105fd45427a7a6a40a');

  assert.throws(
    () => execFileSync('/bin/bash', ['-c', `${helper}\nprintf %s prompt-body | _sha256_digest`], {
      env: { ...process.env, PATH: '' },
      stdio: 'pipe',
    }),
    (error: unknown) => {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? '';
      return /sha256sumまたはshasumが見つかりません/.test(stderr);
    },
  );
});

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
