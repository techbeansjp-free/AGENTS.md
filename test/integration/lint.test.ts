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

test('lint vocab: path引数省略時のデフォルト対象（AGENTS.md・.agent-skill-chain資産）は違反なしで終了コード0になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: path引数を省略し、defaultVocabFileRoots（AGENTS.md・.agent-skill-chain/{standards,ci}。
  // docs/GLOSSARY.mdは自己言及のため恒久除外、templates/config/schemas/scriptsはissue識別子誤検出のため
  // 一時除外中）を対象に実行する
  const result = runCli(['lint', 'vocab'], { cwd: repo.dir });

  // Then: 複製元である実物のAGENTS.md・.agent-skill-chain/{standards,ci}は禁止語混入が無い状態を
  // 維持している前提のため、終了コード0・標準エラー出力は空になることを期待する。
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
