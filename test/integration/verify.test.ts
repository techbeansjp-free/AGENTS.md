import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { ABSENT_ARTIFACT_DIGEST } from '../../src/commands/gate.js';

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

test('verify artifacts: implementation segmentはdefaultBranchとのtestディレクトリ差分を要求し、VALIDATION.mdには依存しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given/When: mainからの差分（docs等を除く）が無く、test/配下の変更も無い状態
  // Then: code・unit_test_results の両方が欠落として報告される
  const before = runCli(['verify', 'artifacts', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
  assert.equal(before.status, 1);
  assert.match(before.stderr, /欠落しています: code/);
  assert.match(before.stderr, /欠落しています: unit_test_results/);

  // When: worktree内にコードファイルとtest/配下の単体テストファイルを追加しcheckpoint
  // （add+commit+push）する。unit_test_results はIssue #202以降、test/配下のbaseブランチ
  // 三点差分（'code'ケースと同一技法）で判定され、VALIDATION.md（validationセグメント専用の
  // 成果物）の存在には一切依存しない（ADR-0006）。ここでは意図的にVALIDATION.mdを作成しない。
  fs.mkdirSync(path.join(worktreePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'src', 'app.js'), 'console.log(1);\n');
  fs.mkdirSync(path.join(worktreePath, 'test', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'test', 'unit', 'app.test.js'), '// sample unit test\n');
  const checkpoint = runCli(['checkpoint', 'feat: add app.js with unit test'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  // Then: VALIDATION.mdが無くても成功する
  assert.equal(fs.existsSync(path.join(worktreePath, 'VALIDATION.md')), false);
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);
});

test('verify artifacts: AC-1 codeとtest/差分が揃えばVALIDATION.mdを作成せずにunit_test_resultsが充足される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: code（implementationセグメントの成果物）は充足済みである状態。VALIDATION.mdは
  // worktree内に一切存在しない（当該Issue自身のvalidationセグメントは未着手）。
  fs.mkdirSync(path.join(worktreePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'src', 'app.js'), 'console.log(1);\n');
  const codeOnly = runCli(['checkpoint', 'feat: add app.js'], { cwd: worktreePath });
  assert.equal(codeOnly.status, 0, codeOnly.stderr);
  assert.equal(fs.existsSync(path.join(worktreePath, 'VALIDATION.md')), false);

  // When: implementationセグメント自身の作業実績（test/配下ファイルの追加）を作成したうえで
  // verify artifacts <issue_id> implementation を実行する。VALIDATION.mdの作成・参照は行わない。
  fs.mkdirSync(path.join(worktreePath, 'test', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'test', 'unit', 'app.test.js'), '// sample unit test\n');
  const withTest = runCli(['checkpoint', 'test: add unit test for app.js'], { cwd: worktreePath });
  assert.equal(withTest.status, 0, withTest.stderr);

  // Then: unit_test_resultsは欠落として報告されず、implementationセグメントの成果物チェック
  // 全体が合格する。VALIDATION.mdは最後まで作成されていない。
  assert.equal(fs.existsSync(path.join(worktreePath, 'VALIDATION.md')), false);
  const result = runCli(['verify', 'artifacts', 'ISSUE-1', 'implementation'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /欠落しています: unit_test_results/);
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
  // Issue #202: unit_test_results は VALIDATION.md ではなく test/ 配下のbaseブランチ差分で
  // 判定されるため、implementation segment全体の合格（after.status === 0）にはこれが必要。
  fs.mkdirSync(path.join(repo.dir, 'test', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'test', 'unit', 'app.test.js'), '// sample unit test\n');
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

// Issue #200 AC-3: checkOutputExists()は「現在ファイルが存在するか」に加えて「baseブランチから
// 分岐後の履歴でadd/modifyされた実績があるか」もOR条件で判定するため、成果物ファイル自体を
// 意図的に削除するIssue（本Issue #200のSPEC.md自身が実例）でも自己言及的に不合格にならない。
test('verify artifacts: SPEC.md/DESIGN.md/PLAN.mdをcommit後に削除しても、履歴上の実績によりspec/designセグメントは成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: SPEC.md/DESIGN.md/PLAN.md（design segmentはADRも要求するため合わせて作成する）を
  // 作成し、branch履歴にadd実績を残す
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN\n');
  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN\n');
  fs.mkdirSync(path.join(worktreePath, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'docs', 'adr', 'ADR-0001-sample.md'), '# ADR\n');
  const added = runCli(['checkpoint', 'docs: add SPEC/DESIGN/PLAN'], { cwd: worktreePath });
  assert.equal(added.status, 0, added.stderr);

  // 前提: 削除前は当然「現在存在する」ため成功する
  const beforeDelete = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(beforeDelete.status, 0, beforeDelete.stderr);

  // When: SPEC.md/DESIGN.md/PLAN.mdを意図的に削除しcommitする（本Issue #200のspecセグメント自身と
  // 同じ状況を再現する）
  fs.rmSync(path.join(worktreePath, 'SPEC.md'));
  fs.rmSync(path.join(worktreePath, 'DESIGN.md'));
  fs.rmSync(path.join(worktreePath, 'PLAN.md'));
  const removed = runCli(['checkpoint', 'docs: remove SPEC/DESIGN/PLAN intentionally'], { cwd: worktreePath });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(worktreePath, 'SPEC.md')), false);

  // Then: 現在は存在しないが、履歴上のadd実績があるためspec/design segmentともに成功する
  const afterDeleteSpec = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(afterDeleteSpec.status, 0, afterDeleteSpec.stderr);

  const afterDeleteDesign = runCli(['verify', 'artifacts', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(afterDeleteDesign.status, 0, afterDeleteDesign.stderr);
});

test('verify artifacts: VALIDATION.mdをcommit後に削除しても、履歴上の実績によりvalidationセグメントは成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: VALIDATION.mdを作成し、branch履歴にadd実績を残す
  fs.writeFileSync(path.join(worktreePath, 'VALIDATION.md'), '# VALIDATION\n');
  const added = runCli(['checkpoint', 'docs: add VALIDATION.md'], { cwd: worktreePath });
  assert.equal(added.status, 0, added.stderr);

  // When: VALIDATION.mdを意図的に削除しcommitする
  fs.rmSync(path.join(worktreePath, 'VALIDATION.md'));
  const removed = runCli(['checkpoint', 'docs: remove VALIDATION.md intentionally'], { cwd: worktreePath });
  assert.equal(removed.status, 0, removed.stderr);

  // Then: 現在は存在しないが、履歴上のadd実績があるためvalidation segmentは成功する
  const after = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(after.status, 0, after.stderr);
});

test('verify artifacts: 対象ファイルを一度もcommitしていない未着手segmentは、無関係なcommitが存在しても引き続き失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: SPEC.mdやVALIDATION.mdには一切触れず、無関係なファイルのみをcommitする
  // （--diff-filter=AMのパス指定が正しく対象ファイルのみに絞り込めているかを確認する）
  fs.writeFileSync(path.join(worktreePath, 'NOTES.md'), '# unrelated notes\n');
  const unrelated = runCli(['checkpoint', 'docs: add unrelated notes'], { cwd: worktreePath });
  assert.equal(unrelated.status, 0, unrelated.stderr);

  // Then: SPEC.mdは現在も存在せず履歴上のadd実績も無いため、spec segmentは引き続き失敗する
  const spec = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(spec.status, 1);
  assert.match(spec.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);

  // Then: VALIDATION.mdも同様にvalidation segmentは引き続き失敗する
  const validation = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /欠落しています: acceptance_test_results/);
  assert.match(validation.stderr, /欠落しています: regression_test_results/);
});

