import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { createTmpRepo, unsetAdapter } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// #164-② gate判定ステップの CLI 層（src/commands/gate.ts）を検証する:
//   - publish の終了状態判定を final 基準へ精緻化（T1）
//   - record-verdict（レビュア verdict を pending gate-report へ結線・final を機械導出）
//   - mark-human-required（フェイルセーフ書込み・I8）
//   - reviewer-context / reviewer-prompt（判定ステップ・アダプタ・判定プロトコルの入力）

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const GOLDEN_PROMPT_PATH = fileURLToPath(new URL('../fixtures/gate-reviewer-prompt-golden.txt', import.meta.url));
const GOLDEN_PROMPT_TARGET_SHA = '5518ddbf398e86558f01d1dfb0e596b014fa3810';
const GOLDEN_FIXTURE_BASE_SHA = '5a9f3f234fd221cdec49b7885462b27746599b02';
const GOLDEN_FIXTURE_TARGET_SHA = '82241c97d5b973d30b2bdbe8a16f03e3699393ae';

function normalizeDiffIndexHashes(prompt: string): string {
  return prompt.replace(/^index [0-9a-f]+\.\.[0-9a-f]+(?= |$)/gm, 'index <old>..<new>');
}

function promptDiffSection(prompt: string): string {
  const match = prompt.match(/## 判定対象の差分\n```diff\n([\s\S]*?)\n```/);
  assert.ok(match, '判定対象の差分セクションが存在すること');
  return match[1];
}

interface GateReport {
  schema_version: string;
  gate: {
    id: string;
    target_sha: string;
    conformance: string;
    falsification: string;
    final: string;
    blockers: { severity: string; origin: string; code: string; evidence: string[] }[];
    approved_digest: string;
    approved_artifacts: { path: string; digest: string }[];
  };
}

function scaffold(overrides: Partial<GateReport['gate']> = {}): GateReport {
  return {
    schema_version: 'agent-skill-chain/gate-report/v1',
    gate: {
      id: 'spec',
      target_sha: 'abc123',
      conformance: 'pending',
      falsification: 'pending',
      final: 'pending',
      blockers: [],
      approved_digest: ZERO_DIGEST,
      approved_artifacts: [],
      ...overrides,
    },
  };
}

/** repo.dir 直下へ schema 準拠の gate-report を書き、絶対パスを返す。 */
function writeReport(repoDir: string, report: GateReport): string {
  const p = path.join(repoDir, 'report.yaml');
  fs.writeFileSync(p, stringify(report), 'utf8');
  return p;
}

function readReport(p: string): GateReport {
  return parse(fs.readFileSync(p, 'utf8')) as GateReport;
}

function makeGhStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-judgment-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

interface CheckRunRecord {
  name: string;
  head_sha: string;
  conclusion: string;
}

// --- T1: publish の final 基準精緻化 -------------------------------------------------

test('gate publish: final=pending（真に未レビュー）は拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold({ final: 'pending' }));
  const res = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir });

  assert.notEqual(res.status, 0, 'final=pending は publish 拒否されること');
  assert.match(res.stderr, /未レビュー/);
});

test('gate publish: human_required は sub-verdict が pending でも拒否されず action_required を発行する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: final=human_required・conformance/falsification は pending（非同期 human レビューの表明）。
  const reportPath = writeReport(
    repo.dir,
    scaffold({ final: 'human_required', conformance: 'pending', falsification: 'pending' }),
  );

  // When: gate publish（github バックエンド）。
  const res = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir, env });

  // Then: 拒否されず、conclusion=action_required の Check Run が発行されること。
  assert.equal(res.status, 0, res.stderr);
  const checkRuns = (stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? [];
  assert.equal(checkRuns.length, 1);
  assert.equal(checkRuns[0].conclusion, 'action_required');
});

test('gate publish: final=approved だが falsification=fail は矛盾として拒否される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold({ final: 'approved', conformance: 'pass', falsification: 'fail' }));
  const res = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir });

  assert.notEqual(res.status, 0, 'approved なのに両 pass でない gate-report は拒否されること');
  assert.match(res.stderr, /矛盾/);
});

test('gate publish: final=rejected は failure、approved(両pass) は success を発行する', async (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const rejectedPath = writeReport(
    repo.dir,
    scaffold({ final: 'rejected', conformance: 'fail', falsification: 'pass' }),
  );
  const rejected = runCli(['gate', 'publish', 'ISSUE-1', rejectedPath], { cwd: repo.dir, env });
  assert.equal(rejected.status, 0, rejected.stderr);

  const approvedReport = scaffold({ final: 'approved', conformance: 'pass', falsification: 'pass' });
  const approvedPath = path.join(repo.dir, 'approved.yaml');
  fs.writeFileSync(approvedPath, stringify(approvedReport), 'utf8');
  const approved = runCli(['gate', 'publish', 'ISSUE-1', approvedPath], { cwd: repo.dir, env });
  assert.equal(approved.status, 0, approved.stderr);

  const checkRuns = (stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? [];
  assert.deepEqual(
    checkRuns.map((r) => r.conclusion),
    ['failure', 'success'],
  );
});

// --- record-verdict: verdict → gate-report 結線と final 機械導出 -----------------------

test('gate record-verdict: pass/pass の verdict は final=approved で結線される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold());
  const verdict = JSON.stringify({ conformance: 'pass', falsification: 'pass', blockers: [] });
  const res = runCli(['gate', 'record-verdict', reportPath], { cwd: repo.dir, input: verdict });

  assert.equal(res.status, 0, res.stderr);
  const report = readReport(reportPath);
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.conformance, 'pass');
  assert.equal(report.gate.falsification, 'pass');
});

