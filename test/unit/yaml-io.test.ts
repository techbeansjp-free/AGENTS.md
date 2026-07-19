import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readYamlFile, tryReadYamlFile, writeYamlFileAtomic, toYamlString } from '../../src/lib/yaml-io.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-yaml-io-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('writeYamlFileAtomic → readYamlFile: ラウンドトリップで元データを復元する', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'data.yaml');
    const data = { schema_version: 'v1', name: 'foo', count: 3, items: ['a', 'b'], nested: { flag: true } };
    writeYamlFileAtomic(filePath, data);
    const result = readYamlFile<typeof data>(filePath);
    assert.deepEqual(result, data);
  });
});

test('writeYamlFileAtomic: 存在しない親ディレクトリ（ネスト）を自動作成する', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'a', 'b', 'c', 'data.yaml');
    assert.equal(fs.existsSync(path.join(dir, 'a')), false);
    writeYamlFileAtomic(filePath, { ok: true });
    assert.equal(fs.existsSync(filePath), true);
    const result = readYamlFile<{ ok: boolean }>(filePath);
    assert.deepEqual(result, { ok: true });
  });
});

test('writeYamlFileAtomic: tmpファイルを残さず最終ファイルのみが残る', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'data.yaml');
    writeYamlFileAtomic(filePath, { ok: true });
    const entries = fs.readdirSync(dir);
    assert.deepEqual(entries, ['data.yaml']);
  });
});

test('tryReadYamlFile: 存在しないファイルは undefined を返す', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'missing.yaml');
    assert.equal(tryReadYamlFile(filePath), undefined);
  });
});

test('tryReadYamlFile: 存在するファイルは readYamlFile と同じ結果を返す', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'data.yaml');
    writeYamlFileAtomic(filePath, { key: 'value' });
    assert.deepEqual(tryReadYamlFile(filePath), { key: 'value' });
  });
});

test('readYamlFile: 存在しないファイルは例外を投げる', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'missing.yaml');
    assert.throws(() => readYamlFile(filePath), /ENOENT/);
  });
});

test('toYamlString: オブジェクトをYAML文字列へ変換し、readYamlFileで復元できる', () => {
  const data = { a: 1, b: ['x', 'y'], c: { d: false } };
  const yamlText = toYamlString(data);
  assert.equal(typeof yamlText, 'string');
  assert.match(yamlText, /a: 1/);
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'data.yaml');
    fs.writeFileSync(filePath, yamlText, 'utf8');
    assert.deepEqual(readYamlFile(filePath), data);
  });
});
