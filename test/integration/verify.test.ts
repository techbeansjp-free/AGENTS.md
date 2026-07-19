import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `verify` サブコマンド8種の結合テスト。すべて bin/agents-md.js（ビルド後の実体）に対して
// subprocess実行する。fixtureは createTmpRepo + 実際のCLI呼び出し（issue start / gate review /
// sync templates / checkpoint 等）で組み立て、YAMLの手書きは最小限にとどめる。

function sha256(content: Buffer | string): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

// ---- verify branch-name ----

test('verify branch-name: 明示引数で pattern 適合・違反を判定できる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: branch.pattern（既定 "{type}/{issue_id}-{slug}"）に適合する文字列を明示指定する
  // Then: 実体のbranchが存在せずとも文字列のみで適合と判定される
  const valid = runCli(['verify', 'branch-name', 'feature/1-sample-feature'], { cwd: repo.dir });
  assert.equal(valid.status, 0, valid.stderr);

  // When: pattern に適合しない文字列を渡す
  // Then: 違反として終了コード1・理由をstderrへ出力する
  const invalid = runCli(['verify', 'branch-name', 'not-a-valid-branch'], { cwd: repo.dir });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /branch.pattern/);
});

test('verify branch-name: 引数省略時は現在のHEADブランチを対象にする', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: リポジトリ直下（mainブランチ）で引数を省略する
  // When: verify branch-name を実行する
  // Then: 'main' は type/issue_id-slug 形式ではないため違反になる
  const onMain = runCli(['verify', 'branch-name'], { cwd: repo.dir });
  assert.equal(onMain.status, 1);
  assert.match(onMain.stderr, /'main'/);

  // Given: issue start で作成した worktree に cd し、そのブランチ（feature/1-sample-feature）が
  // 実際にcheckoutされている状態にする
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // When: worktree内（cwd=worktreePath）で引数省略実行する
  // Then: 実HEADブランチが pattern に適合し成功する
  const onWorktree = runCli(['verify', 'branch-name'], { cwd: worktreePath });
  assert.equal(onWorktree.status, 0, onWorktree.stderr);
});

// ---- verify worktree-path ----

test('verify worktree-path: 明示引数で path_pattern 適合・違反を判定できる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // When: issue start が実際に作った worktree のパスを明示指定する
  // Then: worktree.path_pattern に適合し成功する
  const valid = runCli(['verify', 'worktree-path', worktreePath], { cwd: repo.dir });
  assert.equal(valid.status, 0, valid.stderr);

  // When: pattern に適合しない任意のパスを指定する
  // Then: 違反として終了コード1になる
  const invalid = runCli(['verify', 'worktree-path', '/tmp/not-a-valid-worktree'], { cwd: repo.dir });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /worktree\.path_pattern/);
});

