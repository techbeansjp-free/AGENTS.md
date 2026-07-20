import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// lint secrets（ISSUE-178 DESIGN.md「D. secret scan CI」）の結合テスト。
//
// テストで使うダミーsecret値は実在の認証情報ではなく、テスト専用であることが明確な、広く知られた
// フィクスチャ形式のみを使う: AWS公式ドキュメントが例示として公開しているサンプルアクセスキー
// `AKIAIOSFODNN7EXAMPLE`（gitleaks等の多くのOSSプロジェクトでも標準的なテストフィクスチャとして
// 使われている値）。GitHub PAT・Slack token・Stripe key等の「正規表現にマッチする40文字前後の
// トークン全体」を模したダミー値はテストコードに書かない（実在キーと同一の接頭辞＋妥当な形式の
// 文字列を作ってしまうと GitHub Push Protection 等に誤検知される可能性があるため）。

test('lint secrets <path>: ダミーAWSアクセスキー形式の文字列を含むファイルを検知し、終了コード1・該当行を報告する（ISSUE-178 AC-8）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const file = path.join(repo.dir, 'secret-fixture.txt');
  fs.writeFileSync(
    file,
    [
      '前後に違反を含まない行。',
      // AKIAIOSFODNN7EXAMPLE は AWS公式ドキュメントのサンプルアクセスキー（テスト専用の既知の
      // ダミー値であり、実在の認証情報ではない）。
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      '末尾の違反を含まない行。',
    ].join('\n') + '\n',
  );

  const result = runCli(['lint', 'secrets', 'secret-fixture.txt'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /secret-fixture\.txt:2: secretパターン 'AWS Access Key ID' の疑いがある文字列が見つかりました/,
  );
  assert.doesNotMatch(result.stderr, /secret-fixture\.txt:1:/);
  assert.doesNotMatch(result.stderr, /secret-fixture\.txt:3:/);
});

test('lint secrets <path>: PEM秘密鍵ヘッダ（ヘッダ行のみ、鍵本体は含まない）も検知する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const file = path.join(repo.dir, 'pem-fixture.txt');
  fs.writeFileSync(file, ['-----BEGIN RSA PRIVATE KEY-----', '（本文は含まないテスト用のヘッダ行のみ）'].join('\n') + '\n');

  const result = runCli(['lint', 'secrets', 'pem-fixture.txt'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /pem-fixture\.txt:1: secretパターン 'PEM秘密鍵ヘッダ' の疑いがある文字列が見つかりました/);
});

test('lint secrets <path>: secretパターンを含まない通常のファイルは終了コード0になる（ISSUE-178 AC-9）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const file = path.join(repo.dir, 'clean.txt');
  fs.writeFileSync(file, ['これはsecretを含まない通常のテキストファイルである。', 'AWS_REGION=ap-northeast-1'].join('\n') + '\n');

  const result = runCli(['lint', 'secrets', 'clean.txt'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint secrets: 検査対象パスが1つも指定されていない場合はエラーになる（--diffでもない場合）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['lint', 'secrets'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /検査対象パスを1つ以上指定してください/);
});

test('lint secrets --diff: base-refの指定が無い場合はエラーになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['lint', 'secrets', '--diff'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /'--diff' には base-ref の指定が必要です/);
});

test('lint secrets --diff: PRで追加されたダミーAWSアクセスキー形式の行を検知し、終了コード1で失敗する（ISSUE-178 AC-8）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // createTmpRepo の初期commit（README.mdのみ）が origin/main として既にpush済み。
  // ここへ新規ファイルを追加するcommitを積むことで、「PRで追加された行」を再現する。
  const file = path.join(repo.dir, 'config.env');
  fs.writeFileSync(file, ['FOO=bar', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'].join('\n') + '\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync(
    'git',
    ['commit', '-m', 'test: add dummy secret fixture (AWS docs example key, not a real credential)'],
    { cwd: repo.dir, stdio: 'pipe' },
  );

  const result = runCli(['lint', 'secrets', '--diff', 'origin/main'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.env:2: secretパターン 'AWS Access Key ID' の疑いがある文字列が見つかりました/);
  assert.doesNotMatch(result.stderr, /config\.env:1:/);
});

test('lint secrets --diff: secretパターンを含まない通常の差分では誤検知せず終了コード0になる（ISSUE-178 AC-9）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const file = path.join(repo.dir, 'notes.md');
  fs.writeFileSync(file, ['# 通常の変更', '', 'これはsecretを含まない通常の差分である。'].join('\n') + '\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'docs: add notes'], { cwd: repo.dir, stdio: 'pipe' });

  const result = runCli(['lint', 'secrets', '--diff', 'origin/main'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('lint secrets -h: 使い方を表示し終了コード0になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['lint', 'secrets', '-h'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent-skill-chain lint secrets/);
  assert.match(result.stdout, /--diff/);
});
