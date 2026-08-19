import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { stateFilePath } from '../../src/lib/local-state.js';
import { ABSENT_ARTIFACT_DIGEST } from '../../src/commands/gate.js';
import { artifactDigestOf } from '../../src/lib/digest.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `verify` サブコマンド8種の結合テスト。すべて bin/agents-md.js（ビルド後の実体）に対して
// subprocess実行する。fixtureは createTmpRepo + 実際のCLI呼び出し（issue start / gate review /
// sync templates / checkpoint 等）で組み立て、YAMLの手書きは最小限にとどめる。

// Issue #309: 実在する成果物の内容 digest は artifactDigestOf（ドメイン分離済み）で計算される。
// gate.ts/verify.ts と同一の関数を用いることで、テストのfixture構築と本番コードの期待値を一致させる。
function sha256(content: Buffer | string): string {
  return artifactDigestOf(content);
}

function hideLooseBlob(repoDir: string, targetSha: string, artifactPath: string): void {
  const blobSha = execFileSync('git', ['rev-parse', `${targetSha}:${artifactPath}`], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
  const objectPath = path.resolve(repoDir, commonDir, 'objects', blobSha.slice(0, 2), blobSha.slice(2));
  assert.equal(fs.existsSync(objectPath), true);
  fs.renameSync(objectPath, `${objectPath}.unreadable`);
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

// ---- verify config-doc-sync ----

function configSchemaKeys(repoDir: string): string[] {
  const schemaPath = path.join(repoDir, '.agent-skill-chain', 'schemas', 'config.schema.yaml');
  const schema = parse(fs.readFileSync(schemaPath, 'utf8')) as { properties: Record<string, unknown> };
  return Object.keys(schema.properties).filter((key) => key !== 'schema_version');
}

function writeConfigReference(repoDir: string, keys: string[]): void {
  const content = ['# Configuration', '', ...keys.flatMap((key) => [`### \`${key}\``, '', '説明。', ''])].join('\n');
  fs.writeFileSync(path.join(repoDir, 'docs', 'CONFIGURATION.md'), content);
}

test('verify config-doc-sync: スキーマの全トップレベル項目と見出しが一致すれば成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeConfigReference(repo.dir, configSchemaKeys(repo.dir));

  const result = runCli(['verify', 'config-doc-sync'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify config-doc-sync: スキーマ側にのみ存在するトップレベル項目を報告して失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeConfigReference(repo.dir, configSchemaKeys(repo.dir));
  const schemaPath = path.join(repo.dir, '.agent-skill-chain', 'schemas', 'config.schema.yaml');
  const schema = parse(fs.readFileSync(schemaPath, 'utf8')) as { properties: Record<string, unknown> };
  schema.properties.future_setting = { type: 'object' };
  fs.writeFileSync(schemaPath, stringify(schema));

  const result = runCli(['verify', 'config-doc-sync'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /設定リファレンスに見出しがありません: future_setting/);
});

test('verify config-doc-sync: バッククォートを欠く見出しは未記載として失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeConfigReference(repo.dir, configSchemaKeys(repo.dir));
  const documentPath = path.join(repo.dir, 'docs', 'CONFIGURATION.md');
  const malformed = fs.readFileSync(documentPath, 'utf8').replace('### `risk`', '### risk');
  fs.writeFileSync(documentPath, malformed);

  const result = runCli(['verify', 'config-doc-sync'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /設定リファレンスに見出しがありません: risk/);
});

test('verify config-doc-sync: workflowとその呼出しはconsumer向けテンプレートに存在しない', async () => {
  const workflowName = 'agent-skill-chain-config-doc-sync.yml';
  const repositoryWorkflow = path.join(packageRoot, '.github', 'workflows', workflowName);
  const consumerWorkflowDir = path.join(
    packageRoot,
    '.agent-skill-chain',
    'templates',
    'github',
    '.github',
    'workflows',
  );
  const consumerWorkflows = fs.readdirSync(consumerWorkflowDir).map((name) =>
    fs.readFileSync(path.join(consumerWorkflowDir, name), 'utf8'),
  );

  assert.equal(fs.existsSync(repositoryWorkflow), true);
  assert.equal(fs.existsSync(path.join(consumerWorkflowDir, workflowName)), false);
  assert.equal(consumerWorkflows.some((content) => content.includes('config-doc-sync')), false);
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

test('verify artifacts: PRのmerge refで履歴簡約される成果物もadd実績として検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  function gitIn(args: string[]): string {
    return execFileSync('git', args, { cwd: repo.dir, encoding: 'utf8' }).trim();
  }

  // Given: PR branchで成果物を追加後に削除し、そのbranchをbaseへno-ff mergeする。
  // merge commitの成果物パスは第1親（base）とTREESAMEになるため、既定の履歴簡約では
  // 当該パスを変更した第2親（PR branch）の履歴が刈り取られる。
  const headRef = 'bugfix/741-verify-artifacts-unstarted-segments';
  gitIn(['checkout', '-b', headRef]);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n');
  fs.writeFileSync(path.join(repo.dir, 'DESIGN.md'), '# DESIGN\n');
  fs.writeFileSync(path.join(repo.dir, 'PLAN.md'), '# PLAN\n');
  fs.mkdirSync(path.join(repo.dir, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'adr', 'ADR-0001-sample.md'), '# ADR\n');
  gitIn(['add', '-A']);
  gitIn(['commit', '-m', 'docs: add issue artifacts']);
  fs.rmSync(path.join(repo.dir, 'SPEC.md'));
  fs.rmSync(path.join(repo.dir, 'DESIGN.md'));
  fs.rmSync(path.join(repo.dir, 'PLAN.md'));
  gitIn(['add', '-A']);
  gitIn(['commit', '-m', 'docs: remove issue artifacts']);

  gitIn(['checkout', 'main']);
  gitIn(['merge', '--no-ff', headRef, '-m', 'Merge pull request #741']);
  const mergeSha = gitIn(['rev-parse', 'HEAD']);
  gitIn(['checkout', '--detach', mergeSha]);
  gitIn(['branch', '-D', 'main']);

  assert.equal(
    gitIn(['log', '--diff-filter=AM', '--name-only', 'origin/main..HEAD', '--', 'SPEC.md']),
    '',
    '前提: 既定の履歴簡約ではPR branch側のadd実績が省略されること',
  );
  assert.match(
    gitIn(['log', '--full-history', '--diff-filter=AM', '--name-only', 'origin/main..HEAD', '--', 'SPEC.md']),
    /SPEC\.md/,
    '前提: --full-historyならPR branch側のadd実績を列挙できること',
  );

  // When: actions/checkoutが作るmerge ref相当のdetached HEADで検査する。
  const env = { ...process.env, GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: headRef };
  const spec = runCli(['verify', 'artifacts', 'ISSUE-741', 'spec'], { cwd: repo.dir, env });
  const design = runCli(['verify', 'artifacts', 'ISSUE-741', 'design'], { cwd: repo.dir, env });

  // Then: ワークツリーには成果物が無くても、PR branch側のadd実績により充足する。
  assert.equal(spec.status, 0, spec.stderr);
  assert.equal(design.status, 0, design.stderr);
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

// ---- Issue #425: quick（size:quick）の成果物免除とガードレール ----
//
// 免除シグナルは、免除対象の成果物（SPEC.md等）に一切依存しない場所にしか置かない。
// 過去の別方式では要求定義ファイルのfrontmatterにシグナルを置いた結果、「ファイルを作らない
// ためのモード」を成立させるのにそのファイルが必要という循環定義になり発動不能だった。
// 以下のテストはすべて、成果物ファイルを1つも作らない状態から出発する。

const QUICK_BLOCKED_NOTICE_RE = /quick（size:quick）が指定されていますが、次の理由により quick 適用対象外/;

function patchState(repoDir: string, issueNumber: string, patch: Record<string, unknown>): void {
  const statePath = stateFilePath(repoDir, issueNumber);
  const state = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(statePath, stringify({ ...state, ...patch }));
}

test('verify artifacts: ローカルモードの size: quick はSPEC/DESIGN/PLAN/VALIDATIONの存在要求を免除する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: worktree作成時点（成果物を1つも作る前）に size: quick を記録する。risk は quick の
  // 前提である normal にする（config既定は unclassified）。
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP, '--size', 'quick'], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  patchState(repo.dir, '1', { risk: 'normal' });

  // Then: SPEC.md・VALIDATION.md が存在せず履歴上の実績も無いまま spec/validation が成功する
  assert.equal(fs.existsSync(path.join(worktreePath, 'SPEC.md')), false);
  assert.equal(fs.existsSync(path.join(worktreePath, 'VALIDATION.md')), false);
  const spec = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(spec.status, 0, spec.stderr);
  const validation = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir });
  assert.equal(validation.status, 0, validation.stderr);

  // Then: design では DESIGN.md・PLAN.md は免除されるが、ADR（docs/adr/配下に.mdが1つ以上ある
  // というリポジトリ水準の検査であり4成果物ファイルのいずれでもない）は免除対象外のまま残る
  const design = runCli(['verify', 'artifacts', 'ISSUE-1', 'design'], { cwd: repo.dir });
  assert.equal(design.status, 1);
  assert.doesNotMatch(design.stderr, /欠落しています: DESIGN\.md/);
  assert.doesNotMatch(design.stderr, /欠落しています: PLAN\.md/);
  assert.match(design.stderr, /欠落しています: ADR/);

  // Then: 免除が成立している間は「quick適用対象外」通知を出さない
  assert.doesNotMatch(spec.stderr, QUICK_BLOCKED_NOTICE_RE);
});

test('verify artifacts: size 未設定（既定）では現行どおり成果物の存在を要求し、quick通知も出さない（後方互換）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);

  // Given: state.yaml は size フィールド自体を持たない（既存のstate.yamlと同一形状）
  const state = parse(fs.readFileSync(stateFilePath(repo.dir, '1'), 'utf8')) as Record<string, unknown>;
  assert.ok(!('size' in state), '--size未指定ではsizeフィールドを持たないこと');

  // Then: risk を normal にしても挙動は現行のまま（欠落で失敗、quick通知なし）
  patchState(repo.dir, '1', { risk: 'normal' });
  const spec = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(spec.status, 1);
  assert.match(spec.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);
  assert.doesNotMatch(spec.stderr, QUICK_BLOCKED_NOTICE_RE);
});

test('verify artifacts: size: quick でも risk が normal 以外なら免除せず通常フローを強制する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP, '--size', 'quick'], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);

  // Given: config既定の risk: unclassified のまま（安全側の既定）
  const unclassified = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(unclassified.status, 1);
  assert.match(unclassified.stderr, QUICK_BLOCKED_NOTICE_RE);
  assert.match(unclassified.stderr, /risk が normal ではありません（現在: unclassified）/);
  assert.match(unclassified.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);

  // Given: risk: high
  patchState(repo.dir, '1', { risk: 'high' });
  const high = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(high.status, 1);
  assert.match(high.stderr, /risk が normal ではありません（現在: high）/);
  assert.match(high.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);
});

