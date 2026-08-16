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
const GOLDEN_FIXTURE_BASE_SHA = '5a9f3f234fd221cdec49b7885462b27746599b02';
const GOLDEN_FIXTURE_TARGET_SHA = '82241c97d5b973d30b2bdbe8a16f03e3699393ae';

function promptDiffSection(prompt: string): string {
  const match = prompt.match(/## 判定対象の差分\n```diff\n([\s\S]*?)\n```/);
  assert.ok(match, '判定対象の差分セクションが存在すること');
  return match[1];
}

function commitAll(repoDir: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', message], { cwd: repoDir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}

function promptSection(prompt: string, heading: string, nextHeading: string): string {
  const start = prompt.indexOf(`${heading}\n`);
  const end = prompt.indexOf(`\n${nextHeading}`, start + heading.length);
  assert.notEqual(start, -1, `${heading}が存在すること`);
  assert.notEqual(end, -1, `${nextHeading}が存在すること`);
  return prompt.slice(start + heading.length + 1, end);
}

function promptAcIdSection(prompt: string): string {
  const match = prompt.match(
    /## 適用対象の AC-ID（SPEC\.md 由来。全件を conformance 判定で網羅すること）\n([^\n]+)\n\n## conformance/,
  );
  assert.ok(match, '適用対象の AC-ID セクションが存在すること');
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
    light_review?: {
      requested: boolean;
      applied: boolean;
      disabled_reasons: string[];
      remediation_round: number;
      strict_locked: boolean;
    };
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

test('gate record-verdict: lightの再レビュー上限でblockingが残ればhuman_requiredへ打ち切る', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const reportPath = writeReport(
    repo.dir,
    scaffold({
      light_review: {
        requested: true,
        applied: true,
        disabled_reasons: [],
        remediation_round: 1,
        strict_locked: false,
      },
    }),
  );
  const verdict = JSON.stringify({
    conformance: 'fail',
    falsification: 'pass',
    blockers: [{ severity: 'blocking', origin: 'specification', code: 'AC-1', evidence: ['未達'] }],
  });
  const res = runCli(['gate', 'record-verdict', reportPath], { cwd: repo.dir, input: verdict });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readReport(reportPath).gate.final, 'human_required');
});

test('gate record-verdict: light未適用または初回ラウンドには専用打ち切りを適用しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const blocking = JSON.stringify({
    conformance: 'fail',
    falsification: 'pass',
    blockers: [{ severity: 'blocking', origin: 'specification', code: 'AC-1', evidence: ['未達'] }],
  });

  const initial = writeReport(
    repo.dir,
    scaffold({
      light_review: {
        requested: true,
        applied: true,
        disabled_reasons: [],
        remediation_round: 0,
        strict_locked: false,
      },
    }),
  );
  assert.equal(runCli(['gate', 'record-verdict', initial], { cwd: repo.dir, input: blocking }).status, 0);
  assert.equal(readReport(initial).gate.final, 'rejected');

  const notApplied = path.join(repo.dir, 'not-applied.yaml');
  fs.writeFileSync(
    notApplied,
    stringify(
      scaffold({
        light_review: {
          requested: true,
          applied: false,
          disabled_reasons: ['Strict'],
          remediation_round: 1,
          strict_locked: true,
        },
      }),
    ),
  );
  assert.equal(runCli(['gate', 'record-verdict', notApplied], { cwd: repo.dir, input: blocking }).status, 0);
  assert.equal(readReport(notApplied).gate.final, 'rejected');
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

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\n#### AC-1: 認証\n#### AC-2: 認可\n', 'utf8');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add prompt target'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const res = runCli(['gate', 'reviewer-prompt', 'ISSUE-1', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(promptAcIdSection(res.stdout), 'AC-1, AC-2');
  assert.match(res.stdout, /conformance/);
  assert.match(res.stdout, /falsification/);
  assert.match(res.stdout, /origin/);
  assert.match(res.stdout, /read-only/);
});