test('gate record-verdict: blocking finding を含む verdict は final=rejected で origin が保持される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold({ id: 'design' }));
  const verdict = JSON.stringify({
    conformance: 'fail',
    falsification: 'pass',
    blockers: [{ severity: 'blocking', origin: 'design', code: 'AC-2-uncovered', evidence: ['AC-2 未対応'] }],
  });
  const res = runCli(['gate', 'record-verdict', reportPath], { cwd: repo.dir, input: verdict });

  assert.equal(res.status, 0, res.stderr);
  const report = readReport(reportPath);
  assert.equal(report.gate.final, 'rejected');
  assert.equal(report.gate.blockers[0].origin, 'design');
});

test('gate record-verdict: inconclusive の verdict は silent pass せず final=human_required になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold());
  const verdict = JSON.stringify({ conformance: 'pass', falsification: 'pass', inconclusive: true });
  const res = runCli(['gate', 'record-verdict', reportPath], { cwd: repo.dir, input: verdict });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readReport(reportPath).gate.final, 'human_required');
});

test('gate record-verdict: approved_artifacts のパスは artifact_base_dir から digest を算出して記録する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const baseDir = path.join(repo.dir, 'issues', '1');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n', 'utf8');

  const reportPath = writeReport(repo.dir, scaffold());
  const verdict = JSON.stringify({
    conformance: 'pass',
    falsification: 'pass',
    approved_artifacts: [{ path: 'SPEC.md' }],
  });
  const res = runCli(['gate', 'record-verdict', reportPath, baseDir], { cwd: repo.dir, input: verdict });

  assert.equal(res.status, 0, res.stderr);
  const report = readReport(reportPath);
  assert.equal(report.gate.approved_artifacts[0].path, 'SPEC.md');
  assert.match(report.gate.approved_artifacts[0].digest, /^sha256:[0-9a-f]{64}$/);
});

test('gate record-verdict: Strictの独立2 verdictがともにpassの場合だけapprovedになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold());
  const verdicts = JSON.stringify([
    { conformance: 'pass', falsification: 'pass', blockers: [] },
    { conformance: 'pass', falsification: 'pass', blockers: [] },
  ]);
  const res = runCli(['gate', 'record-verdict', reportPath, repo.dir, '2'], {
    cwd: repo.dir,
    input: verdicts,
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readReport(reportPath).gate.final, 'approved');
});

test('gate record-verdict: Strictの独立verdictに1件でもfailがあればrejectedになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold());
  const verdicts = JSON.stringify([
    { conformance: 'pass', falsification: 'pass', blockers: [] },
    {
      conformance: 'pass',
      falsification: 'fail',
      blockers: [
        {
          severity: 'blocking',
          origin: 'implementation',
          code: 'STRICT-COUNTEREXAMPLE',
          evidence: ['独立レビュア2が反例を検出'],
        },
      ],
    },
  ]);
  const res = runCli(['gate', 'record-verdict', reportPath, repo.dir, '2'], {
    cwd: repo.dir,
    input: verdicts,
  });

  assert.equal(res.status, 0, res.stderr);
  const report = readReport(reportPath);
  assert.equal(report.gate.final, 'rejected');
  assert.equal(report.gate.falsification, 'fail');
  assert.equal(report.gate.blockers[0].code, 'STRICT-COUNTEREXAMPLE');
});

test('gate record-verdict: Strictの独立verdictが規定件数に満たない場合は書込みを拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold());
  const verdicts = JSON.stringify([{ conformance: 'pass', falsification: 'pass', blockers: [] }]);
  const res = runCli(['gate', 'record-verdict', reportPath, repo.dir, '2'], {
    cwd: repo.dir,
    input: verdicts,
  });

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /expected=2, actual=1/);
  assert.equal(readReport(reportPath).gate.final, 'pending');
});

// --- mark-human-required: フェイルセーフ書込み ----------------------------------------

test('gate mark-human-required: final を human_required に倒す（sub-verdict は据え置き）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(repo.dir, scaffold({ conformance: 'pending', falsification: 'pending' }));
  const res = runCli(['gate', 'mark-human-required', reportPath], { cwd: repo.dir });

  assert.equal(res.status, 0, res.stderr);
  const report = readReport(reportPath);
  assert.equal(report.gate.final, 'human_required');
  assert.equal(report.gate.conformance, 'pending');
});

// --- reviewer-context / reviewer-prompt ------------------------------------------------