test('verify artifacts: size: quick でもADR差分・自己参照的な差分を含むと免除せず通常フローを強制する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP, '--size', 'quick'], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  patchState(repo.dir, '1', { risk: 'normal' });

  // Given: ガードレール対象の差分が無い状態では免除される（各ケースの前提の健全性チェック）
  assert.equal(runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir }).status, 0);

  const cases: { path: string; content: string; reason: RegExp }[] = [
    { path: path.join('docs', 'adr', 'ADR-0099-sample.md'), content: '# ADR\n', reason: /docs\/adr\/ 配下/ },
    {
      path: path.join('.agent-skill-chain', 'config', 'segments.yaml'),
      content: '# tampered\n',
      reason: /config\/segments\.yaml/,
    },
    { path: 'AGENTS.md', content: '# tampered\n', reason: /AGENTS\.md（不変条件の正本）/ },
    {
      path: path.join('.agent-skill-chain', 'schemas', 'state.schema.yaml'),
      content: '# tampered\n',
      reason: /schemas\/ 配下/,
    },
  ];

  for (const testCase of cases) {
    const absolute = path.join(worktreePath, testCase.path);
    const existed = fs.existsSync(absolute);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, testCase.content);

    // When/Then: quick指定・risk normal でもガードレール抵触により通常どおり成果物を要求する
    const result = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
    assert.equal(result.status, 1, `${testCase.path} でガードレールが発動すること`);
    assert.match(result.stderr, QUICK_BLOCKED_NOTICE_RE);
    assert.match(result.stderr, testCase.reason);
    assert.match(result.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);

    // 次のケースへ影響しないよう差分を元に戻す（追跡済みファイルはcheckout、新規は削除）
    if (existed) {
      execFileSync('git', ['checkout', '--', testCase.path], { cwd: worktreePath, stdio: 'pipe' });
    } else {
      fs.rmSync(absolute);
    }
  }

  // Then: すべて復元した後は再び免除が成立する
  assert.equal(runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir }).status, 0);
});

