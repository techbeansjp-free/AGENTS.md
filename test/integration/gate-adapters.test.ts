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
function setupGateReview(
  opts: { backend?: CoordinationBackend; env?: NodeJS.ProcessEnv; profile?: 'standard' | 'strict' } = {},
) {
  const { backend = 'local', env = process.env, profile = 'standard' } = opts;
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

  const review = runCli(['gate', 'review', 'ISSUE-1', 'spec', profile], { cwd: worktreePath, env });
  assert.equal(review.status, 0, review.stderr);
  const reportPath = /gate_report_path:\s*(\S+)/.exec(review.stdout)![1];

  return { repo, worktreePath, reportPath, targetSha };
}

function readFinal(reportPath: string): string {
  return (parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string; conformance: string } }).gate.final;
}

/** ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN を必ず除去した env を作る。 */
function envWithout(keys: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of keys) delete env[k];
  return env;
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

test('Strict launcher: 固定2 slotを別invocation・別subprocessで並列起動してtrusted aggregationする (AC-1, AC-3)', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview({ profile: 'strict' });
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-launch-markers-'));
  t.after(() => fs.rmSync(markerDir, { recursive: true, force: true }));

  const stubVerdict =
    '{"conformance":"pass","falsification":"pass","blockers":[],"approved_artifacts":[{"path":"SPEC.md"}]}';
  const reviewerCommand = [
    'mkdir -p "$STRICT_MARKER_DIR"',
    ': > "$STRICT_MARKER_DIR/$ASC_REVIEWER_SLOT"',
    'attempt=0',
    'while [[ ! -f "$STRICT_MARKER_DIR/reviewer-1" || ! -f "$STRICT_MARKER_DIR/reviewer-2" ]]; do',
    '  attempt=$((attempt + 1))',
    '  [[ "$attempt" -lt 200 ]] || exit 4',
    '  sleep 0.01',
    'done',
    'cat >/dev/null',
    `printf '%s' '${stubVerdict}'`,
  ].join('\n');
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy',
    GATE_REVIEWER_CMD: reviewerCommand,
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
    STRICT_MARKER_DIR: markerDir,
  });

  const result = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(markerDir, 'reviewer-1')));
  assert.ok(fs.existsSync(path.join(markerDir, 'reviewer-2')));
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: {
      final: string;
      reviewers: { reviewer_slot: string; invocation_id: string; status: string; final: string }[];
    };
  };
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.reviewers.length, 2);
  assert.equal(new Set(report.gate.reviewers.map((reviewer) => reviewer.invocation_id)).size, 2);
  assert.ok(report.gate.reviewers.every((reviewer) => reviewer.status === 'completed' && reviewer.final === 'approved'));
});

test('Strict launcher: 片方の起動失敗は他方がapprovedでもhuman_requiredへ倒す (AC-2)', async (t) => {
  const { repo, reportPath, targetSha } = setupGateReview({ profile: 'strict' });
  t.after(() => repo.cleanup());
  setAdapter(repo.dir, 'claude');
  const stubVerdict = '{"conformance":"pass","falsification":"pass","blockers":[]}';
  const env = envWithout([], {
    ANTHROPIC_API_KEY: 'dummy',
    GATE_REVIEWER_CMD:
      `cat >/dev/null; if [[ "$ASC_REVIEWER_SLOT" == "reviewer-2" ]]; then exit 1; fi; printf '%s' '${stubVerdict}'`,
    GATE_REVIEWER_RETRIES: '1',
    GATE_REVIEWER_RETRY_INTERVAL_SEC: '0',
  });

  const result = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

  assert.notEqual(result.status, 0);
  assert.notEqual(result.status, 3);
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: { final: string; reviewers: { status: string; final: string }[] };
  };
  assert.equal(report.gate.final, 'human_required');
  assert.equal(report.gate.reviewers.length, 2);
  assert.ok(report.gate.reviewers.some((reviewer) => reviewer.status === 'failed'));
});

test('Strict launcher: human/codexの能力・認証不足を架空の代替へ倒さずhuman_requiredにする (AC-3)', async (t) => {
  for (const adapter of ['human', 'codex'] as const) {
    const { repo, reportPath, targetSha } = setupGateReview({ profile: 'strict' });
    t.after(() => repo.cleanup());
    setAdapter(repo.dir, adapter);
    const env =
      adapter === 'codex'
        ? envWithout(['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'], { CODEX_AUTH_PROBE_CMD: 'false' })
        : process.env;

    const result = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'strict', reportPath, targetSha], env);

    assert.equal(result.status, adapter === 'human' ? 3 : 2, `${adapter}: stderr=${result.stderr}`);
    const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
      gate: { final: string; reviewers: { invocation_id: string; status: string }[] };
    };
    assert.equal(report.gate.final, 'human_required');
    assert.equal(report.gate.reviewers.length, 2);
    assert.equal(new Set(report.gate.reviewers.map((reviewer) => reviewer.invocation_id)).size, 2);
    assert.ok(report.gate.reviewers.every((reviewer) => reviewer.status === 'failed'));
  }
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
  const env = envWithout(['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'], {
    CODEX_AUTH_PROBE_CMD: 'false',
  });

  const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);

  assert.notEqual(res.status, 0, '認証不成立は exit 0（完了）にならないこと');
  assert.notEqual(res.status, 3);
  assert.equal(readFinal(reportPath), 'human_required');
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
    const env = envWithout(['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'], { CODEX_AUTH_PROBE_CMD: 'false' });
    const res = runLauncher(repo.dir, ['ISSUE-1', 'spec', 'standard', reportPath, targetSha], env);
    assert.notEqual(res.status, 0);
    assert.notEqual(res.status, 3);
  }
});