test('gate reviewer-context: adapter/backend/issue_number/base_dir を出力する（既定 adapter=claude）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // review.adapter を config から取り除き、本物のリポジトリ側の現在値ではなく
  // CLI の既定値フォールバック（未設定時 claude）を検証する。
  unsetAdapter(repo.dir);

  const res = runCli(['gate', 'reviewer-context', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^adapter=claude$/m);
  assert.match(res.stdout, /^backend=local$/m);
  assert.match(res.stdout, /^issue_number=1$/m);
  assert.match(res.stdout, /^base_dir=/m);
  assert.match(res.stdout, /^core_review_required=false$/m);
  assert.match(res.stdout, /^core_review_status=resolved$/m);
});

test('gate reviewer-context: 明示core_auditはStrictとadapter別能力要求を出力する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const res = runCli(
    ['gate', 'reviewer-context', 'ISSUE-1', 'deadbeef', 'main', 'core_audit'],
    { cwd: repo.dir },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^core_review_required=true$/m);
  assert.match(res.stdout, /^core_review_status=resolved$/m);
  assert.match(res.stdout, /^core_required_profile=strict$/m);
  assert.match(res.stdout, /^core_model_tier=frontier_coding$/m);
  assert.match(res.stdout, /^core_reasoning_tier=maximum_reasoning$/m);
  assert.match(res.stdout, /^codex_required_model=gpt-5\.6-sol$/m);
  assert.match(res.stdout, /^codex_required_reasoning_effort=xhigh$/m);
});

test('gate reviewer-context: GitHub core reviewも明示adapterを保ちCIは証跡検証専用になる', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());

  const res = runCli(
    ['gate', 'reviewer-context', 'ISSUE-1', 'deadbeef', 'main', 'core_audit'],
    { cwd: repo.dir },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^adapter=claude$/m);
  assert.match(res.stdout, /^core_reviewer_location=local$/m);
  assert.match(res.stdout, /^core_evidence_transport=github_pr_review$/m);
  assert.match(res.stdout, /^core_ci_role=verify_and_publish$/m);
  assert.match(res.stdout, /^core_reviewer_count=2$/m);
});

test('gate reviewer-prompt: AC-ID・conformance/falsification ルーブリック・出力 JSON 契約を含む', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: 認証\nAC-2: 認可\n', 'utf8');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add prompt target'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const res = runCli(['gate', 'reviewer-prompt', 'ISSUE-1', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /AC-1, AC-2/);
  assert.match(res.stdout, /conformance/);
  assert.match(res.stdout, /falsification/);
  assert.match(res.stdout, /origin/);
  assert.match(res.stdout, /read-only/);
});

test('gate reviewer-prompt: 全index行をfull hashで出力し、hash表記以外は修正前goldenと一致する', (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-reviewer-prompt-golden-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));
  execFileSync('git', ['init', '--initial-branch=main', '--object-format=sha1'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'agent-skill-chain test'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });

  const baseEnv = {
    ...process.env,
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  execFileSync('git', ['commit', '--allow-empty', '-m', 'test: golden base'], {
    cwd: repoDir,
    env: baseEnv,
    stdio: 'pipe',
  });
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  assert.equal(baseSha, GOLDEN_FIXTURE_BASE_SHA);

  fs.writeFileSync(path.join(repoDir, 'SPEC.md'), '# SPEC\n\nAC-1: deterministic prompt\n', 'utf8');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'test: golden target'], {
    cwd: repoDir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2000-01-01T00:00:01Z',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:01Z',
    },
    stdio: 'pipe',
  });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  assert.equal(targetSha, GOLDEN_FIXTURE_TARGET_SHA);

  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-369', 'spec', targetSha, baseSha],
    { cwd: repoDir },
  );
  assert.equal(result.status, 0, result.stderr);
  const prompt = result.stdout.trimEnd();
  assert.match(prompt, new RegExp(`^- target_sha: ${targetSha}$`, 'm'));

  const diffSection = promptDiffSection(prompt);
  const indexLines = diffSection.match(/^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/gm) ?? [];
  assert.ok(indexLines.length > 0, 'diff区間にindex行が存在すること');
  for (const line of indexLines) {
    const match = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: [0-7]{6})?$/);
    assert.ok(match);
    assert.ok(match[1].length === 40 || match[1].length === 64, `old hashが完全長であること: ${line}`);
    assert.equal(match[2].length, match[1].length, `new hashが完全長であること: ${line}`);
  }

  const golden = fs.readFileSync(GOLDEN_PROMPT_PATH, 'utf8').trimEnd();
  assert.match(golden, new RegExp(`^- target_sha: ${GOLDEN_PROMPT_TARGET_SHA}$`, 'm'));
  const promptWithGoldenTarget = prompt.replace(
    `- target_sha: ${targetSha}`,
    `- target_sha: ${GOLDEN_PROMPT_TARGET_SHA}`,
  );
  assert.equal(normalizeDiffIndexHashes(promptWithGoldenTarget), normalizeDiffIndexHashes(golden));
});