test('verify artifacts: GitHubモードは size:quick ラベルで免除し、risk:high・risk未付与ではガードレールが発動する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-quick-gh-'));
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  assert.equal(fs.existsSync(path.join(worktreePath, 'SPEC.md')), false);

  // Given: size:quick と risk:normal がIssueへ付与されている（成果物には一切依存しない）
  stub.seedIssueLabels('1', ['type:feature', 'risk:normal', 'size:quick']);
  const quick = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(quick.status, 0, quick.stderr);
  const quickValidation = runCli(['verify', 'artifacts', 'ISSUE-1', 'validation'], { cwd: repo.dir, env });
  assert.equal(quickValidation.status, 0, quickValidation.stderr);

  // Given: size が相反する複数ラベルで解決不能なら、quick を含んでいても免除しない。
  stub.seedIssueLabels('1', ['type:feature', 'risk:normal', 'size:quick', 'size:standard']);
  const ambiguous = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);

  // Given: risk:high が付与されている
  stub.seedIssueLabels('1', ['type:feature', 'risk:high', 'size:quick']);
  const high = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(high.status, 1);
  assert.match(high.stderr, /risk が normal ではありません（現在: high）/);

  // Given: riskラベルが1つも付与されていない（未分類扱い＝安全側）
  stub.seedIssueLabels('1', ['type:feature', 'size:quick']);
  const unlabeled = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(unlabeled.status, 1);
  assert.match(unlabeled.stderr, /risk が normal ではありません（現在: unclassified）/);

  // Given: size:quick が付与されていない（既定）→ 現行どおりの挙動、quick通知も出さない
  stub.seedIssueLabels('1', ['type:feature', 'risk:normal']);
  const standard = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(standard.status, 1);
  assert.match(standard.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);
  assert.doesNotMatch(standard.stderr, QUICK_BLOCKED_NOTICE_RE);
});

