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
// モデル（レビュア）呼び出しは GATE_REVIEWER_CMD で stub 化し、実 API・実 gh へは一切アクセスしない。

interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

const PASS_VERDICT = JSON.stringify({
  conformance: 'pass',
  falsification: 'pass',
  acceptance_criteria: [{ ac_id: 'AC-1', conformance: 'pass', evidence: ['SPEC.md AC-1'] }],
  blockers: [],
  approved_artifacts: [{ path: 'SPEC.md' }],
});

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

// --- T2: claude launch_gate_reviewer ---------------------------------------------------

test('claude launch_gate_reviewer: read-only レビュアの verdict を gate-report へ結線し exit 0（final=approved）', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');

  // Given: pass/pass を返す stub レビュア（GATE_REVIEWER_CMD）と認証キーあり。
  const stubVerdict = PASS_VERDICT;
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

test('gate reviewer credential boundary: GitHub token・caller HOME・git/gh configをAI subprocessへ継承しない', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');
  const stubVerdict = PASS_VERDICT;
  const command = [
    'cat >/dev/null',
    'test -z "${GH_TOKEN:-}"',
    'test -z "${GITHUB_TOKEN:-}"',
    'test "${GIT_CONFIG_GLOBAL:-}" = /dev/null',
    'test "${GH_CONFIG_DIR:-}" != "${CALLER_GH_CONFIG_DIR:-}"',
    'test "$PWD" = "$ASC_REVIEWER_SANITIZED_ROOT/workspace"',
    'test -z "$(find . -mindepth 1 -print -quit)"',
    `printf '%s' '${stubVerdict}'`,
  ].join('; ');
  const env = envWithout([], {
    CLAUDE_AUTH_PROBE_CMD: [
      'test -z "${GH_TOKEN:-}"',
      'test -z "${GITHUB_TOKEN:-}"',
      'test "${GIT_CONFIG_GLOBAL:-}" = /dev/null',
      'test "${GH_CONFIG_DIR:-}" != /credential-bearing/gh',
      'test -z "$(find . -mindepth 1 -print -quit)"',
    ].join(' && '),
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

  const stubVerdict = PASS_VERDICT;
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

// --- T4: codex launch_gate_reviewer（認証不成立 fail-safe） ------------------------------

test('codex launch_gate_reviewer: 認証不成立は gate を approve せず human_required・exit≠0 を返す', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());

  setAdapter(repo.dir, 'codex');
  const unexpectedPass = PASS_VERDICT;
  const env = envWithout([], {
    CODEX_AUTH_PROBE_CMD: 'exit 97',
    CODEX_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${unexpectedPass}'`,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(
    res.status,
    0,
    `認証不成立はexit 0にならないこと。stdout=${res.stdout}; stderr=${res.stderr}; final=${readFinal(reportPath)}`,
  );
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
});

test('codex launch_gate_reviewer: 既定起動はread-only sandboxとhigh-capabilityモデルを使う', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview();
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'codex');

  const stubVerdict = PASS_VERDICT;
  const env = envWithout([], {
    GH_TOKEN: 'ghp_codex_probe_boundary_test_value',
    GITHUB_TOKEN: 'github-codex-probe-boundary-test',
    GH_CONFIG_DIR: '/credential-bearing/gh',
    CODEX_AUTH_PROBE_CMD: [
      'test -z "${GH_TOKEN:-}"',
      'test -z "${GITHUB_TOKEN:-}"',
      'test "${GIT_CONFIG_GLOBAL:-}" = /dev/null',
      'test "${GH_CONFIG_DIR:-}" != /credential-bearing/gh',
      'test -z "$(find . -mindepth 1 -print -quit)"',
    ].join(' && '),
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

  const stubVerdict = PASS_VERDICT;
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

  const stubVerdict = PASS_VERDICT;
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
      GATE_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${PASS_VERDICT}'`,
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
      CODEX_AUTH_PROBE_CMD: 'exit 97',
      CODEX_REVIEWER_CMD: `cat >/dev/null; printf '%s' '${PASS_VERDICT}'`,
      GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    });
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
    assert.notEqual(
      res.status,
      0,
      `Codex認証失敗を伝播すること。stdout=${res.stdout}; stderr=${res.stderr}; final=${readFinal(reportPath)}`,
    );
    assert.notEqual(res.status, 3);
  }
});
