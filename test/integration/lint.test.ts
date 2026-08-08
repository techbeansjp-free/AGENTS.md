import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { walkTextFiles } from '../../src/lib/scan.js';
import { commentMarkerFor } from '../../src/commands/lint.js';

// lint vocab / lint references / lint adr check の3サブコマンドを、bin/agents-md.js（ビルド後の
// 実体）に対する subprocess 実行で検証する。createTmpRepo は .agent-skill-chain/ 資産一式
// （docs/GLOSSARY.md・AGENTS.md 含む）を複製するため、lint コマンドが内部で使う repoRoot() 解決や
// docs/GLOSSARY.md 読み込みが素通しで動く状態を用意できる。

// このリポジトリ自身（test/integration からニ階層上）。lint adr check を実物 docs/adr/ に対して
// 実行する検証で使う。
const realRepoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

test('lint vocab: 禁止語を含まないファイルは終了コード0、禁止語を含むファイルは終了コード1で箇所を報告する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 禁止同義語を含まない自作ファイル（docs/GLOSSARY.md にある正しい用語「Issue」のみ使用）
  const cleanFile = path.join(repo.dir, 'clean.md');
  fs.writeFileSync(cleanFile, 'これは Issue の説明です。\n正しい用語のみを使っています。\n');

  // When: 明示的にそのファイルを対象として lint vocab を実行する
  const clean = runCli(['lint', 'vocab', 'clean.md'], { cwd: repo.dir });

  // Then: 違反なしとして終了コード0、標準エラー出力は空
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stderr, '');

  // Given: docs/GLOSSARY.md 上で「Issue」の禁止同義語と定義されている「チケット」を2行目に含む
  // 自作ファイル（1行目は違反なし、2行目・3行目に別の禁止語も含めて複数箇所検出できることを見る）
  const violatingFile = path.join(repo.dir, 'violation.md');
  fs.writeFileSync(
    violatingFile,
    ['違反なしの行です。', 'これはチケットの説明です。', '別の禁止語であるオーケストレーターも使う。'].join('\n') + '\n',
  );

  // When: そのファイルを対象として lint vocab を実行する
  const violating = runCli(['lint', 'vocab', 'violation.md'], { cwd: repo.dir });

  // Then: 終了コード1、ファイル:行・禁止語・正しい用語を含む標準エラー出力が得られる
  assert.equal(violating.status, 1);
  assert.match(
    violating.stderr,
    /violation\.md:2: 禁止語 'チケット' が見つかりました（'Issue' を使用してください）/,
  );
  assert.match(
    violating.stderr,
    /violation\.md:3: 禁止語 'オーケストレーター' が見つかりました（'進行役' を使用してください）/,
  );
  assert.doesNotMatch(violating.stderr, /violation\.md:1:/, '違反を含まない1行目は報告されないこと');
});

test('lint vocab: バッククォートのコードスパン・<placeholder>・スラッシュ区切りのパスリテラル内の禁止語は違反にならない（散文の誤用は引き続き検出される）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: docs/GLOSSARY.md 上で禁止語と定義されている「issue」（小文字。正しくは「成果物」）を、
  // (a) バッククォートのコードスパン内のファイルパス、(b) `<placeholder>` トークン内、
  // (c) バッククォート無しのスラッシュ区切りパスリテラル内、のそれぞれに埋め込んだファイルと、
  // (d) 実際に散文として「issue」を「成果物」の意味で誤用している行を用意する。
  const file = path.join(repo.dir, 'code-like.md');
  fs.writeFileSync(
    file,
    [
      'コードスパン内のパス参照: `.agent-skill-chain/templates/issue/SPEC.md` を正本とする。',
      'プレースホルダ: ブランチ名は `<type>/<issue-id>-<slug>` の形式に従う。',
      'バッククォート無しのパスリテラル: .agent-skill-chain/templates/issue/{SPEC,DESIGN}.md を参照する。',
      '散文としての誤用: このissueの内容を確認してください。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'code-like.md'], { cwd: repo.dir });

  // Then: 終了コード1（4行目の散文誤用のみが違反として報告される）。1〜3行目は
  // コード的参照（コードスパン・プレースホルダ・パスリテラル）として対象外になる。
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /code-like\.md:1:/, 'バッククォートのコードスパン内は対象外');
  assert.doesNotMatch(result.stderr, /code-like\.md:2:/, '<placeholder>内は対象外');
  assert.doesNotMatch(result.stderr, /code-like\.md:3:/, 'バッククォート無しのパスリテラルも対象外');
  assert.match(
    result.stderr,
    /code-like\.md:4: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '散文としての誤用は引き続き検出される',
  );
});

test('lint vocab: 禁止語自体がパス形式の文字列（.agent-skill-chain/source）の場合は、バッククォートやパスリテラル文脈でも除外せず検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: docs/GLOSSARY.md で「.agent-skill-chain/source」自体が禁止語（正しくは
  // 「agent-skill-chain」）と定義されている。この禁止語はパス形式のため、パスリテラル除外の
  // 対象にしてしまうと禁止語自体が検査不能になる（GLOSSARY.mdの用語定義列挙以外の箇所で
  // 誤って旧パス名を参照した場合に検出できなくなる）。バッククォート内・パスリテラル文脈の
  // 両方で埋め込んだファイルを用意する。
  const file = path.join(repo.dir, 'old-path.md');
  fs.writeFileSync(
    file,
    [
      'バッククォート内: `.agent-skill-chain/source` はもう存在しない旧ディレクトリである。',
      'バッククォート無し: .agent-skill-chain/source を参照していた記述は更新済みである。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'old-path.md'], { cwd: repo.dir });

  // Then: 終了コード1、両方の行が禁止語違反として報告される（パス形式の禁止語はコード的参照
  // 除外の対象外であるため）
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /old-path\.md:1: 禁止語 '\.agent-skill-chain\/source' が見つかりました（'agent-skill-chain' を使用してください）/,
  );
  assert.match(
    result.stderr,
    /old-path\.md:2: 禁止語 '\.agent-skill-chain\/source' が見つかりました（'agent-skill-chain' を使用してください）/,
  );
});