test('verify artifacts: GitHubモードでラベルを読めない場合は quick を適用せず現行どおり成果物を要求する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());

  // Given: gh が常に失敗する（未認証・リポジトリ解決不能等）状況をPATH注入で再現する
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-quick-ghfail-'));
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(binDir, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);

  // Then: シグナルを読み取れないため standard として扱い、従来どおり欠落で失敗する
  const spec = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir, env });
  assert.equal(spec.status, 1);
  assert.match(spec.stderr, /segment 'spec' の必須成果物が欠落しています: SPEC\.md/);
  assert.doesNotMatch(spec.stderr, QUICK_BLOCKED_NOTICE_RE);
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

  // When: approved_artifactsのdigestが、target_sha上の実際のSPEC.md内容と一致しない（フィールド自体の
  // 不整合。target_shaは固定commitのため、Issue #316以降は working directory 側の変更ではなく
  // 記録されたdigestフィールドの不一致として検証する）。
  const mismatchedText = fs.readFileSync(gateReportPath, 'utf8').replace(specDigest, `sha256:${'f'.repeat(64)}`);
  fs.writeFileSync(gateReportPath, mismatchedText);

  // Then: digest不一致として失敗する
  const stale = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /approved_artifacts の digest が現在のファイル内容と一致しません: SPEC\.md/);
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

