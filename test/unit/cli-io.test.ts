import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printUsage, fail, ok, isHelp, guard } from '../../src/lib/cli-io.js';
import { CliError } from '../../src/lib/issue.js';

function captureStdout(t: import('node:test').TestContext): string[] {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  t.after(() => {
    process.stdout.write = original;
  });
  return chunks;
}

function captureStderr(t: import('node:test').TestContext): string[] {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  t.after(() => {
    process.stderr.write = original;
  });
  return chunks;
}

test('printUsage: 前後の空白をtrimして改行付きでstdoutへ書き出す', (t) => {
  const chunks = captureStdout(t);
  printUsage('  usage: foo <bar>  \n');
  assert.deepEqual(chunks, ['usage: foo <bar>\n']);
});

test('printUsage: 戻り値は無い（void）', (t) => {
  captureStdout(t);
  const result = printUsage('text');
  assert.equal(result, undefined);
});

test('fail: stderrへメッセージを書き出し1を返す', (t) => {
  const chunks = captureStderr(t);
  const result = fail('エラーが発生しました');
  assert.equal(result, 1);
  assert.deepEqual(chunks, ['エラーが発生しました\n']);
});

test('ok: メッセージ指定時はstdoutへ書き出し0を返す', (t) => {
  const chunks = captureStdout(t);
  const result = ok('完了しました');
  assert.equal(result, 0);
  assert.deepEqual(chunks, ['完了しました\n']);
});

test('ok: メッセージ未指定時はstdoutへ何も書き出さず0を返す', (t) => {
  const chunks = captureStdout(t);
  const result = ok();
  assert.equal(result, 0);
  assert.deepEqual(chunks, []);
});

test('isHelp: -h を先頭に含む場合はtrue', () => {
  assert.equal(isHelp(['-h']), true);
  assert.equal(isHelp(['-h', 'extra']), true);
});

test('isHelp: --help を先頭に含む場合はtrue', () => {
  assert.equal(isHelp(['--help']), true);
});

test('isHelp: 先頭以外に-h/--helpがあってもfalse', () => {
  assert.equal(isHelp(['foo', '-h']), false);
  assert.equal(isHelp(['foo', '--help']), false);
});

test('isHelp: 空配列やヘルプ以外の引数ではfalse', () => {
  assert.equal(isHelp([]), false);
  assert.equal(isHelp(['status']), false);
});

test('guard: 正常終了時はfn()の戻り値をそのまま返す（stderr出力なし）', async (t) => {
  const chunks = captureStderr(t);
  const result = await guard(() => 0);
  assert.equal(result, 0);
  assert.deepEqual(chunks, []);
});

test('guard: Promiseを返すfnも正しく解決する', async (t) => {
  captureStderr(t);
  const result = await guard(async () => 42);
  assert.equal(result, 42);
});

test('guard: CliErrorを投げた場合はfail()相当（stderr+1）で正規化する', async (t) => {
  const chunks = captureStderr(t);
  const result = await guard(() => {
    throw new CliError("slug は 'foo bar' のように空白を含んではいけません");
  });
  assert.equal(result, 1);
  assert.deepEqual(chunks, ["slug は 'foo bar' のように空白を含んではいけません\n"]);
});

test('guard: 通常のErrorを投げた場合は「予期しないエラー: 」を前置してstderr+1で返す', async (t) => {
  const chunks = captureStderr(t);
  const result = await guard(() => {
    throw new Error('boom');
  });
  assert.equal(result, 1);
  assert.deepEqual(chunks, ['予期しないエラー: boom\n']);
});

test('guard: Error以外の値（文字列）をthrowした場合もString化してstderrへ出力する', async (t) => {
  const chunks = captureStderr(t);
  const result = await guard(() => {
    // eslint的には非推奨だが、Error以外throwのケースも防御的に検証する
    throw 'plain-string-error';
  });
  assert.equal(result, 1);
  assert.deepEqual(chunks, ['予期しないエラー: plain-string-error\n']);
});

test('guard: 非同期関数内でCliErrorを投げた場合も正しく捕捉する', async (t) => {
  const chunks = captureStderr(t);
  const result = await guard(async () => {
    throw new CliError('非同期エラー');
  });
  assert.equal(result, 1);
  assert.deepEqual(chunks, ['非同期エラー\n']);
});
