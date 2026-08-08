import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

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
      // 散文誤用として引き続き検出対象に残る（DESIGN.md「A-1」の明示的な非除外例）。
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

test('src/commands/upgrade.ts: 禁止された見出し位置参照文字列（DESIGN.md 設計要素<N>・宙吊りの手順<N>番号参照）を含まない（Issue #507: ソースコードコメントへの見出し位置参照混入の回帰防止）', () => {
  // Given/When: このリポジトリ自身の src/commands/upgrade.ts の内容を直接読み取る。
  //
  // 注記: `lint references` の禁止参照検出パターン（§見出し形式・file.ext:行番号形式の2種のみ）は
  // 「DESIGN.md 設計要素7」のような「文書名＋見出し名（節記号・行番号なし）」形式や、対応する
  // 番号付きリストの定義を伴わずに残存する「手順1」「手順2」のような番号のみの宙吊り参照を
  // 検出できない（検出パターン自体の拡張は本テストのスコープ外）。そのため `lint references` の
  // 終了コードに依存せず、かつて混入していた具体的な違反パターン文字列がファイル内容に
  // 存在しないことを直接assertする。
  const upgradeTsPath = path.join(realRepoRoot, 'src', 'commands', 'upgrade.ts');
  const content = fs.readFileSync(upgradeTsPath, 'utf8');

  // Then: 「DESIGN.md 設計要素」という見出し位置参照文字列を含まない
  // （Issue #507で `DESIGN.md 設計要素7` → `Issue #503` 等へ是正済み）。
  assert.doesNotMatch(content, /DESIGN\.md\s*設計要素/);

  // Then: 「手順」＋数字（半角・全角）という番号付き手順への宙吊り参照も含まない
  // （直後に数字が続く「手順N」形式に限定し、本ファイル中の正当な「手順」という単語の
  // 他の使用法を誤検知しないようにする。Issue #507是正ラウンド2で
  // 「手順1」「手順2」→処理内容を直接説明する自己完結した文言へ是正済み）。
  assert.doesNotMatch(content, /手順[0-9０-９]/);
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