test('verify gate-report: target treeに存在する成果物のblob読み取り失敗を不在標識で許容しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\n');
  execFileSync('git', ['add', 'SPEC.md'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-m', 'test: add unreadable artifact'], { cwd: worktreePath });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'implementation', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPath = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout)![1];
  const approvedText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace(
      'approved_artifacts: []',
      `approved_artifacts:\n    - path: SPEC.md\n      digest: ${ABSENT_ARTIFACT_DIGEST}`,
    );
  fs.writeFileSync(gateReportPath, approvedText);
  hideLooseBlob(repo.dir, targetSha, 'SPEC.md');

  const result = runCli(['verify', 'gate-report', gateReportPath], { cwd: worktreePath });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /approved_artifacts のファイルを読み取れません: SPEC\.md/);
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

test('verify gate-report: quick免除下のspec必須成果物不在標識を許容する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const start = runCli([
    'issue', 'start', 'ISSUE-733', 'bugfix', 'quick-absent-spec', FIXED_TIMESTAMP,
    '--size', 'quick', '--request', 'quick requirement',
  ], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  const statePath = path.join(repo.dir, 'issues', '733', '.agent-skill-chain', 'state.yaml');
  const state = parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(statePath, stringify({ ...state, risk: 'normal' }));
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim();
  const review = runCli(['gate', 'review', 'ISSUE-733', 'spec', 'standard', targetSha], { cwd: worktreePath });
  assert.equal(review.status, 0, review.stderr);
  const reportPath = /gate_report_path:\s*(\S+)/.exec(review.stdout)![1];
  const approvedText = fs
    .readFileSync(reportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved')
    .replace(
      'approved_artifacts: []',
      `approved_artifacts:\n    - path: SPEC.md\n      digest: ${ABSENT_ARTIFACT_DIGEST}`,
    );
  fs.writeFileSync(reportPath, approvedText);

  const result = runCli(['verify', 'gate-report', reportPath], { cwd: worktreePath });
  assert.equal(result.status, 0, result.stderr);
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
  assert.match(before.stderr, /未同期（欠落）: \.claude\/agents\/agent-skill-chain-worker\.md/);

  // When: sync templates で同期する
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  // Then: 差分0で成功する
  const afterSync = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(afterSync.status, 0, afterSync.stderr);

  // When: 同期済みファイル（seed-only指定されていない完全一致必須ファイル）の内容を改変する
  fs.appendFileSync(path.join(repo.dir, '.github', 'SECURITY.md'), '\n# modified\n');

  // Then: 差分ありとして再検出される
  const afterEdit = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(afterEdit.status, 1);
  assert.match(afterEdit.stderr, /未同期（差分あり）: SECURITY\.md/);
});