// ---- verify gate-report ----

test('verify gate-report: スキーマ適合・digest一致のgate-reportは成功し、pendingは専用終了コード、digest不一致は失敗になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Issue #316: approved_artifactsはgate-report.yamlのtarget_sha（git rev-parse HEAD時点）が
  // 指すGit objectとして検証されるため、SPEC.mdはgate review実行前にcommitしておく必要がある。
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  // Given: gate review で白紙スキャフォールドを取得する（conformance/falsification/final は pending）
  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch);
  const gateReportPath = gateReportPathMatch![1];

  // When: pendingのまま検証する
  // Then: conformance/falsification/final すべてがpendingのまま、として専用終了コード2になる
  const pending = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(pending.status, 2);
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

  // When: finalはrejectedで確定しているが、conformanceはpendingのまま、falsificationはfailである
  const rejectedText = approvedText
    .replace('conformance: pass', 'conformance: pending')
    .replace('falsification: pass', 'falsification: fail')
    .replace('final: approved', 'final: rejected');
  fs.writeFileSync(gateReportPath, rejectedText);

  // Then: finalを権威ある判定としてpending専用終了コードへ倒さず、後続publishへ進める
  const rejected = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(rejected.status, 0, rejected.stderr);

  // When: approved_artifactsのdigestが、target_sha上の実際のSPEC.md内容と一致しない（フィールド自体の
  // 不整合。target_shaは固定commitのため、Issue #316以降は working directory 側の変更ではなく
  // 記録されたdigestフィールドの不一致として検証する）。
  const mismatchedText = approvedText
    .replace('conformance: pass', 'conformance: pending')
    .replace('falsification: pass', 'falsification: pending')
    .replace('final: approved', 'final: pending')
    .replace(specDigest, `sha256:${'f'.repeat(64)}`);
  fs.writeFileSync(gateReportPath, mismatchedText);

  // Then: pendingも併存するが、digest不一致を優先して終了コード1で失敗する
  const stale = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /approved_artifacts の digest が現在のファイル内容と一致しません: SPEC\.md/);
});