test('lint vocab: 識別子文脈（コード識別子・外部語彙許可リスト）としての禁止語利用は全ファイル種別で誤検出されない（Issue #187 ADR-1: 拡張子に依らず共通で維持）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: docs/GLOSSARY.md で禁止語と定義されている「issue」（小文字）を、コード識別子文脈・
  // 外部語彙許可リストのそれぞれで用いた行を用意する（.md 散文中でも維持される文脈）。
  const file = path.join(repo.dir, 'identifier-context.md');
  fs.writeFileSync(
    file,
    [
      // コード識別子文脈: snake_case/camelCaseの複合識別子の一部。
      'コード識別子文脈（snake_case）: issue_id フィールドを参照する。',
      'コード識別子文脈（camelCase）: issueId フィールドを参照する。',
      // 外部語彙の明示許可リスト: 改名不可の既知の完全一致トークン。
      '外部語彙許可リスト: blank_issues_enabled は GitHub公式スキーマのキー名である。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'identifier-context.md'], { cwd: repo.dir });

  // Then: 終了コード0（識別子文脈はいずれも誤検出されない）
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint vocab: SKILL.mdフロントマターの識別子文脈除外は値全体が単一のケバブケース識別子の場合のみに限定され、description/when_to_use等の自由記述フィールドのハイフン複合語に含まれる禁止語は引き続き検出される（手動implementation-gateレビュー指摘: lint-frontmatter-exemption-too-broad 是正の回帰テスト）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: SKILL.md相当のフロントマターに、(a) 値全体が単一のケバブケース識別子である
  // name: フィールド（禁止語issueを含む）と、(b) 値が空白を含む自由記述（散文）である
  // description:・when_to_use: フィールド（ハイフン複合語issue-drivenとして禁止語issueを含む）
  // を用意する。
  const file = path.join(repo.dir, 'skill-frontmatter.md');
  fs.writeFileSync(
    file,
    [
      '---',
      'name: issue-start',
      'description: Handle an issue-driven workflow for starting new work.',
      'when_to_use: Use for issue-driven onboarding scenarios.',
      '---',
      '',
      '# issue-start',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'skill-frontmatter.md'], { cwd: repo.dir });

  // Then: name:（単一のケバブケース識別子値）は引き続き除外され、description:・when_to_use:
  // （自由記述の値に含まれるハイフン複合語）は識別子文脈と誤認されず引き続き検出される。
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(
    result.stderr,
    /skill-frontmatter\.md:2:/,
    '2行目（name: issue-start、単一のケバブケース識別子値）は引き続き除外されること',
  );
  assert.match(
    result.stderr,
    /skill-frontmatter\.md:3: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '3行目（description:の自由記述の値内のissue-driven）は散文として引き続き検出されること',
  );
  assert.match(
    result.stderr,
    /skill-frontmatter\.md:4: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '4行目（when_to_use:の自由記述の値内のissue-driven）は散文として引き続き検出されること',
  );
});

test('lint vocab: YAMLキー・flow-sequence要素としての禁止語利用は .yaml/.yml でのみ誤検出されない（Issue #187 ADR-1: YAML文脈は真のYAMLファイルに限定適用）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 真の YAML ファイル（.yaml）に、YAMLキー文脈・flow-sequence要素文脈としての禁止語
  // 「issue」を用いた行を用意する。
  const file = path.join(repo.dir, 'identifier-context.yaml');
  fs.writeFileSync(
    file,
    [
      // YAMLキー文脈: 「行頭からの空白＋任意の`- `」の直後に出現し、直後（空白を挟んでよい）が`:`。
      'issue: 単独のYAMLキー文脈',
      '  issue: 字下げされたYAMLキー文脈',
      '- issue: リスト項目のキーとしてのYAMLキー文脈',
      'issues: GitHub Actions公式permission key',
      // flow-sequence要素: 直前（空白を挟んでよい）が`[`または`,`、直後（同様）が`,`または`]`。
      'flow-sequence要素: inputs: [issue, wip] のように書く。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'identifier-context.yaml'], { cwd: repo.dir });

  // Then: 終了コード0（.yaml では引き続きYAML識別子文脈として除外される）
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint vocab: CLIサブコマンド文脈としての禁止語利用は散文（.md）以外でのみ誤検出されない（Issue #187 ADR-1: CLIサブコマンド文脈は非.mdに限定適用）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 実コマンドを記述するシェルスクリプト（.sh、散文=.md ではない）に、CLIサブコマンド
  // 文脈としての禁止語「issue」を用いた行を用意する。
  const file = path.join(repo.dir, 'run.sh');
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      '# CLIサブコマンド文脈（動詞が後）: agent-skill-chain issue start を実行する。',
      '# CLIサブコマンド文脈（動詞が前）: acquire issue のように書く（対称チェック）。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'run.sh'], { cwd: repo.dir });

  // Then: 終了コード0（.md ではないため引き続きCLIサブコマンド文脈として除外される）
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint vocab: 単一引用符の禁止語リテラルは非散文コードの配列要素・関数引数で誤検出されない（Issue #469 AC-1・AC-2）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 実際の混入箇所と同じgh引数配列、および空白を含む一般的な配列要素・関数引数に、
  // 禁止語「issue」と完全一致する単一引用符リテラルを複数配置する。
  const file = path.join(repo.dir, 'quoted-literal-context.ts');
  fs.writeFileSync(
    file,
    [
      "gh(['issue', 'view', issueNumber, '--json', 'labels'], root);",
      "const values = [ first, 'issue' , last ];",
      "invoke( first, 'issue' , last );",
      "const onlyValue = ['issue'];",
      "invokeOnly('issue');",
    ].join('\n') + '\n',
  );

  // When: 非散文のTypeScriptファイルを対象にlint vocabを実行する。
  const result = runCli(['lint', 'vocab', 'quoted-literal-context.ts'], { cwd: repo.dir });

  // Then: すべてコード値リテラル文脈として扱われ、違反は報告されない。
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint vocab: 非散文ファイルの単一行コメント中にある禁止語リテラルを検出する（Issue #484 AC-1・AC-2）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const cases = [
    { name: 'quoted-literal-comment.ts', line: "const value = 1; // deprecated values: ('issue', 'legacy')" },
    { name: 'quoted-literal-comment.sh', line: "# deprecated values: ('issue', 'legacy')" },
    { name: 'quoted-literal-comment.yaml', line: "# deprecated values: ('issue', 'legacy')" },
    { name: 'quoted-literal-comment.yml', line: "# deprecated values: ('issue', 'legacy')" },
  ];

  for (const { name, line } of cases) {
    fs.writeFileSync(path.join(repo.dir, name), `${line}\n`);
    const result = runCli(['lint', 'vocab', name], { cwd: repo.dir });

    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(
      result.stderr,
      new RegExp(`${name.replace('.', '\\.')}:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）`),
    );
  }
});

test('lint vocab: 文字列リテラル内のコメント記号を無視し、実コメントだけをコメント開始と判定する（Issue #487 AC-1〜AC-4）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const cleanCases = [
    {
      name: 'comment-marker-in-string.ts',
      line: "const cfg = { url: 'https://example.com', tags: ['issue', 'other'] };",
    },
    {
      name: 'comment-marker-after-escaped-quote.ts',
      line: `const cfg = { label: "quoted \\\" // text", tags: ['issue', 'other'] };`,
    },
    {
      name: 'comment-marker-in-string.sh',
      line: "url='https://example.com/#fragment'; values=('issue')",
    },
    {
      name: 'comment-marker-in-string.yaml',
      line: `metadata: { url: "https://example.com/#fragment", tags: ['issue'] }`,
    },
    {
      name: 'comment-marker-in-string.yml',
      line: `metadata: { url: "https://example.com/#fragment", tags: ['issue'] }`,
    },
  ];

  for (const { name, line } of cleanCases) {
    fs.writeFileSync(path.join(repo.dir, name), `${line}\n`);
    const result = runCli(['lint', 'vocab', name], { cwd: repo.dir });

    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.equal(result.stderr, '', name);
  }

  const mixedName = 'quoted-literal-before-comment.ts';
  fs.writeFileSync(
    path.join(repo.dir, mixedName),
    "const values = ['issue']; // deprecated values: ('issue', 'legacy')\n",
  );
  const mixed = runCli(['lint', 'vocab', mixedName], { cwd: repo.dir });

  assert.equal(mixed.status, 1, mixed.stderr);
  assert.match(
    mixed.stderr,
    /quoted-literal-before-comment\.ts:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
  );
  assert.equal(mixed.stderr.trim().split('\n').length, 1, '実コメント中の禁止語だけが報告されること');
});

test('lint vocab: 単一引用符の禁止語を含む散文はコード値リテラル文脈として除外されない（Issue #469 AC-3）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 配列・関数引数と同じ境界に見える単一引用符表記を.mdの散文中に配置する。
  const file = path.join(repo.dir, 'quoted-literal-prose.md');
  fs.writeFileSync(file, "散文中の例: ['issue'] と ('issue') は禁止語の誤用である。\n");

  // When: 散文ファイルを対象にlint vocabを実行する。
  const result = runCli(['lint', 'vocab', 'quoted-literal-prose.md'], { cwd: repo.dir });

  // Then: 非散文限定の除外は適用されず、当該行が違反として報告される。
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /quoted-literal-prose\.md:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
  );
});

test('lint vocab: 散文（.md）中でYAMLキー風・CLIサブコマンド動詞と偶然共起する禁止語混入は、識別子文脈と誤判定せず違反として検出される（Issue #187 SC-3・Issue #178 finding-1 回帰）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 散文（.md）中に、(a) YAMLキー構文に見える行、(b) CLIサブコマンド動詞ホワイトリスト
  // （routesから導出される'create'等）に偶然共起する行、をそれぞれ用意する。修正前はいずれも
  // 識別子文脈と誤判定され検出漏れしていた（Issue #178 finding-1 が指摘した構造的抜け穴）。
  const file = path.join(repo.dir, 'prose-false-context.md');
  fs.writeFileSync(
    file,
    [
      'issue: これは会議の議題そのものを指す散文である。',
      '新しい issue create の手順を説明する。',
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'prose-false-context.md'], { cwd: repo.dir });

  // Then: 終了コード1、両行とも識別子文脈と誤判定せず違反として検出される（修正前は検出漏れ）
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /prose-false-context\.md:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    'YAMLキー風の散文は.mdではYAML識別子文脈とみなさず検出されること',
  );
  assert.match(
    result.stderr,
    /prose-false-context\.md:2: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    'CLIサブコマンド動詞と偶然共起する散文は.mdではCLIサブコマンド文脈とみなさず検出されること',
  );
});

