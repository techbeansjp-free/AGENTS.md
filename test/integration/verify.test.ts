import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
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

// 実際の actions/checkout@v4 が pull_request イベントで作る detached HEAD 状態
// （`switching to 'refs/remotes/pull/<n>/merge'`）を `git checkout --detach <sha>` で再現し、
// `verify branch-name` の引数省略時の解決を検証する（PR #172 run 29714290922 で実落ち）。

test('verify branch-name: 引数省略・detached HEAD状態でもGITHUB_HEAD_REFが設定されていればそのブランチ名で判定する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', sha], { cwd: worktreePath, stdio: 'pipe' });
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    'HEAD',
    '前提: detached HEAD状態を再現できていること',
  );

  // Given: GITHUB_HEAD_REF が実際のブランチ名（pattern適合）で設定されている
  // When: 引数省略・detached HEADで実行する
  // Then: GITHUB_HEAD_REF経由で解決したブランチ名が pattern に適合し成功する
  const withHeadRef = runCli(['verify', 'branch-name'], {
    cwd: worktreePath,
    env: { ...process.env, GITHUB_HEAD_REF: 'feature/1-sample-feature' },
  });
  assert.equal(withHeadRef.status, 0, withHeadRef.stderr);
});

test('verify branch-name: 引数省略・detached HEAD状態でGITHUB_HEAD_REFが未設定なら解決不能として明確なエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', sha], { cwd: worktreePath, stdio: 'pipe' });

  // Given: GITHUB_HEAD_REF を明示的に未設定にする
  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).GITHUB_HEAD_REF;

  // When: 引数省略・detached HEAD・GITHUB_HEAD_REF未設定で実行する
  // Then: ブランチ名を解決できない旨の明確なエラーで終了コード1になる（スタックトレースやTypeErrorではない）
  const result = runCli(['verify', 'branch-name'], { cwd: worktreePath, env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /現在のブランチ名を解決できません/);
});

// Issue #174 AC-6: issue.allowed_types に chore を追加したことで、このリポジトリ自身に実在する
// `chore/162-agent-skill-chain-bootstrap` ブランチが verify branch-name で適合すること
// （自プロジェクトが自身の規約検査に違反するという自己矛盾の解消）を確認する。
test('verify branch-name: issue.allowed_typesにchoreを追加後、chore/162-agent-skill-chain-bootstrapが終了コード0になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['verify', 'branch-name', 'chore/162-agent-skill-chain-bootstrap'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

// Issue #174 AC-7: chore追加後も既存許容type（feature等）は引き続き成功し、許容外type
// （invalidtype等）は引き続き失敗する（regressionなし）ことを確認する。
test('verify branch-name: chore追加後も既存許容typeは成功し、許容外typeは引き続き失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  for (const validBranch of [
    'feature/1-sample-feature',
    'bugfix/2-sample-bugfix',
    'hotfix/3-sample-hotfix',
    'refactor/4-sample-refactor',
    'docs/5-sample-docs',
    'process/6-sample-process',
    'chore/7-sample-chore',
  ]) {
    const result = runCli(['verify', 'branch-name', validBranch], { cwd: repo.dir });
    assert.equal(result.status, 0, `${validBranch}: ${result.stderr}`);
  }

  const invalid = runCli(['verify', 'branch-name', 'invalidtype/8-sample'], { cwd: repo.dir });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /branch\.pattern/);
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