test('verify worktree-path: 引数省略時は主worktreeを除外し、issue用worktreeのみを対象にする', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  // Given: git worktree list --porcelain の先頭entryは常にリポジトリ直下の主worktree自身であり、
  //        そのパスは "{issue_created_at}-{type}-{issue_id}-{slug}" 形式に決して適合しない。
  // When: 引数を省略して verify worktree-path を実行する
  // Then: 主worktreeは対象から除外され、適合しているissue用worktreeのみが対象になるため成功する。
  const result = runCli(['verify', 'worktree-path'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify worktree-path: 引数省略時でも、issue用worktreeが規約違反なら検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 規約に適合する名前のissue worktreeが1つ、規約に適合しない名前のworktreeが1つある
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  const badPath = path.join(repo.dir, '.worktrees', 'not-a-valid-worktree-name');
  execFileSync('git', ['worktree', 'add', '-b', 'feature/bad-name', badPath, 'main'], { cwd: repo.dir, stdio: 'pipe' });

  // When: 引数省略で verify worktree-path を実行する
  // Then: 主worktreeは除外されるが、規約違反のworktreeは検出される
  const result = runCli(['verify', 'worktree-path'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`worktree '${escapeRegExp(badPath)}'`));
});

// ---- verify doc-length ----

test('verify doc-length: 既定fixtureは全対象ファイルが上限以内で成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 何も改変していないfixture（AGENTS.md 142行・templates/issue/*.md・adr/ADR.md いずれも
  // 上限以内）に対して実行する
  // Then: 成功する
  const result = runCli(['verify', 'doc-length'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify doc-length: AGENTS.mdの行数超過を検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: AGENTS.md（上限150行）を201行に書き換える
  const longContent = Array.from({ length: 201 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(path.join(repo.dir, 'AGENTS.md'), longContent);

  // When/Then: 上限超過が検出され、終了コード1・具体的な行数がstderrへ出力される
  const agentsViolation = runCli(['verify', 'doc-length'], { cwd: repo.dir });
  assert.equal(agentsViolation.status, 1);
  assert.match(agentsViolation.stderr, /AGENTS\.md: 201行（上限150行を超過）/);
});

test('verify doc-length: templates配下ファイルの行数超過を検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: .agent-skill-chain/templates/issue/SPEC.md（上限100行）を201行に書き換える
  const specTemplatePath = path.join(repo.dir, '.agent-skill-chain', 'templates', 'issue', 'SPEC.md');
  const longContent = Array.from({ length: 201 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(specTemplatePath, longContent);

  // When/Then: 上限超過が検出される
  const result = runCli(['verify', 'doc-length'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /templates[/\\]issue[/\\]SPEC\.md: 201行（上限100行を超過）/);
});

// ---- verify artifacts ----

test('verify artifacts: spec segmentはSPEC.mdの有無で成否が切り替わる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given/When: worktreeにSPEC.mdを作成する前
  // Then: spec segmentの必須成果物欠落として失敗する
  const before = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);

  // When: worktree内にSPEC.mdを作成する
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');

  // Then: 成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);
});

test('verify artifacts: design segmentはDESIGN.md/ADR/PLAN.mdすべて揃って初めて成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given/When: DESIGN.md・ADR（docs/adr/*.md）・PLAN.mdのいずれも無い状態
  // Then: 3件とも欠落として報告される
  const before = runCli(['verify', 'artifacts', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /欠落しています: DESIGN\.md/);
  assert.match(before.stderr, /欠落しています: ADR/);
  assert.match(before.stderr, /欠落しています: PLAN\.md/);

  // When: 3成果物をすべて作成する（ADRはdocs/adr/配下に1つ以上の.mdファイルがあればよい）
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN\n');
  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN\n');
  fs.mkdirSync(path.join(worktreePath, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'docs', 'adr', 'ADR-0001-sample.md'), '# ADR\n');

  // Then: 成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);
});

test('verify artifacts: implementation segmentはdefaultBranchとの差分（コード）とVALIDATION.mdの両方を要求する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given/When: mainからの差分（docs等を除く）が無く、VALIDATION.mdも無い状態
  // Then: code・unit_test_results の両方が欠落として報告される
  const before = runCli(['verify', 'artifacts', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /欠落しています: code/);
  assert.match(before.stderr, /欠落しています: unit_test_results/);

  // When: worktree内にコードファイルを追加しcheckpoint（add+commit+push）する。
  // unit_test_results/acceptance_test_results/regression_test_results はVALIDATION.mdの存在で
  // 代替確認されるため、それも作成する。
  fs.mkdirSync(path.join(worktreePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'src', 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(worktreePath, 'VALIDATION.md'), '# VALIDATION\n');
  const checkpoint = runCli(['checkpoint', 'feat: add app.js'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  // Then: 成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);
});

test('verify artifacts: validation segmentはVALIDATION.mdの有無で成否が切り替わり、不正segmentやissue不在はエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given/When: VALIDATION.md が無い状態（acceptance_test_results/regression_test_resultsが代替確認する）
  // Then: 欠落として失敗する（pr は常にtrue扱いのため報告されない）
  const before = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /欠落しています: acceptance_test_results/);
  assert.match(before.stderr, /欠落しています: regression_test_results/);
  assert.doesNotMatch(before.stderr, /: pr\b/);

  // When: VALIDATION.md を作成する
  fs.writeFileSync(path.join(worktreePath, 'VALIDATION.md'), '# VALIDATION\n');

  // Then: 成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);

  // segments.yaml に定義の無い不正segment名はCliErrorとして失敗する
  const badSegment = runCli(['verify', 'artifacts', 'ISSUE-1', 'bogus-segment'], { cwd: repo.dir });
  assert.equal(badSegment.status, 1);
  assert.match(badSegment.stderr, /segment は spec\|design\|implementation\|validation のいずれか/);

  // worktreeが存在しないissue_idは失敗する
  const unknownIssue = runCli(['verify', 'artifacts', 'ISSUE-999', 'spec'], { cwd: repo.dir });
  assert.equal(unknownIssue.status, 1);
  assert.match(unknownIssue.stderr, /ISSUE-999 の worktree が見つかりません/);
});

// ---- verify gate-report ----

test('verify gate-report: スキーマ適合・digest一致のgate-reportは成功し、pending/digest不一致は失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');

  // Given: gate review で白紙スキャフォールドを取得する（conformance/falsification/final は pending）
  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch);
  const gateReportPath = gateReportPathMatch![1];

  // When: pendingのまま検証する
  // Then: conformance/falsification/final すべてがpendingのまま、として失敗する
  const pending = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /gate\.conformance が pending のままです/);
  assert.match(pending.stderr, /gate\.falsification が pending のままです/);
  assert.match(pending.stderr, /gate\.final が pending のままです/);

  // When: 承認済みに書き換え、approved_artifacts にSPEC.mdの実digestを対応付ける
  const specDigest = sha256(fs.readFileSync(path.join(worktreePath, 'SPEC.md')));
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace('approved_artifacts: []', `approved_artifacts:\n    - path: SPEC.md\n      digest: ${specDigest}`);
  fs.writeFileSync(gateReportPath, approvedText);

  // Then: 成功する
  const approved = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(approved.status, 0, approved.stderr);

  // When: 承認後にSPEC.mdの内容を書き換える（approved_artifactsのdigestは古いまま）
  fs.appendFileSync(path.join(worktreePath, 'SPEC.md'), 'AC-2: extra\n');

  // Then: digest不一致として失敗する
  const stale = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /approved_artifacts の digest が現在のファイル内容と一致しません: SPEC\.md/);
});