test('lint vocab: 識別子文脈に隣接していても、散文としての禁止語混入は引き続き検出される（regressionなし、ISSUE-178 AC-2）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const file = path.join(repo.dir, 'identifier-context-prose.md');
  fs.writeFileSync(
    file,
    [
      // 1行目: 同一行内で識別子文脈（issue_id）と散文誤用（単独のissue）が両方出現する。
      // 識別子文脈側は除外されるが、散文側は引き続き検出されなければならない。
      'issue_id フィールドと、issueそのものの説明は別物である。',
      // 2行目: 単独の散文誤用のみ。
      'このissueの内容を確認してください。',
      // 3行目: 複合境界が無い「issues」（複数形）は識別子文脈のいずれにも該当せず、
      // 散文誤用として引き続き検出対象に残る（複数形化のみでは識別子文脈の境界とみなさない、という仕様の意図的な非除外例）。
      'issuesを一覧するコマンドがある。',
    ].join('\n') + '\n',
  );

  const result = runCli(['lint', 'vocab', 'identifier-context-prose.md'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /identifier-context-prose\.md:1: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '1行目の識別子文脈（issue_id）は除外されつつ、同一行の散文誤用は検出されること',
  );
  assert.match(
    result.stderr,
    /identifier-context-prose\.md:2: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
  );
  assert.match(
    result.stderr,
    /identifier-context-prose\.md:3: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '複合境界の無い"issues"は識別子文脈と誤認せず引き続き検出されること',
  );
});

test('lint vocab: 非散文ファイル（.ts等）ではASCII識別子・トークン内部の部分文字列としての禁止語出現は誤検出しない（ISSUE-283）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: .ts ファイルに、区切り文字の無い英語の屈折形（issues/issued）・既存の複合識別子
  // （issueRecord・issue_id）・真に単独のbare `issue` 識別子を混在させる。
  const file = path.join(repo.dir, 'identifier-context.ts');
  fs.writeFileSync(
    file,
    [
      'const issued = await fetchToken(); // 許容: 過去形の屈折形',
      'if (!issued.token) throw new Error();',
      "const runningIssues = 'issues'; // 許容: 複数形の屈折形（引用符内も含む）",
      'const issueRecord: IssueRecord = load(); // 許容: 既存のcamelCase複合識別子',
      'const issue_id = issueRecord.issue_id; // 許容: 既存のsnake_case複合識別子',
      'const issue = issueRecord; // 拒否: 単独のbare識別子',
    ].join('\n') + '\n',
  );

  const result = runCli(['lint', 'vocab', 'identifier-context.ts'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  for (const line of [1, 2, 3, 4, 5]) {
    assert.doesNotMatch(
      result.stderr,
      new RegExp(`identifier-context\\.ts:${line}:`),
      `${line}行目（issued/issues/issueRecord/issue_idの屈折形・複合識別子）は誤検出されないこと`,
    );
  }
  assert.match(
    result.stderr,
    /identifier-context\.ts:6: 禁止語 'issue' が見つかりました（'成果物' を使用してください）/,
    '6行目の単独bare issue識別子は引き続き検出されること',
  );
});

test('lint vocab: カタカナのみの禁止語がより長い別のカタカナ複合語に埋め込まれている場合は誤検出しない。禁止語単体での出現は引き続き検出される（Issue #525）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: docs/GLOSSARY.md 上で「writer lease」の禁止同義語と定義されている「ロック」を、
  // (a) 無関係な別のカタカナ複合語「ブロック」の内部に部分文字列として含む行、
  // (b) 禁止語単体としてそのまま出現する行の両方を用意する。
  const file = path.join(repo.dir, 'katakana-compound.md');
  fs.writeFileSync(
    file,
    [
      'JSDocのブロックコメント内かどうかを判定する。', // 「ブロック」内の「ロック」は誤検出しないこと
      'writer leaseはロックを取得してから作業する。', // 「ロック」単体は引き続き検出されること
    ].join('\n') + '\n',
  );

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'katakana-compound.md'], { cwd: repo.dir });

  // Then: 終了コード1（2行目のみが違反として報告される）。1行目の「ブロック」内の「ロック」は
  // より長い連続カタカナ列に埋め込まれているため対象外になる。
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stderr,
    /katakana-compound\.md:1:/,
    '「ブロック」に埋め込まれた「ロック」は誤検出されないこと',
  );
  assert.match(
    result.stderr,
    /katakana-compound\.md:2: 禁止語 'ロック' が見つかりました（'writer lease' を使用してください）/,
    'カタカナ単体での禁止語出現は引き続き検出されること',
  );
});

test('lint vocab: 中黒（・）で区切られたカタカナ複合語は中黒を境界として分割され、区切られた片方が禁止語単体と一致する場合は検出される（Issue #525 レビュー指摘の回帰）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 「ロック・スター」は中黒で区切られた別々のカタカナ複合語であり、「ロック」は
  // 「スター」に埋め込まれた部分文字列ではなく禁止語単体としての出現である。
  const file = path.join(repo.dir, 'katakana-nakaguro.md');
  fs.writeFileSync(file, 'writer leaseはロック・スターのように取得する。\n');

  // When: このファイルを対象に lint vocab を実行する
  const result = runCli(['lint', 'vocab', 'katakana-nakaguro.md'], { cwd: repo.dir });

  // Then: 中黒をrunの境界として扱うため「ロック」は「スター」と連結されたより長いrunに
  // 埋め込まれているとは判定されず、禁止語単体の出現として検出される。
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /katakana-nakaguro\.md:1: 禁止語 'ロック' が見つかりました（'writer lease' を使用してください）/,
    '中黒で区切られた「ロック・スター」内の「ロック」は禁止語単体として検出されること',
  );
});

test('lint vocab: path引数省略時のデフォルト対象（AGENTS.md・.agent-skill-chain資産全体）は違反なしで終了コード0になる（ISSUE-178 AC-4: templates/config/schemas/scriptsも含めて対象）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: path引数を省略し、defaultVocabFileRoots（AGENTS.md・.agent-skill-chain/{standards,
  // templates,config,schemas,scripts,ci}。docs/GLOSSARY.mdは自己言及のため恒久除外のみ）を対象に実行する
  const result = runCli(['lint', 'vocab'], { cwd: repo.dir });

  // Then: 複製元である実物のAGENTS.md・.agent-skill-chain/資産一式は識別子文脈認識スキャナ導入後、
  // 禁止語混入が無い状態を維持している前提のため、終了コード0・標準エラー出力は空になることを期待する。
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint references: 実在する見出しへの§参照・安定ID接尾辞つき参照・バッククォート例示は違反にならない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 見出し「不変条件 I1〜I8」を持つファイルと、それを参照する側のファイル。参照側は
  // (a) 見出しテキストそのものへの§参照、(b) 見出しの安定ID接尾辞（headingCore が取り除く末尾の
  // 英数字コード「I7」）を伴う§参照、(c) バッククォートで囲んだ例示的な file:line 参照 を含む。
  fs.writeFileSync(path.join(repo.dir, 'headings.md'), '# 見出し\n\n## 不変条件 I1〜I8\n\n本文。\n');
  fs.writeFileSync(
    path.join(repo.dir, 'refs.md'),
    [
      '見出しテキストそのものへの参照: §不変条件I1〜I8 を確認する。',
      '安定ID接尾辞つき参照: §不変条件I7 を確認する。',
      'バッククォート例示は違反にならない: `file.ts:123` を参照。',
    ].join('\n') + '\n',
  );

  // When: 両ファイルを対象に lint references を実行する
  const result = runCli(['lint', 'references', 'headings.md', 'refs.md'], { cwd: repo.dir });

  // Then: いずれも正当な参照として扱われ、違反なしで終了コード0
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint references: 見出しに解決できない§参照と素のfile:line参照は違反として検出される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: (a) どの見出しにも解決できない§参照、(b) バッククォートで囲まれていない素の
  // ファイルパス+行番号参照 を含む自作ファイル（見出しを持つファイルは対象に含めない）
  fs.writeFileSync(
    path.join(repo.dir, 'bad-refs.md'),
    ['不明な節: §存在しない見出し を参照。', '直書きの行番号参照: src/foo.ts:123 は禁止パターン。'].join('\n') + '\n',
  );

  // When: そのファイルを対象に lint references を実行する
  const result = runCli(['lint', 'references', 'bad-refs.md'], { cwd: repo.dir });

  // Then: 終了コード1、両方の違反がそれぞれ標準エラー出力に報告される
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /bad-refs\.md:1: 禁止参照 '§存在しない見出し'（見出しテキストで解決できないセクション番号参照）/,
  );
  assert.match(result.stderr, /bad-refs\.md:2: 禁止参照 'src\/foo\.ts:123'（ファイルパス＋行番号参照）/);
});