// ISSUE-574: seed-onlyファイル（CODEOWNERS）は初回配置後の内容カスタマイズを
// 正当な乖離として許容する。AC-1〜AC-3を検証する。
test('verify template-sync: seed-only指定ファイル（CODEOWNERS）はプレースホルダー書き換え後も差分として報告しない（AC-1）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  // When: テンプレート本文の指示どおり <owner> プレースホルダーを実際の値へ書き換える
  const codeownersPath = path.join(repo.dir, '.github', 'CODEOWNERS');
  const original = fs.readFileSync(codeownersPath, 'utf8');
  fs.writeFileSync(codeownersPath, original.replace('<owner>', '@org/team'));

  // Then: 失敗しない
  const result = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify template-sync: 展開先だけに存在する本体専用ファイルは差分として報告しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  const repositoryOnlyWorkflow = path.join(
    repo.dir,
    '.github',
    'workflows',
    'agent-skill-chain-release.yml',
  );
  fs.writeFileSync(repositoryOnlyWorkflow, 'name: repository-only release\n');

  const result = runCli(['verify', 'template-sync', repo.dir], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
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

test('verify adr: finalize経由でacceptedになった後にファイル名とidを変更（git mv）しても手順逸脱として誤検知しない（ISSUE-539）', async (t) => {
  const { repo, worktreePath, adrRelPath } = setupCommittedProposedAdr();
  t.after(() => repo.cleanup());

  // Given: AC-8と同一の正規finalize経路でacceptedへ遷移させる。
  const adrAbsPath = path.join(worktreePath, adrRelPath);
  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'design', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const reportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(reportPathMatch);
  const reportPath = reportPathMatch![1];

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

  // Given: accepted化後、ID重複是正のような一度限りの機械的補正として、statusは変更せず
  // ファイル名とframtmatterのid:のみを別commitでgit mvする（ISSUE-539の再採番と同型）。
  const renamedRelPath = path.join('docs', 'adr', 'ADR-0099-sample.md');
  const renamedAbsPath = path.join(worktreePath, renamedRelPath);
  const renamedText = fs.readFileSync(adrAbsPath, 'utf8').replace('id: ADR-0001', 'id: ADR-0099');
  gitIn(worktreePath, ['mv', adrRelPath, renamedRelPath]);
  fs.writeFileSync(renamedAbsPath, renamedText);
  gitIn(worktreePath, ['add', renamedRelPath]);
  gitIn(worktreePath, ['commit', '-m', 'chore: ADR-0001をADR-0099へ再採番']);

  // When: リネーム後のパスで verify adr を実行する
  const result = runCli(['verify', 'adr', renamedRelPath], { cwd: worktreePath });

  // Then: リネーム前のfinalize commitが遷移commitとして正しく追跡され、手順逸脱として誤検知されない
  // （リネームで現在のパスと異なる過去のファイルパスでも `git show` の内容取得に失敗しない）。
  assert.equal(result.status, 0, result.stderr);
});

// ---- verify spec-bdd（Issue #273） ----

function specBddFixture(overrides: { given?: string; when?: string; then?: string; verification?: string; summary?: string } = {}): string {
  return [
    '# SPEC: サンプル',
    '',
    `#### AC-1: ${overrides.summary ?? 'ログイン成功時にダッシュボードへ遷移する'}`,
    '',
    `- Given: ${overrides.given ?? 'ユーザーが有効な認証情報を持つ'}`,
    `- When: ${overrides.when ?? 'ログインフォームを送信する'}`,
    `- Then: ${overrides.then ?? 'ダッシュボード画面へ遷移する'}`,
    `- 検証方法見込み: ${overrides.verification ?? '\`automated\`'}`,
    '',
  ].join('\n');
}

test('verify spec-bdd: Given/When/Then/検証方法見込みが実内容で埋まっていれば成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 全フィールドが実内容で埋まったSPEC.md
  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.writeFileSync(specPath, specBddFixture());

  // Then: 成功する
  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify spec-bdd: Thenの正当なパス変数表記はプレースホルダとして検出しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.writeFileSync(
    specPath,
    specBddFixture({ then: 'ゲート証跡を `reviews/<gate>.yaml` に記録し、次のセグメントから参照できる' }),
  );

  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify spec-bdd: 実内容中に説明的プレースホルダが残っていると検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.writeFileSync(specPath, specBddFixture({ then: 'ログイン後、`<期待される結果>` へ遷移する' }));

  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AC-1 の Then が未記入またはプレースホルダのままです/);
});

test('verify spec-bdd: テンプレートのプレースホルダがGiven/When/Then/検証方法見込みに残っていると検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: SPEC.mdテンプレート自体（<...>プレースホルダが未置換のまま）
  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.copyFileSync(path.join(repo.dir, '.agent-skill-chain', 'templates', 'issue', 'SPEC.md'), specPath);

  // When/Then: AC-1・AC-2それぞれのGiven/When/Then/検証方法見込み・要約すべてがプレースホルダとして検出される
  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AC-1 の要約がプレースホルダのまま/);
  assert.match(result.stderr, /AC-1 の Given が未記入またはプレースホルダのままです/);
  assert.match(result.stderr, /AC-1 の When が未記入またはプレースホルダのままです/);
  assert.match(result.stderr, /AC-1 の Then が未記入またはプレースホルダのままです/);
  assert.match(result.stderr, /AC-1 の検証方法見込みが未記入またはプレースホルダのままです/);
  assert.match(result.stderr, /AC-2 の要約がプレースホルダのまま/);
});

test('verify spec-bdd: 検証方法見込みがautomated|manual|hybrid以外だと検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.writeFileSync(specPath, specBddFixture({ verification: '`unknown-mode`' }));

  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /検証方法見込みは automated\|manual\|hybrid のいずれかである必要があります/);
});

test('verify spec-bdd: AC-IDが1つも無いSPEC.mdはエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const specPath = path.join(repo.dir, 'SPEC.md');
  fs.writeFileSync(specPath, '# SPEC: サンプル\n\n本文のみでAC-IDが無い。\n');

  const result = runCli(['verify', 'spec-bdd', specPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AC-ID（#### AC-N: \.\.\.）が1つも見つかりません/);
});

test('verify spec-bdd: 存在しないパスを指定するとエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['verify', 'spec-bdd', path.join(repo.dir, 'NOT_FOUND.md')], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /が見つかりません/);
});