// ---- verify template-sync ----

test('verify template-sync: 未同期・同期後の一致・再改変による差分検出をすべて確認する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: .github/ が存在しない状態
  // Then: templates/github/.github 配下の全ファイルが欠落として報告される
  const before = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /未同期（欠落）: CODEOWNERS/);

  // When: sync templates で同期する
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  // Then: 差分0で成功する
  const afterSync = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(afterSync.status, 0, afterSync.stderr);

  // When: 同期済みファイルの内容を改変する
  fs.appendFileSync(path.join(repo.dir, '.github', 'CODEOWNERS'), '\n# modified\n');

  // Then: 差分ありとして再検出される
  const afterEdit = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(afterEdit.status, 1);
  assert.match(afterEdit.stderr, /未同期（差分あり）: CODEOWNERS/);
});

// ---- verify adr ----

test('verify adr: 実物ADR（ADR-0001）は違反0で成功する', async () => {
  // Given/When: 実際にリポジトリに存在するADR-0001（docs/adr/）に対して検証する
  // Then: 構造・ライフサイクル項目すべてを満たし成功する
  const result = runCli(['verify', 'adr', 'docs/adr/ADR-0001-docs-system-spec-construction.md']);
  assert.equal(result.status, 0, result.stderr);
});

test('verify adr: フロントマター欠落・必須セクション欠落・不正statusを検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: supersedes/superseded-byを欠き、Decision/Consequencesが無く、statusが不正値のADR
  const badAdrPath = path.join(repo.dir, 'bad-adr.md');
  fs.writeFileSync(
    badAdrPath,
    [
      '# ADR',
      '',
      '```yaml',
      'id: ADR-0002',
      'status: unknown-status',
      'title: bad',
      'tags: []',
      '```',
      '',
      '## Context',
      'missing decision and consequences sections',
      '',
    ].join('\n'),
  );

  // When/Then: 5件の違反すべてが検出される
  const result = runCli(['verify', 'adr', badAdrPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /フロントマターに 'supersedes:' がありません/);
  assert.match(result.stderr, /フロントマターに 'superseded-by:' がありません/);
  assert.match(result.stderr, /必須セクション '## Decision' がありません/);
  assert.match(result.stderr, /必須セクション '## Consequences' がありません/);
  assert.match(result.stderr, /不正な status です: unknown-status/);
});