// Issue #349 design-gate指摘（human-required-collapsed-into-pending-check-run）:
// `human_required`は「レビュー完了・判定不能で人間判断が必要」な確定値（gate-report.schema.yaml
// のfinal定義）であり、リテラルpending（レビュー未了の白紙スキャフォールド）とは意味が異なる。
// `gate publish`はリテラルfinal=pendingのみを拒否し、human_requiredはexit 0で詳細情報付き
// action_required Check Runを発行できるため、verify gate-reportはhuman_requiredをexit 2の
// 救済分岐（Publish Check Runがskipされ詳細発行が失われる）へ倒さず、非pending違反が無ければ
// exit 0で通過させて通常のgate publish経路に乗せる。conformance/falsificationが個別にpending
// のままでも、finalが確定値である以上チェックしない（finalが単一の権威あるフィールド）。
test('verify gate-report (Issue #349): final=human_requiredは確定値としてexit 0で通過しgate publish経路へ進む', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  // Given: verifyGithubReviewEvidence()が実際に返しうる「レビュー未確定」状態
  // （conformance/falsificationともpending、finalはhuman_required。approved_artifactsは
  // 空のままでよい——fail()経路はapproved_artifactsを検証対象にしない）。
  const humanRequiredText = fs.readFileSync(gateReportPath, 'utf8').replace('final: pending', 'final: human_required');
  fs.writeFileSync(gateReportPath, humanRequiredText);

  // When/Then: 違反にもpendingにも計上されずexit 0（後続のgate publishがhuman_requiredの
  // 詳細情報付きaction_required Check Runを発行する経路へ進む）
  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(result.status, 0, result.stderr);

  // When: human_requiredに加えてapproved_artifactsのdigest不一致（非pending違反）が併存する
  const mismatchedText = humanRequiredText.replace(
    'approved_artifacts: []',
    `approved_artifacts:\n    - path: SPEC.md\n      digest: sha256:${'f'.repeat(64)}`,
  );
  fs.writeFileSync(gateReportPath, mismatchedText);

  // Then: finalがhuman_requiredでも非pending違反は素通りせず終了コード1で失敗する（fail-closed）
  const withViolation = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(withViolation.status, 1);
  assert.match(withViolation.stderr, /approved_artifacts の digest が現在のファイル内容と一致しません: SPEC\.md/);
});