test('gate reviewer-prompt: 見出し以外と非準拠見出しを除外し、宣言を重複なく数値昇順で列挙する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(
    path.join(repo.dir, 'SPEC.md'),
    [
      '# SPEC',
      '',
      '散文 AC-90',
      '<!-- AC-91 -->',
      '- AC-92',
      '> AC-93',
      '### AC-94: 第3レベル',
      '##### AC-95: 第5レベル',
      '#### AC-96 コロンなし',
      '#### AC-97 : コロン直前に空白',
      '#### AC-10:空白なし',
      '#### AC-2: 2番',
      '#### AC-1: 1番',
      '#### AC-2: 重複',
      '',
    ].join('\n'),
    'utf8',
  );
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add mixed AC declarations'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const result = runCli(['gate', 'reviewer-prompt', 'ISSUE-679', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(promptAcIdSection(result.stdout), 'AC-1, AC-2, AC-10');
});

test('gate reviewer-prompt: 正規宣言が0件なら本文や非準拠見出しの同形文字列を列挙せずhuman_requiredへ倒す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(
    path.join(repo.dir, 'SPEC.md'),
    '# SPEC\n\n散文 AC-1\n<!-- AC-2 -->\n### AC-3: 第3レベル\n#### AC-4 コロンなし\n',
    'utf8',
  );
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add nonconforming AC mentions'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const result = runCli(['gate', 'reviewer-prompt', 'ISSUE-679', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    promptAcIdSection(result.stdout),
    '(SPEC.md から AC-ID を検出できず。conformance は inconclusive とし human_required へ倒すこと)',
  );
});

test('gate reviewer-prompt: light適用時だけ追加のseverityルーブリックを出力する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\n#### AC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add prompt target'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const reportPath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reviews', 'spec.yaml');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    stringify(
      scaffold({
        light_review: {
          requested: true,
          applied: true,
          disabled_reasons: [],
          remediation_round: 0,
          strict_locked: false,
        },
      }),
    ),
  );

  const applied = runCli(['gate', 'reviewer-prompt', 'ISSUE-1', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Lightプロファイル追加ルーブリック/);
  assert.match(applied.stdout, /AC-ID未達の指摘は常にblocking/);
  assert.match(applied.stdout, /セキュリティ・データ喪失・互換性破壊/);

  const report = readReport(reportPath);
  report.gate.light_review!.applied = false;
  fs.writeFileSync(reportPath, stringify(report));
  const disabled = runCli(['gate', 'reviewer-prompt', 'ISSUE-1', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.doesNotMatch(disabled.stdout, /Lightプロファイル追加ルーブリック/);
});

test('gate review: remediationごとに再評価しStrict固定を差分復帰・ラベル除去後も維持する', (t) => {
  const { stub, env, cleanup } = makeGhStub();
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  execFileSync('git', ['checkout', '-b', 'feature/449-review-light-test'], { cwd: repo.dir });
  stub.seedIssueLabels('449', ['review:light', 'risk:normal', 'autonomy:gated']);
  stub.seedIssueEvents('449', [
    {
      event: 'labeled',
      created_at: '2026-08-05T00:00:00Z',
      label: { name: 'review:light' },
      actor: { type: 'User' },
    },
  ]);
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const first = runCli(['gate', 'review', 'ISSUE-449', 'implementation', 'standard', head()], { cwd: repo.dir, env });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /review_profile: standard/);
  assert.match(first.stdout, /reviewer_count: 1/);

  fs.mkdirSync(path.join(repo.dir, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'adr', 'ADR-test.md'), '# test\n');
  execFileSync('git', ['add', 'docs/adr/ADR-test.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add guardrail path'], { cwd: repo.dir });
  const escalated = runCli(['gate', 'review', 'ISSUE-449', 'implementation', 'standard', head()], { cwd: repo.dir, env });
  assert.equal(escalated.status, 0, escalated.stderr);
  assert.match(escalated.stdout, /review_profile: strict/);
  assert.match(escalated.stdout, /reviewer_count: 2/);

  fs.rmSync(path.join(repo.dir, 'docs', 'adr', 'ADR-test.md'));
  execFileSync('git', ['add', '-A'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: remove guardrail path'], { cwd: repo.dir });
  const restored = runCli(['gate', 'review', 'ISSUE-449', 'implementation', 'standard', head()], { cwd: repo.dir, env });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /review_profile: strict/);

  stub.seedIssueLabels('449', ['risk:normal', 'autonomy:gated']);
  const removed = runCli(['gate', 'review', 'ISSUE-449', 'implementation', 'standard', head()], { cwd: repo.dir, env });
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /review_profile: strict/);
  const reportPath = /^gate_report_path: (.+)$/m.exec(removed.stdout)?.[1];
  assert.ok(reportPath);
  const report = readReport(reportPath);
  assert.equal(report.gate.light_review?.requested, false);
  assert.equal(report.gate.light_review?.applied, false);
  assert.equal(report.gate.light_review?.strict_locked, true);
  assert.equal(report.gate.light_review?.remediation_round, 3);
});