// ---- verify design-diagram（Issue #273） ----

test('verify design-diagram: 判断が不要で根拠が記載されていれば図が無くても成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.writeFileSync(
    designPath,
    [
      '# DESIGN: サンプル',
      '',
      '### 図示要否の判断',
      '',
      '- 判断: `不要`',
      '- 根拠: 依存関係は1件のみ、状態遷移なし、責務境界も1つのみのため図示は不要と判断した。',
      '',
    ].join('\n'),
  );

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify design-diagram: 根拠の正当なパス変数表記はプレースホルダとして検出しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.writeFileSync(
    designPath,
    [
      '# DESIGN: サンプル',
      '',
      '### 図示要否の判断',
      '',
      '- 判断: `不要`',
      '- 根拠: `reviews/<gate>.yaml` への一方向の書き込みだけであり、状態遷移も無いため図示は不要と判断した。',
      '',
    ].join('\n'),
  );

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify design-diagram: 判断が要でもmermaidフェンスが無いと検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.writeFileSync(
    designPath,
    ['# DESIGN: サンプル', '', '### 図示要否の判断', '', '- 判断: `要`', '- 根拠: 依存関係が4件あるため図示が必要。', ''].join('\n'),
  );

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mermaid コードフェンス/);
});

test('verify design-diagram: 判断が要でmermaidフェンスがあれば成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.writeFileSync(
    designPath,
    [
      '# DESIGN: サンプル',
      '',
      '### 図示要否の判断',
      '',
      '- 判断: `要`',
      '- 根拠: 依存関係が4件あるため図示が必要。',
      '',
      '```mermaid',
      'graph LR',
      '  A --> B',
      '```',
      '',
    ].join('\n'),
  );

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
});

test('verify design-diagram: テンプレート自体（プレースホルダ未置換）は判断・根拠の両方を検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.copyFileSync(path.join(repo.dir, '.agent-skill-chain', 'templates', 'issue', 'DESIGN.md'), designPath);

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /図示要否の判断（要\|不要）が未記入またはプレースホルダのままです/);
  assert.match(result.stderr, /図示要否の根拠が未記入またはプレースホルダのままです/);
});

test('verify design-diagram: 「### 図示要否の判断」セクション自体が無いと検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const designPath = path.join(repo.dir, 'DESIGN.md');
  fs.writeFileSync(designPath, '# DESIGN: サンプル\n\n本文のみでセクションが無い。\n');

  const result = runCli(['verify', 'design-diagram', designPath], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /'### 図示要否の判断' セクションが見つかりません/);
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
  fs.writeFileSync(
    path.join(worktreePath, 'SPEC.md'),
    '# SPEC\n\n#### AC-1: サンプル\n\n本文\n\n#### AC-2: 別のサンプル\n\n本文\n',
  );
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
  fs.writeFileSync(
    path.join(worktreePath, 'SPEC.md'),
    '# SPEC\n\n#### AC-1: サンプル\n\n本文\n\n#### AC-2: 別のサンプル\n\n本文\n',
  );
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

// ISSUE-538: SPEC.mdテンプレート本文中の「AC を追加する場合は AC-N, AC-M ... と連番で追加する」
// という追記用コメント等、`#### AC-N: ...` 見出し以外の場所に出現する `AC-N` 文字列は、
// 正規のAC-ID宣言ではないため孤児AC判定の対象に含めてはならない（specBddと同一の抽出基準）。
test('verify ac-coverage: SPEC.md本文中の見出し以外のAC-N言及（追記コメント等）は孤児AC判定の対象に含めない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');

  // Given: 実在するAC-IDはAC-1のみだが、本文末尾に次の追加候補として AC-2・AC-3 に言及する
  // 見出し以外のコメント（テンプレート由来）が残っている
  fs.writeFileSync(
    path.join(worktreePath, 'SPEC.md'),
    [
      '# SPEC',
      '',
      '#### AC-1: サンプル',
      '',
      '本文',
      '',
      '<!-- AC を追加する場合は AC-2, AC-3 ... と連番で追加する -->',
      '',
    ].join('\n'),
  );
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

  // When/Then: AC-2・AC-3は見出しではないコメント言及に過ぎないため孤児ACとして検出されず成功する
  const result = runCli(['verify', 'ac-coverage', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
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