// Issue #316: verify-and-publishジョブはprotected base（main）をcheckoutしPR headをGit objectとしてのみ
// fetchするため、working directoryのファイルシステムにapproved_artifacts対象ファイルが存在しなくても、
// target_shaのGit object上に存在すれば検証が成功しなければならない。
test('verify gate-report (Issue #316 AC-1): target_shaにcommit済みならworktreeのファイルシステムから削除されていても成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  const specDigest = sha256(fs.readFileSync(path.join(worktreePath, 'SPEC.md')));
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace('approved_artifacts: []', `approved_artifacts:\n    - path: SPEC.md\n      digest: ${specDigest}`);
  fs.writeFileSync(gateReportPath, approvedText);

  // When: commit済みのSPEC.mdをworktreeのファイルシステムからだけ削除する
  //（protected base checkoutにPR head成果物が存在しない状況を模す）。
  fs.unlinkSync(path.join(worktreePath, 'SPEC.md'));

  // Then: target_sha（HEAD）のGit object上には存在するため、検証は成功する。
  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(result.status, 0, result.stderr);
});

// Issue #316 AC-2: target_shaのGit objectにも一度も存在しないpathは、引き続き「削除されている」
// として検知される。
test('verify gate-report (Issue #316 AC-2): target_shaのGit objectにも存在しないpathは削除として検知される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  // Given: 一度もcommitされていないpathをapproved_artifactsへ記載する。
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace(
      'approved_artifacts: []',
      `approved_artifacts:\n    - path: NEVER_COMMITTED.md\n      digest: sha256:${'0'.repeat(64)}`,
    );
  fs.writeFileSync(gateReportPath, approvedText);

  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approved_artifacts のファイルが削除されています（digest不一致として扱います）: NEVER_COMMITTED\.md/);
});

// Issue #316 AC-5: implementation gateはtarget_shaに実在しない成果物をABSENT_ARTIFACT_DIGEST
// sentinelで正当に記録する（gate.tsのallowAbsent分岐）。このsentinel値と記載digestが一致する場合は
// 「削除の正当な記録」として検証成功にならなければならない（AC-2の「削除されている」エラーとは区別）。
test('verify gate-report (Issue #316 AC-5): ABSENT_ARTIFACT_DIGEST sentinelで記録された欠落成果物は検証成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'implementation', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  // Given: 一度もcommitされていないpathを、ABSENT_ARTIFACT_DIGEST sentinelで正当な欠落として記録する。
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace(
      'approved_artifacts: []',
      `approved_artifacts:\n    - path: NEVER_EXISTED.md\n      digest: ${ABSENT_ARTIFACT_DIGEST}`,
    );
  fs.writeFileSync(gateReportPath, approvedText);

  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(result.status, 0, result.stderr);
});

// Issue #316 AC-6: implementation以外のgate（spec/design/validation）では、証跡生成側がそもそも
// sentinel digestを持つapproved_artifactsエントリを生成し得ないため、検証側でも例外を適用しない
// （I8安全側原則。gate.id限定無しに無条件許容すると「不在の正当な記録」を偽装できてしまう）。
test('verify gate-report (Issue #316 AC-6): implementation以外のgateではABSENT_ARTIFACT_DIGEST sentinelを許容しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

  // Given: spec gateのgate-reportに、一度もcommitされていないpathをABSENT_ARTIFACT_DIGEST
  // sentinel値で（本来生成され得ない形で）記録する。
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace(
      'approved_artifacts: []',
      `approved_artifacts:\n    - path: NEVER_EXISTED.md\n      digest: ${ABSENT_ARTIFACT_DIGEST}`,
    );
  fs.writeFileSync(gateReportPath, approvedText);

  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approved_artifacts のファイルが削除されています（digest不一致として扱います）: NEVER_EXISTED\.md/);
});