test('gate reviewer-prompt: SPEC.md が未埋め込みファイルを名指しで言及しても、その内容を埋め込まず検証不能制約を明示する（Issue #318 回帰）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // spec gate は SPEC.md のみを埋め込む（SEGMENT_ARTIFACTS['spec']）。SPEC.md 本文が
  // 具体的な既存テストファイル名を名指しで言及しても、そのファイル自体はプロンプトへ
  // 埋め込まれない。レビュアがこの未埋め込みファイルの内容を推測・創作して
  // blocking finding の証跡を捏造した実例（Issue #316 PR #317）の再発防止テスト。
  const referencedTestPath = 'test/unit/existing-feature.test.ts';
  const referencedTestContent =
    "import { test } from 'node:test';\ntest('existing behavior that SPEC.md references', () => {});\n";
  fs.mkdirSync(path.join(repo.dir, 'test/unit'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, referencedTestPath), referencedTestContent, 'utf8');
  fs.writeFileSync(
    path.join(repo.dir, 'SPEC.md'),
    `# SPEC\n\n#### AC-1: 既存動作を維持する\n\n既存の ${referencedTestPath} が回帰しないことを確認する。\n`,
    'utf8',
  );
  execFileSync('git', ['add', 'SPEC.md', referencedTestPath], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add spec referencing unembedded file'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const res = runCli(['gate', 'reviewer-prompt', 'ISSUE-1', 'spec', targetSha], { cwd: repo.dir });
  assert.equal(res.status, 0, res.stderr);

  // 制約セクション: 未埋め込みファイルの内容を推測・創作してはならない旨が明示されていること。
  assert.match(res.stdout, /埋め込まれていない参照ファイルの扱い/);
  assert.match(res.stdout, /検証不能/);
  assert.match(res.stdout, /推測.*創作|創作.*推測/);
  assert.match(res.stdout, /固く禁じる/);

  // SPEC.md はファイル名を言及するが、参照先ファイルの実内容そのものは埋め込まれないこと。
  assert.match(res.stdout, new RegExp(referencedTestPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(res.stdout, /existing behavior that SPEC\.md references/);
});

test('gate reviewer-prompt: 新規追加成果物の全文再掲を省略した固定出力とバイト数上限を保つ', (t) => {
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

  const golden = fs.readFileSync(GOLDEN_PROMPT_PATH, 'utf8').trimEnd();
  assert.match(golden, new RegExp(`^- target_sha: ${GOLDEN_FIXTURE_TARGET_SHA}$`, 'm'));
  assert.equal(prompt, golden);
  assert.equal(Buffer.byteLength(prompt, 'utf8'), 3_945);
  assert.equal(prompt.match(/AC-1: deterministic prompt/g)?.length, 1);
  assert.match(prompt, /SPEC\.md（変更種別: 追加、差分: 省略）/);
  assert.doesNotMatch(prompt, /new file mode|\+AC-1: deterministic prompt/);
});

test('gate reviewer-prompt: 既存変更・新規追加・空ファイル・削除の情報をパス単位で保持する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'existing.txt'), 'before\nkept\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'deleted.txt'), 'deleted body\n', 'utf8');
  const baseSha = commitAll(repo.dir, 'test: add implementation prompt base');

  fs.writeFileSync(path.join(repo.dir, 'existing.txt'), 'after\nkept\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'added.txt'), 'added body\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'empty.txt'), '', 'utf8');
  fs.rmSync(path.join(repo.dir, 'deleted.txt'));
  const targetSha = commitAll(repo.dir, 'test: mix implementation prompt changes');

  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-681', 'implementation', targetSha, baseSha],
    { cwd: repo.dir },
  );
  assert.equal(result.status, 0, result.stderr);
  const diffSection = promptSection(result.stdout, '## 判定対象の差分', '## 判定対象の成果物');

  assert.match(diffSection, /added\.txt（変更種別: 追加、差分: 省略）/);
  assert.match(diffSection, /empty\.txt（変更種別: 追加、差分: 省略）/);
  assert.doesNotMatch(diffSection, /diff --git a\/added\.txt|diff --git a\/empty\.txt|\+added body/);
  assert.match(diffSection, /diff --git a\/existing\.txt b\/existing\.txt/);
  assert.match(diffSection, /-before\n\+after/);
  assert.match(diffSection, /diff --git a\/deleted\.txt b\/deleted\.txt/);
  assert.match(diffSection, /-deleted body/);
  const indexLines = diffSection.match(/^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/gm) ?? [];
  assert.ok(indexLines.length > 0, '保持した差分のindex行が存在すること');
  for (const line of indexLines) {
    const match = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: [0-7]{6})?$/);
    assert.ok(match);
    assert.ok(match[1].length === 40 || match[1].length === 64, `old hashが完全長であること: ${line}`);
    assert.equal(match[2].length, match[1].length, `new hashが完全長であること: ${line}`);
  }
  assert.match(result.stdout, /### added\.txt\n```\nadded body\n```/);
  assert.match(result.stdout, /### empty\.txt\n```\n\n```/);
  assert.match(result.stdout, /### deleted\.txt\n\(未検出\)/);
});

test('gate reviewer-prompt: 純粋な改名と内容変更付き改名のrename情報と差分を保持する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'pure-old.txt'), 'pure rename body\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'changed-old.txt'), 'line one\nline two\nline three\n', 'utf8');
  const baseSha = commitAll(repo.dir, 'test: add rename prompt base');

  execFileSync('git', ['mv', 'pure-old.txt', 'pure-new.txt'], { cwd: repo.dir });
  execFileSync('git', ['mv', 'changed-old.txt', 'changed-new.txt'], { cwd: repo.dir });
  fs.writeFileSync(path.join(repo.dir, 'changed-new.txt'), 'line one\nchanged line\nline three\n', 'utf8');
  const targetSha = commitAll(repo.dir, 'test: rename implementation artifacts');

  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-681', 'implementation', targetSha, baseSha],
    { cwd: repo.dir },
  );
  assert.equal(result.status, 0, result.stderr);
  const diffSection = promptDiffSection(result.stdout);

  assert.match(diffSection, /rename from pure-old\.txt\nrename to pure-new\.txt/);
  assert.match(diffSection, /similarity index 100%/);
  assert.match(diffSection, /rename from changed-old\.txt\nrename to changed-new\.txt/);
  assert.match(diffSection, /-line two\n\+changed line/);
  assert.doesNotMatch(result.stdout, /pure-new\.txt（変更種別: 追加、差分: 省略）/);
  assert.doesNotMatch(result.stdout, /changed-new\.txt（変更種別: 追加、差分: 省略）/);
});