// PR #172 run 29717941752 で実落ち: agent-skill-chain-ci.yml の actions/checkout@v4 はPRの
// マージrefのみをフェッチし、baseブランチ（GITHUB_BASE_REF）自体はローカルに一切存在しないため、
// `verify artifacts <issue> implementation` の code 判定（git diff base...HEAD）がref解決不能で
// 失敗し「成果物なし」と誤判定していた。以下は .worktrees/型レイアウトを使わない単一checkout
// （actions/checkoutを模す。findIssueWorktreeのCIフォールバック経路）+ 実際のbare remoteへの
// push・remote-trackingrefの明示的削除でshallow checkout相当を再現し、
// ワークフロー側の修正（git fetch origin "$BASE_REF" --depth=1）を適用する前後でこのバグと
// その解消の両方を検証する。
test('verify artifacts: 単一checkout（CI相当）でbaseブランチ未フェッチだとcode判定が失敗し、base branch fetch後は成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  function gitIn(args: string[]): void {
    execFileSync('git', args, { cwd: repo.dir, stdio: 'pipe' });
  }

  const base = 'chore/162-agent-skill-chain-bootstrap';
  gitIn(['checkout', '-b', base]);
  fs.writeFileSync(path.join(repo.dir, 'BASE_ONLY.md'), '# base\n');
  gitIn(['add', '-A']);
  gitIn(['commit', '-m', 'chore: base-only change']);
  gitIn(['push', 'origin', base]);

  // actions/checkout は git worktree add を使わないため、.worktrees/型レイアウトは作らず
  // 単一checkoutのブランチ名自体がissue 171の作業ブランチになる状態を再現する。
  gitIn(['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  fs.mkdirSync(path.join(repo.dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'src', 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(repo.dir, 'VALIDATION.md'), '# VALIDATION\n');
  gitIn(['add', '-A']);
  gitIn(['commit', '-m', 'feat: add app.js']);

  gitIn(['branch', '-D', 'main']);
  gitIn(['branch', '-D', base]);
  // push した側のリポジトリは remote-tracking ref (origin/<base>) を自動更新してしまうため、
  // 「actions/checkout がPRのマージrefのみをフェッチしbaseブランチ自体は一切フェッチしていない」
  // 状態を明示的に再現するために削除する。
  gitIn(['branch', '-rd', `origin/${base}`]);

  const env = { ...process.env, GITHUB_BASE_REF: base };

  // Given/When: baseブランチが一切フェッチされていない状態（今回のワークフロー修正前を再現）
  // Then: code の diff 判定がref解決不能で失敗し「欠落」と誤判定される
  const before = runCli(['verify', 'artifacts', 'ISSUE-171', 'implementation'], { cwd: repo.dir, env });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /欠落しています: code/);

  // When: ワークフロー側の修正（`git fetch origin "$BASE_REF" --depth=1`）を適用する
  gitIn(['fetch', 'origin', base, '--depth=1']);

  // Then: origin/<base> が解決可能になり、code の diff 判定も成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-171', 'implementation'], { cwd: repo.dir, env });
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
  // Then: 欠落として失敗する（pr はIssue #174でsegments.yamlのoutputsから除去済みのため報告されない）
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

// ISSUE-176 AC-4: 承認済み成果物が削除された場合も digest 不一致として検知されること
// （旧実装は `fs.existsSync(abs) && digestOfFile(abs) !== artifact.digest` という条件式のため、
// existsSync が false の場合は条件全体がfalseになり検知が完全にスキップされていた）。
test('verify gate-report (ISSUE-176 AC-4): 承認済み成果物が削除されている場合はdigest不一致として検知される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  // Given: SPEC.mdをapproved_artifactsに対応付け、承認済みにする。
  const specDigest = sha256(fs.readFileSync(path.join(worktreePath, 'SPEC.md')));
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace('approved_artifacts: []', `approved_artifacts:\n    - path: SPEC.md\n      digest: ${specDigest}`);
  fs.writeFileSync(gateReportPath, approvedText);

  // 削除前は成功すること（regressionの前提確認）。
  const beforeDelete = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(beforeDelete.status, 0, beforeDelete.stderr);

  // When: 承認後にSPEC.md自体を削除する（内容変更ではなく削除）。
  fs.unlinkSync(path.join(worktreePath, 'SPEC.md'));

  // Then: 削除もdigest不一致として検知され、失敗すること（AC-4）。
  const afterDelete = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(afterDelete.status, 1);
  assert.match(afterDelete.stderr, /approved_artifacts のファイルが削除されています（digest不一致として扱います）: SPEC\.md/);
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

// ---- verify adr: finalize経路ガード（Issue #188 AC-7/AC-8） ----
//
// status: accepted のADRについて、statusをacceptedへ遷移させたcommitが
// `adr finalize` CLI（正規経路）の署名（固定commitメッセージ・単一ファイル変更・status行のみの差分）
// を満たすかを検証する。

function adrFixtureText(status: string): string {
  return [
    '# ADR',
    '',
    '```yaml',
    'id: ADR-0001',
    `status: ${status}`,
    'title: サンプル決定',
    'tags: []',
    'supersedes: []',
    'superseded-by: null',
    'deprecated-reason: null',
    '```',
    '',
    '## Context',
    '',
    'サンプルの背景・制約。',
    '',
    '## Decision',
    '',
    'サンプルの決定内容。',
    '',
    '## Consequences',
    '',
    'サンプルの影響。',
    '',
  ].join('\n');
}

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** issue start して worktree に docs/adr/ADR-0001-sample.md（status: proposed）をcommit済みで配置する。 */
function setupCommittedProposedAdr(): { repo: ReturnType<typeof createTmpRepo>; worktreePath: string; adrRelPath: string } {
  const repo = createTmpRepo({ backend: 'local' });
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const adrDir = path.join(worktreePath, 'docs', 'adr');
  fs.mkdirSync(adrDir, { recursive: true });
  const adrRelPath = path.join('docs', 'adr', 'ADR-0001-sample.md');
  fs.writeFileSync(path.join(worktreePath, adrRelPath), adrFixtureText('proposed'));
  gitIn(worktreePath, ['add', adrRelPath]);
  gitIn(worktreePath, ['commit', '-m', 'feat(1): ADR-0001をproposedで追加']);

  return { repo, worktreePath, adrRelPath };
}

test('verify adr (AC-7): commitメッセージがfinalize手順の固定形式と異なるとacceptedへの遷移を手順逸脱として検出する', async (t) => {
  const { repo, worktreePath, adrRelPath } = setupCommittedProposedAdr();
  t.after(() => repo.cleanup());

  // Given: adr finalize CLIを経由せず、statusのみをacceptedへ直接書き換え、
  // 固定形式（chore(adr): ADR-0001 を accepted へ更新）と異なるcommitメッセージでcommitする。
  const adrAbsPath = path.join(worktreePath, adrRelPath);
  fs.writeFileSync(adrAbsPath, adrFixtureText('accepted'));
  gitIn(worktreePath, ['add', adrRelPath]);
  gitIn(worktreePath, ['commit', '-m', 'manual: accept ADR-0001']);

  // When: verify adr を実行する
  const result = runCli(['verify', 'adr', adrRelPath], { cwd: worktreePath });

  // Then: 手順逸脱として検出され、終了コード1以上になる
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADR finalize手順逸脱の疑いがあります/);
  assert.match(result.stderr, /commitメッセージがfinalize手順の固定形式と一致しません/);
});

test('verify adr (AC-7): status変更commitが他ファイルも変更していると手順逸脱として検出する', async (t) => {
  const { repo, worktreePath, adrRelPath } = setupCommittedProposedAdr();
  t.after(() => repo.cleanup());

  // Given: 固定形式のcommitメッセージを使うが、ADR以外のファイルも同じcommitで変更する
  // （adr finalizeは常にADRファイル1件のみをcommitする）。
  const adrAbsPath = path.join(worktreePath, adrRelPath);
  fs.writeFileSync(adrAbsPath, adrFixtureText('accepted'));
  fs.writeFileSync(path.join(worktreePath, 'OTHER.md'), '# 無関係な変更\n');
  gitIn(worktreePath, ['add', adrRelPath, 'OTHER.md']);
  gitIn(worktreePath, ['commit', '-m', 'chore(adr): ADR-0001 を accepted へ更新']);

  const result = runCli(['verify', 'adr', adrRelPath], { cwd: worktreePath });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADR finalize手順逸脱の疑いがあります/);
  assert.match(result.stderr, /ADRファイル以外も変更しています/);
});