test('lint references: path省略時のデフォルト対象は本体 .github/workflows/ を含み、そこに置かれた解決不能な§参照を検出する（Issue #221: 実デプロイ済みワークフローYAMLが走査対象から漏れていた検出漏れの回帰テスト）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: このリポジトリには元々 .github/workflows/ が存在しない（createTmpRepo は
  // .agent-skill-chain/・docs/GLOSSARY.md・AGENTS.md・README.md のみを複製する）ため、
  // 実デプロイされるワークフローYAMLを模した、見出しに解決できない§参照を含むファイルを追加する。
  const workflowsDir = path.join(repo.dir, '.github', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'sample.yml'), '# 正本: AGENTS.md §存在しない見出し\n');

  // When: path引数を省略し、デフォルト対象（defaultReferenceFileRoots）で lint references を実行する
  const result = runCli(['lint', 'references'], { cwd: repo.dir });

  // Then: 終了コード1、.github/workflows/sample.yml の禁止参照が報告される（対象拡張前は
  // .github/ が走査対象外だったため、この違反は検出されなかった）
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /sample\.yml:1: 禁止参照 '§存在しない見出し'（見出しテキストで解決できないセクション番号参照）/,
  );
});

test('lint references: 実物リポジトリのデフォルト対象（src/ を含む）は違反0で通る', async () => {
  // Given/When: このリポジトリ自身に対して path 引数を省略し、デフォルト対象
  // （defaultReferenceFileRoots、src/ を含む）で lint references を実行する。
  const result = runCli(['lint', 'references'], { cwd: realRepoRoot });

  // Then: 違反なしで終了コード0。
  assert.equal(result.status, 0, result.stderr);
});

// 文書名（.md拡張子を持つ語）に、助詞・記号を挟んでもよい形で「設計要素」「手順」等の
// 見出し的な語＋番号（半角・全角）が続くパターンを広く捕捉する。過度な一般語誤検知を避けるため、
// 「見出し的な語＋番号」への着地を要求する。
const headingRefPattern = /\.md\s*(?:の|または|／|\/|-|:|：)?\s*(?:設計要素|手順)\s*[0-9０-９]/g;
// 文書名を伴わない「手順N」単独の宙吊り参照（直後に数字が続く「手順N」形式に限定し、
// 「手順」という単語の他の正当な使用法を誤検知しないようにする）。
const danglingStepRefPattern = /手順[0-9０-９]/g;

interface CommentReferenceViolation {
  relPath: string;
  lineNo: number;
  label: string;
  matched: string;
}

/**
 * Issue #510: root配下の対象ファイル（walkTextFiles収集）について、禁止された見出し位置参照
 * 文字列（headingRefPattern・danglingStepRefPattern）が**ソースコードコメント内**に出現する
 * 箇所のみを収集する。AGENTS.md「参照・コメントの陳腐化防止」が禁止するのはソースコードコメント
 * における見出し位置参照であり、コメント以外（文字列リテラル・実行時に利用者へ表示される
 * メッセージ等）での同じ文字列出現は規約違反ではないため、各マッチ位置が単一行コメント内かどうかを
 * `src/commands/lint.ts` が既に持つ `isInSingleLineComment`（`commentMarkerFor`・
 * `findUnquotedCommentMarkerIndex` を内部で使用）と同種のロジックで判定し、コメント外のマッチは
 * 除外する（Issue #517・是正後は本ファイル内のバッククォート追跡版ヘルパーを使う。後述）。
 *
 * 手動implementation-gate strictレビュー指摘（両レビュア共通）: `isInSingleLineComment` は
 * 単一行コメント記号（`.ts`なら`//`）のみを扱う設計であり、複数行ブロックコメント
 * （`/* ... *\/` 形式。JSDocスタイルの `/** ... *\/` と、その継続行である ` * ...` を含む）は
 * 単一行コメント記号が行内に現れないため常に対象外になり、本テストの検知漏れになっていた
 * （このテストが防ごうとしていた元の違反自体がJSDocブロックコメント内にあった）。
 * `src/commands/lint.ts` 側の本番関数はスコープを変更せず、本関数側でのみ複数行ブロック
 * コメントの追跡状態（前の行で開始し閉じていなければ次の行もブロックコメント内）を保持し、
 * ブロックコメント内にある行は行全体を検査対象として扱う。
 *
 * 手動implementation-gate strictレビュー2回目・指摘（block-comment-detection-latches-on-
 * string-literal）: ブロックコメント開始判定は文字列リテラル内の`/*`部分文字列（globパターン
 * 等）にも反応してしまい、対応する`*\/`が同一行に無い場合はそれ以降の行全体を誤ってコメント扱い
 * する偽陽性があった。開始判定は`src/commands/lint.ts`の`findUnquotedCommentMarkerIndex`
 * （引用符の外側にある最初のマーカー位置を返す）を用いて、引用符の外側にある`/*`のみを開始と
 * 認める。終了判定（`*\/`検出）はブロックコメント継続行では対象行全体が既にコメント本文であり
 * 実際の文字列リテラルは存在しないため、引用符追跡を適用すると逆にコメント本文中の引用符文字を
 * 誤ってクオート開始と解釈しかねない。そのため終了判定は単純な部分文字列検索のまま維持する。
 *
 * 手動implementation-gate strictレビュー3回目・指摘（両レビュア共通、根本原因は同一）:
 * 引用符の外側判定だけでは以下2種の偽陽性が残っていた。(1) `/* ... *\/`が実際にブロック
 * コメント構文として成立するのは本リポジトリでは`.ts`ファイルのみだが、拡張子を見ずに全
 * ファイル種別へ一律適用していたため、`.sh`（`cp "$src"/* "$dst"/`）・`.yaml`（`path/*`）・
 * `.md`（`**\/*.ts`のような散文中のglob表記）内の、コメント構文ではない単なるglob・パス
 * 断片の`/*`まで誤ってブロックコメント開始と判定していた。(2) `.ts`ファイルであっても、
 * `// 対象は src/*.ts のみ`のような単一行コメント本文中に`/*`という部分文字列が現れると、
 * これも引用符の外側にあるため誤ってブロックコメント開始と判定していた。是正として、
 * ブロックコメントの状態機械自体を`ext === '.ts'`のときのみ起動し（`.ts`以外は
 * `inBlockComment`・`lineIsBlockComment`とも常に`false`のまま）、かつ`.ts`ファイル内でも
 * `/*`の位置が同じ行の単一行コメント開始位置（`findUnquotedCommentMarkerIndex(line, '//')`）
 * より前にある場合のみ真のブロックコメント開始として扱う。
 *
 * Issue #513・是正: ブロックコメント判定は上記までのみだと行単位の単一boolean
 * （`lineIsBlockComment`）で表現されており、同一行で開いて閉じるブロックコメント
 * （例: `const x = 1; /* note *\/ const y = '手順1';`）の場合、`*\/`より後ろにある
 * 正当なコード部分まで行全体が誤ってコメント扱いされる偽陽性があった。是正として、
 * 行全体に対するbooleanではなく、その行で実際にブロックコメントが及ぶ文字位置の区間
 * （開始オフセット・終了オフセットの半開区間）を計算し、各マッチ位置（`match.index`）が
 * その区間内にあるかどうかで判定する。前の行から継続中（`inBlockComment`）の場合は区間の
 * 開始を行頭（位置0）とする。同一行内に対応する`*\/`が見つかった場合は区間をその終了位置
 * までに限定し、それより後ろの文字位置は区間外（通常のコード）として扱う。`*\/`が同一行に
 * 見つからない場合は区間を行末まで延ばし、状態を次行へ持ち越す（現行の挙動と同じ）。
 *
 * Issue #515・是正: 区間は1行につき単一の`blockCommentRange`ではなく、複数存在しうる
 * 区間の配列`blockCommentRanges`として一般化する。1つ目の`/*`区間（同一行内で閉じた場合は
 * その終了位置、前の行から継続中で閉じなかった場合は行末）が確定した直後の位置から、
 * さらに同じ行の続きに対して次の`/*`（単一行コメントより前・引用符の外側にあるもの）を
 * 探すループへ変更し、見つかるたびに区間を配列へ追加する。前の行からの継続・行末までの
 * 延長・次行への持ち越しという既存の挙動はそのまま維持する。マッチ位置の判定は区間配列の
 * いずれかに含まれるかどうかで行う。
 *
 * Issue #517・是正: ブロックコメント開始判定・単一行コメント開始判定はどちらも
 * `src/commands/lint.ts`の`findUnquotedCommentMarkerIndex`（単一引用符・二重引用符のみを
 * 引用符として追跡）を再利用していたため、`.ts`ファイル内のテンプレートリテラル
 * （バッククォート文字列）に含まれる`/* ... *\/`風・`//`風の部分文字列を、引用符の外側と
 * 誤判定していた。`src/commands/lint.ts`本体は変更せず、本ファイル内でのみバッククォートも
 * 引用符として追跡するテスト専用ロジックを実装し、両判定をこちらへ置き換える。複数行に
 * またがるテンプレートリテラルへの完全対応・正規表現リテラル内`/*`風文字列への対応は対象外
 * とする（単一行で完結するテンプレートリテラルのみを扱う）。
 *
 * Issue #519（当初是正）: バッククォートで囲まれた範囲全体（`${...}`補間式の内部を含む）を
 * 無条件に「引用符の内側（文字列）」として扱っていたため、補間式の内部に実在するコメント
 * （例: `` `結果: ${/* 注記 *\/ value}` ``）を誤って文字列扱いし、検査から見逃していた
 * （偽陰性）。補間式内部を実際のコードとして扱う状態管理を導入した。
 *
 * Issue #519・手動implementation-gate strictレビュー指摘（rest-slice-backtick-
 * misinterpretation-swallows-later-comment）・根本是正: 当初のIssue #519是正は、1行内に複数の
 * ブロックコメント区間を探す際、1つ目の区間が確定するたびに`line.slice(searchFrom)`で部分文字列
 * を切り出し、バッククォート追跡ヘルパーを**空のスタックから**再走査していた。このため、行の前半
 * で開いたテンプレートリテラルが`searchFrom`より後でまだ閉じていない場合、2回目以降の走査は
 * その閉じバッククォートを「新しいテンプレートリテラルの開始」と誤認し、以降にある実在の
 * ブロックコメント（例: `` `${/*c*\/ a}` /* outer comment *\/; ``の`outer comment`）を検知
 * できない退行があった。根本原因は「部分文字列を切り出して状態をリセットして再走査する」という
 * 構造自体にあるため、部分パッチではなく、1行につき位置0から行末まで**状態を一度もリセットせず
 * 単一パスで走査する**`scanLineForCommentRanges`へ設計を変更した。引用符・バッククォート
 * 文字列・補間式・ブロックコメントの状態はすべて同一の走査ループの中で一貫して更新され続ける。
 * 従来の複数の小さなヘルパー（`findUnquotedMarkerIndexTrackingBacktick`・
 * `isInSingleLineCommentTrackingBacktick`）はこの単一パス関数へ統合し、重複ロジックを排除した。
 */