test('gate reviewer-prompt: 差分区間を対象成果物へ限定し上流SPECを二重展開しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nupstream before\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'DESIGN.md'), '# DESIGN\n\nbefore\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'PLAN.md'), '# PLAN\n\nstable\n', 'utf8');
  const baseSha = commitAll(repo.dir, 'test: add design prompt base');

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nupstream target unique\n', 'utf8');
  fs.writeFileSync(path.join(repo.dir, 'DESIGN.md'), '# DESIGN\n\nafter\n', 'utf8');
  const targetSha = commitAll(repo.dir, 'test: change design and upstream spec');

  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-681', 'design', targetSha, baseSha],
    { cwd: repo.dir },
  );
  assert.equal(result.status, 0, result.stderr);
  const diffSection = promptDiffSection(result.stdout);
  const upstreamSection = result.stdout.slice(result.stdout.indexOf('## 上流の承認済み成果物'));

  assert.match(diffSection, /diff --git a\/DESIGN\.md b\/DESIGN\.md/);
  assert.doesNotMatch(diffSection, /SPEC\.md|upstream target unique/);
  assert.match(upstreamSection, /upstream target unique/);
  assert.equal(result.stdout.match(/upstream target unique/g)?.length, 1);
});

test('gate reviewer-prompt: implementation対象成果物が空集合なら両区間で明示する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nbefore\n', 'utf8');
  const baseSha = commitAll(repo.dir, 'test: add empty target set base');
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nafter\n', 'utf8');
  const targetSha = commitAll(repo.dir, 'test: change only non-target artifact');

  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-681', 'implementation', targetSha, baseSha],
    { cwd: repo.dir },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /## 判定対象の差分\n\(対象成果物なし\)\n\n## 判定対象の成果物\n\(対象成果物なし\)/,
  );
  assert.equal(result.stdout.match(/after/g)?.length, 1);
});