// Issue #316（前提条件、AC-1・AC-2・AC-7）: gateReportの成果物検証ループはtarget_shaが正当な
// commit SHAであることを暗黙の前提にしている。この前提が崩れる代表的な3パターン（空文字列・
// HEAD等の解決可能なref名・完全に無効な文字列）のいずれでも、成果物検証ループへ一切入らず
// fail-closedに拒否されることを検証する。
for (const [label, invalidTargetSha] of [
  ['空文字列', "''"],
  ['HEAD等の解決可能なref名', 'HEAD'],
  ['存在しない無効な文字列', 'not-a-real-commit-sha'],
] as const) {
  test(`verify gate-report (Issue #316 前提条件): target_shaが${label}の場合はfail-closedに拒否される`, async (t) => {
    const repo = createTmpRepo({ backend: 'local' });
    t.after(() => repo.cleanup());

    const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
      cwd: repo.dir,
    });
    assert.equal(start.status, 0, start.stderr);
    const [, worktreePath] = start.stdout.trim().split('\n');

    fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
    execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
    execFileSync('git', ['commit', '-m', 'test: add SPEC.md'], { cwd: worktreePath });

    const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
    assert.equal(gateReview.status, 0, gateReview.stderr);
    const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];

    // Given: approved_artifactsにSPEC.mdの実digestを対応付けたうえで、gate.conformance等は
    // 承認済みに書き換える（target_sha前提検査はこれらより前に評価されるため、成果物検証ループへ
    // 到達しないことが直接確認できる）。
    const specDigest = sha256(fs.readFileSync(path.join(worktreePath, 'SPEC.md')));
    const approvedText = fs
      .readFileSync(gateReportPath, 'utf8')
      .replace('conformance: pending', 'conformance: pass')
      .replace('falsification: pending', 'falsification: pass')
      .replace('final: pending', 'final: approved')
      .replace('approved_artifacts: []', `approved_artifacts:\n    - path: SPEC.md\n      digest: ${specDigest}`);
    fs.writeFileSync(gateReportPath, approvedText);

    // When: target_shaを不正な値へ書き換える。
    const tamperedText = fs.readFileSync(gateReportPath, 'utf8').replace(/target_sha: .*/, `target_sha: ${invalidTargetSha}`);
    fs.writeFileSync(gateReportPath, tamperedText);

    // Then: 成果物検証ループへ入らず、target_sha前提検査専用のエラーで拒否される
    //（「削除されています」「digest不一致」いずれのエラーメッセージにもならない）。
    const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gate\.target_sha が有効なcommitとして解決できません/);
    assert.doesNotMatch(result.stderr, /approved_artifacts のファイルが削除されています/);
    assert.doesNotMatch(result.stderr, /approved_artifacts の digest が現在のファイル内容と一致しません/);
  });
}

// ISSUE-176 AC-4の後継（Issue #316でgit object参照へ移行）: 「検知が完全にスキップされる」という
// 元の懸念（旧実装は `fs.existsSync(abs) && digestOfFile(abs) !== artifact.digest` という条件式のため、
// existsSync が false の場合は条件全体がfalseになり検知漏れになっていた）は、target_shaのGit objectにも
// 存在しないpathを「削除されている」として検知する上記「Issue #316 AC-2」テストが引き継ぐ。
// ファイルシステムからの削除のみ（commit済みかつgit object上は存在）は、Issue #316以降は
// 意図的に成功扱いへ変わる（上記「Issue #316 AC-1」テスト）ため、本テストは削除する。

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

// ---- verify root-clean（Issue #208） ----

test('verify root-clean: root直下に対象4ファイルが無ければ成功し、存在すればすべて列挙して失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: fixtureはroot直下に対象4ファイルを一切持たない
  // Then: 成功する
  const before = runCli(['verify', 'root-clean'], { cwd: repo.dir });
  assert.equal(before.status, 0, before.stderr);

  // When: root直下（repo.dir自身）にSPEC.md/DESIGN.md/PLAN.md/VALIDATION.mdを作成する
  // （squash mergeで前Issueの成果物がmainルート直下へ恒久混入した状態の再現）
  for (const file of ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']) {
    fs.writeFileSync(path.join(repo.dir, file), `# ${file}\n`);
  }

  // Then: 4件すべてが残存として検出され、終了コード1になる
  const after = runCli(['verify', 'root-clean'], { cwd: repo.dir });
  assert.equal(after.status, 1);
  for (const file of ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']) {
    assert.match(after.stderr, new RegExp(`root直下に残存しています: ${escapeRegExp(file)}`));
  }
});

test('verify root-clean: 対象4ファイルのうち一部のみが存在する場合はその分のみを報告する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n');

  const result = runCli(['verify', 'root-clean'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /root直下に残存しています: SPEC\.md/);
  assert.doesNotMatch(result.stderr, /DESIGN\.md/);
  assert.doesNotMatch(result.stderr, /PLAN\.md/);
  assert.doesNotMatch(result.stderr, /VALIDATION\.md/);
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