interface LineCommentScanResult {
  /** その行で実際にブロックコメントが及ぶ文字位置の半開区間 [start, end) の配列。
   * 1行に複数のブロックコメントが存在しうるため配列化する（区間が無い行は空配列）。 */
  blockCommentRanges: Array<[number, number]>;
  /** 単一行コメント（`//`・`#`）が開始する文字位置。見つからなければnull。 */
  singleLineCommentStart: number | null;
  /** 行末時点でまだブロックコメントの内部にあるか（次行へ持ち越す状態）。 */
  endsInsideBlockComment: boolean;
}

/**
 * Issue #519根本是正: 1行を位置0から行末まで、状態（引用符・バッククォート文字列・補間式・
 * ブロックコメント）を一度もリセットせず単一パスで走査し、ブロックコメント区間の配列と単一行
 * コメントの開始位置を求める。`inBlockCommentAtStart`は前の行から継続中のブロックコメント状態
 * （`.ts`のみ意味を持つ）。ブロックコメント構文（`/* ... *\/`）は`.ts`ファイルのみで認識する
 * （`.sh`・`.yaml`・`.yml`・`.md`等ではglob・パス断片・散文中の`/*`をコメントと誤認しない）。
 * 単一行コメント記号は`commentMarkerFor`（`.ts`は`//`、`.sh`/`.yaml`/`.yml`は`#`、それ以外は
 * 無し）に従う。トップレベル（コード）位置、および`${...}`補間式の内部（ネストする`{}`の深さを
 * 追跡）は「実際のコード」として扱い、そこでのみブロックコメント・単一行コメントの開始を認識する。
 * 単一引用符・二重引用符・バッククォート文字列の内部はいずれもエスケープ（`\`）を考慮し、対応する
 * 終端文字が現れるまでコメント判定を行わない。複数行にまたがるテンプレートリテラル・複数行に
 * またがる補間式・正規表現リテラル内の`/*`風文字列への完全対応は対象外とする。
 */
function scanLineForCommentRanges(
  line: string,
  ext: string,
  inBlockCommentAtStart: boolean,
): LineCommentScanResult {
  type QuoteFrame = { kind: 'quote'; char: "'" | '"' };
  type BacktickStringFrame = { kind: 'backtick-string' };
  type InterpolationFrame = { kind: 'interpolation'; braceDepth: number };
  type Frame = QuoteFrame | BacktickStringFrame | InterpolationFrame;

  const stack: Frame[] = [];
  const blockCommentRanges: Array<[number, number]> = [];
  const singleLineMarker = commentMarkerFor(ext);
  const blockCommentSupported = ext === '.ts';

  let inBlockComment = inBlockCommentAtStart && blockCommentSupported;
  let blockCommentStart = inBlockComment ? 0 : -1;
  let singleLineCommentStart: number | null = null;

  let i = 0;
  while (i < line.length) {
    if (inBlockComment) {
      if (line.startsWith('*/', i)) {
        blockCommentRanges.push([blockCommentStart, i + 2]);
        inBlockComment = false;
        blockCommentStart = -1;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    const top: Frame | undefined = stack[stack.length - 1];

    // top が無い（トップレベル）、または補間式の内部は「実際のコード」として走査し、
    // ここでのみブロックコメント・単一行コメントの開始を認識する。
    if (top === undefined || top.kind === 'interpolation') {
      if (singleLineMarker !== undefined && line.startsWith(singleLineMarker, i)) {
        singleLineCommentStart = i;
        break;
      }
      if (blockCommentSupported && line.startsWith('/*', i)) {
        inBlockComment = true;
        blockCommentStart = i;
        i += 2;
        continue;
      }
      const char = line[i];
      if (char === "'" || char === '"') {
        stack.push({ kind: 'quote', char });
        i++;
        continue;
      }
      if (char === '`') {
        stack.push({ kind: 'backtick-string' });
        i++;
        continue;
      }
      if (top !== undefined) {
        // top.kind === 'interpolation'：補間式内部のオブジェクトリテラル等による`{`・`}`の
        // ネスト深さを追跡し、最も外側の`${`に対応する`}`でのみ補間式を抜ける。
        if (char === '{') {
          top.braceDepth++;
          i++;
          continue;
        }
        if (char === '}') {
          if (top.braceDepth === 0) {
            stack.pop();
          } else {
            top.braceDepth--;
          }
          i++;
          continue;
        }
      }
      i++;
      continue;
    }

    // top が引用符（'・"）の内部：エスケープを考慮し、対応する引用符で閉じるまでコメント
    // 判定は行わない。
    if (top.kind === 'quote') {
      if (line[i] === '\\') {
        i += 2;
        continue;
      }
      if (line[i] === top.char) {
        stack.pop();
      }
      i++;
      continue;
    }

    // top がバッククォート文字列の内部（補間式の外側の通常の文字列部分）：`${`が現れたら
    // 補間式（コード）へ入る。それ以外はコメント判定を行わない。
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] === '`') {
      stack.pop();
      i++;
      continue;
    }
    if (line[i] === '$' && line[i + 1] === '{') {
      stack.push({ kind: 'interpolation', braceDepth: 0 });
      i += 2;
      continue;
    }
    i++;
  }

  if (inBlockComment) {
    blockCommentRanges.push([blockCommentStart, line.length]);
  }

  return { blockCommentRanges, singleLineCommentStart, endsInsideBlockComment: inBlockComment };
}

function findCommentReferenceViolations(root: string, files: string[]): CommentReferenceViolation[] {
  const violations: CommentReferenceViolation[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(root, file);
    const ext = path.extname(file);
    const lines = content.split('\n');

    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { blockCommentRanges, singleLineCommentStart, endsInsideBlockComment } = scanLineForCommentRanges(
        line,
        ext,
        inBlockComment,
      );
      inBlockComment = endsInsideBlockComment;

      for (const [pattern, label] of [
        [headingRefPattern, '見出し位置参照文字列'],
        [danglingStepRefPattern, '宙吊りの手順番号参照'],
      ] as const) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const isInBlockCommentRange = blockCommentRanges.some(
            ([start, end]) => match!.index >= start && match!.index < end,
          );
          const isInSingleLineComment =
            singleLineCommentStart !== null && singleLineCommentStart < match.index;
          if (isInBlockCommentRange || isInSingleLineComment) {
            violations.push({ relPath, lineNo: i + 1, label, matched: match[0] });
          }
          if (match[0].length === 0) pattern.lastIndex++;
        }
      }
    }
  }
  return violations;
}