test('verify adr (AC-7): status変更commitが本文（Decision等）も書き換えていると手順逸脱として検出する', async (t) => {
  const { repo, worktreePath, adrRelPath } = setupCommittedProposedAdr();
  t.after(() => repo.cleanup());

  // Given: 固定形式のcommitメッセージ・単一ファイル変更だが、statusだけでなく本文（Decision）も
  // 同じcommitで書き換える（adr finalizeはstatus行のみを書き換える）。
  const adrAbsPath = path.join(worktreePath, adrRelPath);
  const rewritten = adrFixtureText('accepted').replace('サンプルの決定内容。', '無断で書き換えた決定内容。');
  fs.writeFileSync(adrAbsPath, rewritten);
  gitIn(worktreePath, ['add', adrRelPath]);
  gitIn(worktreePath, ['commit', '-m', 'chore(adr): ADR-0001 を accepted へ更新']);

  const result = runCli(['verify', 'adr', adrRelPath], { cwd: worktreePath });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADR finalize手順逸脱の疑いがあります/);
  assert.match(result.stderr, /status行以外の本文も変更しています/);
});

test('verify adr (AC-8): adr finalize CLI経由の正規accepted化commitは手順逸脱として誤検知しない', async (t) => {
  const { repo, worktreePath, adrRelPath } = setupCommittedProposedAdr();
  t.after(() => repo.cleanup());

  // Given: design gateでADRのcontent digestを承認済みにし、adr finalize CLI経由でacceptedへ更新する
  // （test/integration/adr-finalize.test.ts と同一の正規経路）。
  const adrAbsPath = path.join(worktreePath, adrRelPath);
  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'design', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const reportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(reportPathMatch);
  const reportPath = reportPathMatch![1];

  const sha256 = (content: Buffer) => `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: {
      conformance: string;
      falsification: string;
      final: string;
      approved_artifacts: { path: string; digest: string }[];
    };
  };
  report.gate.approved_artifacts.push({ path: adrRelPath, digest: sha256(fs.readFileSync(adrAbsPath)) });
  report.gate.conformance = 'pass';
  report.gate.falsification = 'pass';
  report.gate.final = 'approved';
  fs.writeFileSync(reportPath, stringify(report), 'utf8');

  const gatePublish = runCli(['gate', 'publish', 'ISSUE-1', reportPath], { cwd: repo.dir });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);

  const finalize = runCli(['adr', 'finalize', 'ISSUE-1', 'ADR-0001'], { cwd: repo.dir });
  assert.equal(finalize.status, 0, finalize.stderr);

  // When: verify adr を実行する
  const result = runCli(['verify', 'adr', adrRelPath], { cwd: worktreePath });

  // Then: 正規finalize経由のため手順逸脱として誤検知されない
  assert.equal(result.status, 0, result.stderr);
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

// ---- checkpoint（detached HEAD） ----
// checkpoint も lib/worktree.ts の resolveCurrentBranch を共有するため、verify branch-name と
// 同じdetached HEAD観点（GITHUB_HEAD_REF設定済み・未設定）を実地相当で検証する。

test('checkpoint: detached HEAD状態でもGITHUB_HEAD_REFが設定されていればそのブランチへpushする', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', sha], { cwd: worktreePath, stdio: 'pipe' });
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    'HEAD',
    '前提: detached HEAD状態を再現できていること',
  );

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');

  // Given: GITHUB_HEAD_REF が実際のブランチ名で設定されている
  // When/Then: detached HEADでもGITHUB_HEAD_REF経由でブランチ名を解決し、commit+pushに成功する
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], {
    cwd: worktreePath,
    env: { ...process.env, GITHUB_HEAD_REF: 'feature/1-sample-feature' },
  });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const checkpointSha = checkpoint.stdout.trim();
  assert.match(checkpointSha, /^[0-9a-f]{40}$/);

  // detached HEAD状態でのpushは `git push origin <branch>`（ローカルの同名branch refを指す
  // refspec）だと、今しがた作ったcommit（HEAD）ではなく古いbranch refの内容を押してしまいうる
  // （checkoutされているのがbranchではないため）。origin側の実体（remote-tracking ref）を見て
  // 実際にこのcommitがpushされたことを検証する。
  const remoteRef = execFileSync('git', ['rev-parse', 'origin/feature/1-sample-feature'], {
    cwd: worktreePath,
    encoding: 'utf8',
  }).trim();
  assert.equal(remoteRef, checkpointSha, 'commitがorigin/feature/1-sample-featureへ実際にpushされていること');
});

test('checkpoint: detached HEAD状態でGITHUB_HEAD_REFが未設定なら解決不能として明確なエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', sha], { cwd: worktreePath, stdio: 'pipe' });

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');

  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).GITHUB_HEAD_REF;

  // When/Then: commit自体は成功するが、push先ブランチ名を解決できず明確なエラーで終了コード1になる
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 1);
  assert.match(checkpoint.stderr, /現在のブランチ名を解決できません/);

  // commitはすでに成立している（HEADが変わっている）ことを確認する
  const newSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  assert.notEqual(newSha, sha, 'commit自体は成功済みであること');
});