// ---- verify ac-coverage ----

test('verify ac-coverage: SPEC.mdとVALIDATION.mdが完全対応していれば成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: SPEC.mdにAC-1・AC-2を定義し、VALIDATION.mdで両方に検証方法・証跡を対応付ける
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\nAC-2: 別のサンプル\n');
  fs.writeFileSync(
    path.join(worktreePath, 'VALIDATION.md'),
    [
      'schema_version: agent-skill-chain/validation-report/v1',
      'issue_id: ISSUE-1',
      'target_sha: abc123',
      'acceptance_criteria:',
      '  - ac_id: AC-1',
      '    verification: {mode: automated, result: pass}',
      "    evidence: ['test/ac1.spec.ts']",
      '  - ac_id: AC-2',
      '    verification: {mode: automated, result: pass}',
      "    evidence: ['test/ac2.spec.ts']",
      '',
    ].join('\n'),
  );

  // When/Then: 孤児AC・孤児テスト参照が無く成功する
  const result = runCli(['verify', 'ac-coverage', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify ac-coverage: 孤児AC・孤児テスト参照・evidence空をそれぞれ検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: SPEC.mdはAC-1・AC-2を定義するが、VALIDATION.mdはAC-1しか対応しない（AC-2は孤児AC）
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\nAC-2: 別のサンプル\n');
  fs.writeFileSync(
    path.join(worktreePath, 'VALIDATION.md'),
    [
      'schema_version: agent-skill-chain/validation-report/v1',
      'issue_id: ISSUE-1',
      'target_sha: abc123',
      'acceptance_criteria:',
      '  - ac_id: AC-1',
      '    verification: {mode: automated, result: pass}',
      "    evidence: ['test/ac1.spec.ts']",
      '',
    ].join('\n'),
  );

  // When/Then: AC-2 が孤児ACとして検出される
  const orphanAc = runCli(['verify', 'ac-coverage', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(orphanAc.status, 1);
  assert.match(orphanAc.stderr, /孤児AC: AC-2 が VALIDATION\.md に対応していません/);

  // Given: VALIDATION.mdがSPEC.mdに存在しないAC-3を参照し、かつAC-1のevidenceが空になる
  fs.writeFileSync(
    path.join(worktreePath, 'VALIDATION.md'),
    [
      'schema_version: agent-skill-chain/validation-report/v1',
      'issue_id: ISSUE-1',
      'target_sha: abc123',
      'acceptance_criteria:',
      '  - ac_id: AC-1',
      '    verification: {mode: automated, result: pass}',
      '    evidence: []',
      '  - ac_id: AC-2',
      '    verification: {mode: automated, result: pass}',
      "    evidence: ['test/ac2.spec.ts']",
      '  - ac_id: AC-3',
      '    verification: {mode: automated, result: pass}',
      "    evidence: ['test/ac3.spec.ts']",
      '',
    ].join('\n'),
  );

  // When/Then: 孤児テスト参照（AC-3）とevidence空（AC-1）の両方が検出される
  const orphanRefAndEmptyEvidence = runCli(['verify', 'ac-coverage', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(orphanRefAndEmptyEvidence.status, 1);
  assert.match(orphanRefAndEmptyEvidence.stderr, /孤児テスト参照: AC-3 は SPEC\.md に存在しません/);
  assert.match(orphanRefAndEmptyEvidence.stderr, /AC-1: evidence が空です/);
});