test('src/配下: 禁止された見出し位置参照文字列（<文書名>.md<助詞・記号>設計要素<N>等・宙吊りの手順<N>番号参照）をソースコードコメントに含まない（Issue #507: ソースコードコメントへの見出し位置参照混入の回帰防止、Issue #510: 検査対象をコメント部分のみへ限定）', () => {
  // Given/When: このリポジトリ自身の src/ 配下の全対象ファイル（walkTextFiles が収集する
  // .md/.yaml/.yml/.sh/.json/.ts）を対象に、コメント部分のみへ検査範囲を絞ってスキャンする。
  // src/commands/upgrade.ts 単体ではなく src/ 全体を対象にすることで、同種の混入が他ファイルへ
  // 再発しても検出できるようにする。
  //
  // 注記: `lint references` の禁止参照検出パターン（見出し形式・file.ext:行番号形式の2種のみ）は、
  // 文書名（`.md`拡張子）の直後に助詞・記号を挟んでもよい形で「設計要素」「手順」等の見出し的な語
  // ＋数字が続く形式や、対応する番号付きリストの定義を伴わずに残存する番号のみの宙吊り参照を検出できない
  // （検出パターン自体の拡張は本テストのスコープ外）。そのため `lint references` の終了コードに
  // 依存せず、かつて混入していた具体的な違反パターンがコメント内に存在しないことを直接assertする。
  const srcRoot = path.join(realRepoRoot, 'src');
  const files = walkTextFiles([srcRoot]);
  assert.ok(files.length > 0, 'src/ 配下の対象ファイルが1件以上存在すること');

  const violations = findCommentReferenceViolations(realRepoRoot, files);

  // Then: 「<文書名>.md<助詞・記号>設計要素<N>」等の見出し位置参照文字列、および「手順」＋数字
  // という番号付き手順への宙吊り参照のいずれも、コメント内に残存していない
  // （Issue #507で `DESIGN.md 設計要素7` → `Issue #503` 等へ、「手順1」「手順2」→処理内容を
  // 直接説明する自己完結した文言へ是正済み）。
  assert.deepEqual(
    violations,
    [],
    violations
      .map((v) => `${v.relPath}:${v.lineNo} のコメントに${v.label}が残存している: ${JSON.stringify(v.matched)}`)
      .join('\n'),
  );
});

