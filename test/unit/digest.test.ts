import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { digestOf, digestOfFile, isValidDigest } from '../../src/lib/digest.js';

test('digestOf: 既知の入力（空文字列）に対して既知のSHA256ハッシュを返す', () => {
  // sha256('') は不変の既知値
  assert.equal(digestOf(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('digestOf: 文字列入力に対してsha256:プレフィックス付きのハッシュを返す', () => {
  const content = 'hello world';
  const expectedHex = crypto.createHash('sha256').update(content).digest('hex');
  assert.equal(digestOf(content), `sha256:${expectedHex}`);
});

test('digestOf: Buffer入力でも文字列入力と同じ結果になる', () => {
  const content = 'agent-skill-chain digest test';
  const fromString = digestOf(content);
  const fromBuffer = digestOf(Buffer.from(content, 'utf8'));
  assert.equal(fromString, fromBuffer);
});

test('digestOf: 決定論的である（同一入力は常に同一出力）', () => {
  const content = '同じ内容';
  assert.equal(digestOf(content), digestOf(content));
});

test('digestOf: 異なる入力は異なるハッシュになる', () => {
  assert.notEqual(digestOf('a'), digestOf('b'));
});

test('digestOfFile: 一時ファイルの内容から正しいダイジェストを計算する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
  try {
    const filePath = path.join(dir, 'sample.txt');
    const content = 'file content for digest test\n';
    fs.writeFileSync(filePath, content, 'utf8');

    const expected = digestOf(fs.readFileSync(filePath));
    assert.equal(digestOfFile(filePath), expected);
    assert.equal(digestOfFile(filePath), digestOf(content));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('digestOfFile: 存在しないファイルを指定すると例外を投げる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
  try {
    const missing = path.join(dir, 'does-not-exist.txt');
    assert.throws(() => digestOfFile(missing));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('digestOfFile: バイナリ内容でも正しく計算される', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
  try {
    const filePath = path.join(dir, 'binary.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x7f]);
    fs.writeFileSync(filePath, bytes);
    assert.equal(digestOfFile(filePath), digestOf(bytes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isValidDigest: digestOfの出力を有効と判定する', () => {
  assert.equal(isValidDigest(digestOf('any content')), true);
});

test('isValidDigest: プレフィックスが無い場合は無効', () => {
  const hex = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(isValidDigest(hex), false);
});

test('isValidDigest: 大文字16進を含む場合は無効（小文字のみ許容）', () => {
  const hex = crypto.createHash('sha256').update('x').digest('hex').toUpperCase();
  assert.equal(isValidDigest(`sha256:${hex}`), false);
});

test('isValidDigest: 長さが不足するハッシュは無効', () => {
  assert.equal(isValidDigest('sha256:abc123'), false);
});

test('isValidDigest: 長さが超過するハッシュは無効', () => {
  const hex = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(isValidDigest(`sha256:${hex}ff`), false);
});

test('isValidDigest: 完全に不正な文字列は無効', () => {
  assert.equal(isValidDigest('not-a-digest'), false);
  assert.equal(isValidDigest(''), false);
});

test('isValidDigest: 16進以外の文字を含む場合は無効', () => {
  const hex = crypto.createHash('sha256').update('x').digest('hex');
  const tampered = 'g' + hex.slice(1); // 'g' は16進として不正
  assert.equal(isValidDigest(`sha256:${tampered}`), false);
});