test('src/配下: コメント以外（文字列リテラル等）の「手順1」等の文字列は誤検知しない（Issue #510回帰防止）', () => {
  // Given: 「手順1」を含むが、コメントではなく文字列リテラル（実行時に利用者へ表示されうる
  // 案内メッセージを模したもの）としてのみ出現する合成ファイルと、
  // 同じ文字列を単一行コメント内に含む合成ファイルを用意する。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-comment-scope-'));
  try {
    const nonCommentFile = path.join(tmpRoot, 'non-comment.ts');
    fs.writeFileSync(nonCommentFile, "export const guide = '手順1: 対象ディレクトリを確認してください';\n");

    const commentFile = path.join(tmpRoot, 'comment.ts');
    fs.writeFileSync(commentFile, '// DESIGN.md 設計要素7を参照。手順1を実行する。\nexport const noop = true;\n');

    // When/Then: 文字列リテラルのみに出現する場合は違反として検出しない。
    const nonCommentViolations = findCommentReferenceViolations(tmpRoot, [nonCommentFile]);
    assert.deepEqual(nonCommentViolations, [], 'コメント外の「手順1」を誤って検出している');

    // When/Then: 単一行コメント内に出現する場合は違反として検出する
    // （検出ロジック自体がコメント判定を素通ししていないことの確認）。
    const commentViolations = findCommentReferenceViolations(tmpRoot, [commentFile]);
    assert.ok(commentViolations.length > 0, 'コメント内の見出し位置参照文字列を検出できていない');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: JSDocスタイルの複数行ブロックコメント内にある見出し位置参照文字列を検出する（手動implementation-gateレビュー指摘: block-comment-blind-spot 是正の回帰テスト）', () => {
  // Given: `isInSingleLineComment` は単一行コメント記号（.tsなら`//`）のみを扱う設計であり、
  // 複数行ブロックコメント（`/** ... */`形式、継続行が` * `で始まる形式）には該当記号が行内に
  // 現れないため素通りしてしまう。本Issue系列（#507）が実際に是正した元の違反は、まさにこの
  // JSDocブロックコメント内にあった。開始行(`/**`)・継続行(` * ...`)・終了行(` */`)のそれぞれに
  // 見出し位置参照文字列・宙吊りの手順番号参照を含む合成ファイルを用意する。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-block-comment-scope-'));
  try {
    const blockCommentFile = path.join(tmpRoot, 'block-comment.ts');
    fs.writeFileSync(
      blockCommentFile,
      [
        '/**',
        ' * DESIGN.md 設計要素7: 対象の保存・復元方針を説明する。',
        ' * 続けて手順1を実行し、手順2で検証する。',
        ' */',
        'export const noop = true;',
      ].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [blockCommentFile]);

    // Then: ブロックコメント内の見出し位置参照文字列（2行目）・宙吊りの手順番号参照
    // （3行目、手順1・手順2の2件）がいずれも検出される。
    assert.ok(
      violations.some((v) => v.lineNo === 2 && v.label === '見出し位置参照文字列'),
      'JSDocブロックコメント開始直後の継続行にある見出し位置参照文字列を検出できていない',
    );
    const danglingStepViolations = violations.filter((v) => v.lineNo === 3 && v.label === '宙吊りの手順番号参照');
    assert.equal(
      danglingStepViolations.length,
      2,
      'JSDocブロックコメント継続行にある2件の宙吊りの手順番号参照（手順1・手順2）を検出できていない',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: globパターン等、文字列リテラル内の"/*"部分文字列をブロックコメント開始と誤検知しない（手動implementation-gateレビュー2回目指摘: block-comment-detection-latches-on-string-literal 是正の回帰テスト）', () => {
  // Given: 実際のブロックコメントは無いが、1行目がglobパターンの文字列リテラル（`'**/*.ts'`）を
  // 含み、その部分文字列`/*`が引用符を考慮しない実装ではブロックコメント開始と誤判定されうる。
  // 誤判定された場合、対応する`*/`が同一行に無いため`inBlockComment`がtrueのまま維持され、
  // 2行目以降のコード（コメントではない文字列リテラル中の「手順1」を含む）が丸ごと
  // 「行全体がコメント」として扱われ、誤って違反報告される。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-glob-literal-scope-'));
  try {
    const globLiteralFile = path.join(tmpRoot, 'glob-literal.ts');
    fs.writeFileSync(
      globLiteralFile,
      [
        "const pattern = '**/*.ts';",
        "export const guide = '手順1: 対象ディレクトリを確認してください';",
      ].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [globLiteralFile]);

    // Then: 実際のブロックコメントが存在しないため、2行目の文字列リテラル中の「手順1」は
    // コメント扱いされず違反として検出されない。
    assert.deepEqual(
      violations,
      [],
      violations
        .map((v) => `${v.relPath}:${v.lineNo} を誤ってコメント扱いし違反検出している: ${JSON.stringify(v.matched)}`)
        .join('\n'),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: .shファイル内のglob・パス断片としての"/*"をブロックコメント開始と誤検知しない（手動implementation-gateレビュー3回目指摘: block-comment-open-detection-ignores-extension 是正の回帰テスト）', () => {
  // Given: `/* ... */`がブロックコメント構文として成立するのは本リポジトリでは.tsファイルのみ
  // であり、.shファイル中の`cp "$src"/* "$dst"/`のような`/*`はコメントではなく単なるglob・
  // パス断片である。拡張子を見ずに一律適用する実装では、対応する`*/`が同一行に無いため
  // それ以降の行全体が誤ってコメント扱いされ、後続の正当な行（「手順1」を含む）が誤検出される。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-shell-glob-scope-'));
  try {
    const shellFile = path.join(tmpRoot, 'copy.sh');
    fs.writeFileSync(
      shellFile,
      ['#!/bin/sh', 'cp "$src"/* "$dst"/', 'echo "手順1: コピー完了を確認してください"'].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [shellFile]);

    // Then: .shファイルにブロックコメント構文は存在しないため、3行目の「手順1」を含む文字列は
    // コメント扱いされず違反として検出されない。
    assert.deepEqual(
      violations,
      [],
      violations
        .map((v) => `${v.relPath}:${v.lineNo} を誤ってコメント扱いし違反検出している: ${JSON.stringify(v.matched)}`)
        .join('\n'),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: .mdファイル内の散文中のglob表記としての"/*"をブロックコメント開始と誤検知しない（手動implementation-gateレビュー3回目指摘: block-comment-open-detection-ignores-extension 是正の回帰テスト）', () => {
  // Given: .mdファイルにもブロックコメント構文（/* ... */）は存在しない。
  // `対象は **/*.ts です`のような散文中のglob表記の`/*`部分文字列を拡張子を見ずに一律適用する
  // 実装では誤ってブロックコメント開始と判定し、対応する`*/`が同一行に無いため後続の行全体
  // （「手順1」を含む正当な行）が誤ってコメント扱いされ違反検出される。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-md-glob-scope-'));
  try {
    const mdFile = path.join(tmpRoot, 'guide.md');
    fs.writeFileSync(
      mdFile,
      ['対象は **/*.ts です。', '手順1: 対象ディレクトリを確認してください。'].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [mdFile]);

    // Then: .mdファイルにブロックコメント構文は存在しないため、2行目の「手順1」を含む文字列は
    // コメント扱いされず違反として検出されない
    // （commentMarkerForが.mdをundefinedとして扱う既存の単一行コメント判定でも元々検出されない）。
    assert.deepEqual(
      violations,
      [],
      violations
        .map((v) => `${v.relPath}:${v.lineNo} を誤ってコメント扱いし違反検出している: ${JSON.stringify(v.matched)}`)
        .join('\n'),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: .tsファイル内の単一行コメント本文中に現れる"/*"をブロックコメント開始と誤検知しない（手動implementation-gateレビュー3回目指摘: block-comment-open-latches-on-single-line-comment 是正の回帰テスト）', () => {
  // Given: `// 対象は src/*.ts のみ`のような単一行コメント本文中に`/*`という部分文字列が
  // 現れると、`/*`の位置が単一行コメント開始（`//`）位置より後ろにあるにもかかわらず、単一行
  // コメント記号との前後関係を見ない実装では誤ってブロックコメント開始と判定してしまう。
  // 誤判定された場合、対応する`*/`が同一行に無いため後続の行全体（コメント外の正当な
  // 「手順1」を含む行）が誤ってコメント扱いされ違反検出される。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-line-comment-glob-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'line-comment-glob.ts');
    fs.writeFileSync(
      tsFile,
      [
        '// 対象は src/*.ts のみ',
        "export const guide = '手順1: 対象ディレクトリを確認してください';",
      ].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 実際のブロックコメントは存在しないため、2行目の文字列リテラル中の「手順1」は
    // コメント扱いされず違反として検出されない
    // （1行目自体は単一行コメントであり見出し位置参照・宙吊りの手順番号参照パターンに
    // 一致する文字列を含まないため、1行目由来の違反も発生しない）。
    assert.deepEqual(
      violations,
      [],
      violations
        .map((v) => `${v.relPath}:${v.lineNo} を誤ってコメント扱いし違反検出している: ${JSON.stringify(v.matched)}`)
        .join('\n'),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: 同一行で開いて閉じるブロックコメントの後に続く正当なコードを誤ってコメント扱いしない（Issue #513: 同一行完結ブロックコメント後方コード誤検知の回帰防止）', () => {
  // Given: 1行内で開いて閉じるブロックコメント（`/* 手順1参照 */`）の後ろに、コメントではない
  // 正当なコード（「手順2」を含む文字列リテラル）が続く行を含む合成ファイルを用意する。
  // 是正前の実装は行全体に対する単一boolean（`lineIsBlockComment`）でブロックコメント判定を
  // 行っていたため、`*/`より後ろにある正当なコード部分（`手順2`を含む文字列リテラル）まで
  // 誤ってコメント扱いされ違反として検出されていた。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-inline-block-comment-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'inline-block-comment.ts');
    fs.writeFileSync(
      tsFile,
      ["const x = 1; /* 手順1参照 */ const y = '手順2: 通常のコードです';"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: ブロックコメント区間内（`/* 手順1参照 */`）の「手順1」は違反として検出されるが、
    // `*/`より後ろの文字列リテラル中の「手順2」はコメント外の正当なコードであり検出されない。
    assert.equal(violations.length, 1, `検出件数が想定と異なる: ${JSON.stringify(violations)}`);
    assert.equal(violations[0].matched, '手順1', 'ブロックコメント区間内の「手順1」を検出できていない');
    assert.ok(
      !violations.some((v) => v.matched === '手順2'),
      '*/より後ろの正当なコード中の「手順2」を誤ってコメント扱いし検出している',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: 同一行に2つのブロックコメントが存在する場合、両方のブロックコメント内の違反を検出する（Issue #515: 1行につき最大1区間のみだった設計を複数区間の配列へ一般化する回帰テスト）', () => {
  // Given: 同一行に2つの独立したブロックコメント（`/* 手順1参照 */`・`/* 手順2参照 */`）が
  // 存在し、間に通常のコードを挟む合成ファイルを用意する。是正前の実装は1行につき最大1つの
  // 区間（`blockCommentRange`）しか計算しないため、2つ目のブロックコメント内の「手順2」は
  // 検査対象に含まれず検知漏れになっていた。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-multi-block-comment-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'multi-block-comment.ts');
    fs.writeFileSync(
      tsFile,
      ["/* 手順1参照 */ const x = 1; /* 手順2参照 */"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 1つ目・2つ目のブロックコメントそれぞれの内側にある「手順1」「手順2」の両方が
    // 検出される。間に挟まる通常のコード（`const x = 1;`）はいずれのパターンにも一致しないため
    // 検出には影響しない。
    const dangling = violations.filter((v) => v.label === '宙吊りの手順番号参照');
    assert.equal(dangling.length, 2, `検出件数が想定と異なる: ${JSON.stringify(violations)}`);
    assert.ok(
      dangling.some((v) => v.matched === '手順1'),
      '1つ目のブロックコメント内の「手順1」を検出できていない',
    );
    assert.ok(
      dangling.some((v) => v.matched === '手順2'),
      '2つ目のブロックコメント内の「手順2」を検出できていない（Issue #515の検知漏れ）',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: .tsファイル内の単一行で完結するテンプレートリテラル中の"/* ... */"風文字列をブロックコメント開始と誤検知せず、後続の正当なコードも誤検知しない（Issue #517: バッククォートを引用符として追跡しないことに起因する誤検知の回帰テスト）', () => {
  // Given: 単一行で完結するテンプレートリテラル（`` `例: /* コメント風 */ という記法` ``）を含む行の
  // 後に、コメントではない正当なコード（「手順1」を含む文字列リテラル）が続く合成ファイルを用意する。
  // バッククォートを引用符として追跡しない実装では、テンプレートリテラル内の`/*`が引用符の外側と
  // 誤判定されうる。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-template-literal-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'template-literal.ts');
    fs.writeFileSync(
      tsFile,
      ['const s = `例: /* コメント風 */ という記法`;', "const y = '手順1: 通常のコードです';"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: テンプレートリテラル内の`/* ... */`風文字列はブロックコメント開始と誤判定されず、
    // 後続の正当なコード中の「手順1」も違反として検出されない。
    assert.equal(violations.length, 0, `誤検知が発生している: ${JSON.stringify(violations)}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: .tsファイル内の単一行で完結するテンプレートリテラルに対応する"*/"が同一行に無い場合でも、以降の行へ誤ってブロックコメント状態を持ち越さない（Issue #517: バッククォート非追跡に起因する複数行への誤伝播の回帰テスト）', () => {
  // Given: テンプレートリテラル自体は単一行で開いて閉じるが、内容に対応する`*/`を伴わない`/*`風の
  // 部分文字列（例: グロブ的表記）を含む行の後に、コメントではない正当なコード（「手順1」を含む
  // 文字列リテラル）が続く合成ファイルを用意する。バッククォートを引用符として追跡しない実装では、
  // この`/*`が引用符の外側の未終了ブロックコメント開始と誤判定され、状態が次行へ持ち越されて
  // 後続の正当な行全体が誤ってコメント扱いされる。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-template-literal-unclosed-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'template-literal-unclosed.ts');
    fs.writeFileSync(
      tsFile,
      ['const s = `例: /* という記法`;', "const y = '手順1: 通常のコードです';"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 1行目のテンプレートリテラル内の`/*`はブロックコメント開始と誤判定されず、2行目の
    // 正当なコード中の「手順1」もブロックコメント状態の誤伝播により違反として検出されない。
    assert.equal(violations.length, 0, `誤検知が発生している（複数行への誤伝播）: ${JSON.stringify(violations)}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: テンプレートリテラルの"${...}"補間式内部にある実在のブロックコメント中の見出し位置参照文字列を検出する（Issue #519: 補間式を無条件に文字列扱いすることに起因する検知漏れの回帰テスト）', () => {
  // Given: 単一行のテンプレートリテラルであり、その`${...}`補間式の内部に実在するブロック
  // コメント（`/* DESIGN.md 設計要素7 */`）を含む行を用意する。Issue #517までの是正は
  // バッククォートで囲まれた範囲全体（補間式の内部を含む）を無条件に文字列扱いしていたため、
  // このコメント内の禁止参照文字列を検査から見逃していた。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-template-interpolation-comment-'));
  try {
    const tsFile = path.join(tmpRoot, 'template-interpolation-comment.ts');
    fs.writeFileSync(
      tsFile,
      ["const s = `結果: ${/* DESIGN.md 設計要素7 */ value}`;"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 補間式内部のブロックコメント中にある見出し位置参照文字列が違反として検出される。
    assert.equal(violations.length, 1, `検出件数が想定と異なる: ${JSON.stringify(violations)}`);
    assert.equal(violations[0].label, '見出し位置参照文字列');
    assert.equal(violations[0].matched, '.md 設計要素7');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: テンプレートリテラルの"${...}"補間式外側（通常の文字列部分）にある禁止参照文字列風の内容は引き続き違反として検出しない（Issue #519回帰防止: 補間式検知の追加が既存の非検出範囲を後退させないことの確認）', () => {
  // Given: 単一行のテンプレートリテラルであり、`${...}`補間式の内部には実在するコメントが無く
  // （評価される式の値のみ）、補間式の外側（通常の文字列部分）に禁止参照文字列風の内容
  // （「手順1」）を含む行を用意する。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-template-interpolation-outside-'));
  try {
    const tsFile = path.join(tmpRoot, 'template-interpolation-outside.ts');
    fs.writeFileSync(tsFile, ['const s = `手順1: ${value} を実行する`;'].join('\n') + '\n');

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 補間式外側の通常の文字列部分にある「手順1」はコメントではないため検出されない
    // （Issue #517の是正内容を後退させない）。補間式の内部にはコメントも禁止参照文字列も
    // 存在しないため、そちらからの誤検出も発生しない。
    assert.deepEqual(
      violations,
      [],
      violations
        .map((v) => `${v.relPath}:${v.lineNo} を誤って検出している: ${JSON.stringify(v.matched)}`)
        .join('\n'),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: テンプレートリテラルの"${...}"補間式の外側と内部のコメントが同一行に混在する場合、内部のコメント中の違反のみ検出し外側の文字列部分は検出しない（Issue #519: 補間式境界判定の複合回帰テスト）', () => {
  // Given: 補間式の外側（通常の文字列部分）に禁止参照文字列風の内容（「手順2」）を含み、
  // かつ補間式の内部に実在するブロックコメント（禁止参照文字列「手順1」を含む）も含む、
  // 単一行のテンプレートリテラルを用意する。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-template-interpolation-mixed-'));
  try {
    const tsFile = path.join(tmpRoot, 'template-interpolation-mixed.ts');
    fs.writeFileSync(
      tsFile,
      ["const s = `手順2: ${/* 手順1参照 */ value} を実行する`;"].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 補間式内部のブロックコメント中の「手順1」のみ検出され、補間式外側の通常の
    // 文字列部分にある「手順2」は検出されない。
    assert.equal(violations.length, 1, `検出件数が想定と異なる: ${JSON.stringify(violations)}`);
    assert.equal(violations[0].matched, '手順1', '補間式内部のコメント中の「手順1」を検出できていない');
    assert.ok(
      !violations.some((v) => v.matched === '手順2'),
      '補間式外側の通常の文字列部分にある「手順2」を誤って検出している',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('src/配下: テンプレートリテラルの補間式内部のブロックコメントの後ろ、同一行のテンプレートリテラル外側にある実在のブロックコメントも検出する（Issue #519・手動implementation-gate strictレビュー指摘 rest-slice-backtick-misinterpretation-swallows-later-comment 是正の回帰テスト）', () => {
  // Given: レビュアが手動トレースで確認した具体的な反例。テンプレートリテラルの`${...}`補間式
  // 内部に実在するブロックコメント（`/* 手順1参照 */`）があり、そのテンプレートリテラルを
  // 閉じるバッククォートの直後、通常のコード部分にもう1つ独立したブロックコメント
  // （`/* 手順2参照 */`）が続く行を用意する。部分文字列を切り出して状態をリセットして
  // 再走査する設計（是正前）では、1つ目のブロックコメント区間確定後の`searchFrom`が
  // テンプレートリテラルを閉じるバッククォートの直前に位置し、そこから空のスタックで
  // 再走査するとその閉じバッククォートを「新しいテンプレートリテラルの開始」と誤認し、
  // 以降にある2つ目の実在のブロックコメントを検知できない（検知漏れ）退行があった。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-rest-slice-backtick-scope-'));
  try {
    const tsFile = path.join(tmpRoot, 'rest-slice-backtick.ts');
    fs.writeFileSync(
      tsFile,
      ['const x = `${/* 手順1参照 */ a}` /* 手順2参照 */;'].join('\n') + '\n',
    );

    // When: 合成ファイルを対象に検査する
    const violations = findCommentReferenceViolations(tmpRoot, [tsFile]);

    // Then: 補間式内部のブロックコメント中の「手順1」・テンプレートリテラルの外側にある
    // 実在のブロックコメント中の「手順2」の両方が検出される。
    const dangling = violations.filter((v) => v.label === '宙吊りの手順番号参照');
    assert.equal(dangling.length, 2, `検出件数が想定と異なる: ${JSON.stringify(violations)}`);
    assert.ok(
      dangling.some((v) => v.matched === '手順1'),
      '補間式内部のブロックコメント中の「手順1」を検出できていない',
    );
    assert.ok(
      dangling.some((v) => v.matched === '手順2'),
      'テンプレートリテラル外側にある実在のブロックコメント中の「手順2」を検出できていない（rest-slice-backtick-misinterpretation-swallows-later-commentの検知漏れ）',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('lint adr check: 実物 docs/adr/ は違反0で通る', async () => {
  // Given/When: このリポジトリ自身の docs/adr/（現時点では ADR-0001 のみ、supersedes: []・
  // superseded-by: null で自己完結）に対して lint adr check を実行する
  const result = runCli(['lint', 'adr', 'check'], { cwd: realRepoRoot });

  // Then: 違反なしで終了コード0
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint adr check: supersedes/superseded-byの非対称は違反として検出され、対称に直せば違反なしになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 自作の docs/adr/ に2つのADRを作る。ADR-0002 は ADR-0001 を supersedes するが、
  // ADR-0001 側の superseded-by はまだ null のまま（非対称）。
  const adrDir = path.join(repo.dir, 'docs', 'adr');
  fs.mkdirSync(adrDir, { recursive: true });
  const adr1Path = path.join(adrDir, 'ADR-0001-test.md');
  fs.writeFileSync(
    adr1Path,
    ['# ADR', '', '```yaml', 'id: ADR-0001', 'status: accepted', 'supersedes: []', 'superseded-by: null', '```', ''].join(
      '\n',
    ),
  );
  fs.writeFileSync(
    path.join(adrDir, 'ADR-0002-test.md'),
    [
      '# ADR',
      '',
      '```yaml',
      'id: ADR-0002',
      'status: accepted',
      'supersedes: [ADR-0001]',
      'superseded-by: null',
      '```',
      '',
    ].join('\n'),
  );

  // When: この非対称な状態で lint adr check を実行する
  const asymmetric = runCli(['lint', 'adr', 'check'], { cwd: repo.dir });

  // Then: 終了コード1、非対称の当事者2件（ADR-0002・ADR-0001）を含む違反理由が報告される
  assert.equal(asymmetric.status, 1);
  assert.match(asymmetric.stderr, /ADR-0002 と ADR-0001: supersedes ⇔ superseded-by が非対称です/);

  // Given: ADR-0001 側の superseded-by を ADR-0002 に直し、対称にする
  const fixedText = fs.readFileSync(adr1Path, 'utf8').replace('superseded-by: null', 'superseded-by: ADR-0002');
  fs.writeFileSync(adr1Path, fixedText);

  // When: 対称に直した後で再度 lint adr check を実行する
  const symmetric = runCli(['lint', 'adr', 'check'], { cwd: repo.dir });

  // Then: 違反なしで終了コード0
  assert.equal(symmetric.status, 0, symmetric.stderr);
});

test('lint adr check: check以外のサブコマンドはエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 'check' 以外の未知のサブコマンドを渡す
  const unknown = runCli(['lint', 'adr', 'foo'], { cwd: repo.dir });

  // Then: 終了コード1、未知のサブコマンドである旨のエラーメッセージ
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /未知のサブコマンドです/);

  // Given/When: サブコマンドを省略する
  const missing = runCli(['lint', 'adr'], { cwd: repo.dir });

  // Then: こちらも終了コード1、未知のサブコマンドエラー
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /未知のサブコマンドです/);
});
