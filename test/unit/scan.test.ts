import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultLiveFileRoots, walkTextFiles } from '../../src/lib/scan.js';
import { repoRoot } from '../../src/lib/paths.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-scan-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('defaultLiveFileRoots: このworktreeの実在パスのみを返す（AGENTS.md, docs/GLOSSARY.md, .agent-skill-chain/{standards,templates,config,schemas,scripts,ci}）', () => {
  const root = repoRoot();
  const result = defaultLiveFileRoots(root);
  const expected = [
    path.join(root, 'AGENTS.md'),
    path.join(root, 'docs', 'GLOSSARY.md'),
    path.join(root, '.agent-skill-chain', 'standards'),
    path.join(root, '.agent-skill-chain', 'templates'),
    path.join(root, '.agent-skill-chain', 'config'),
    path.join(root, '.agent-skill-chain', 'schemas'),
    path.join(root, '.agent-skill-chain', 'scripts'),
    path.join(root, '.agent-skill-chain', 'ci'),
  ];
  // このworktreeには全パスが実在するはず（存在しなければテストで検出する）。
  for (const p of expected) {
    assert.equal(fs.existsSync(p), true, `${p} が存在しない前提が崩れている`);
  }
  assert.deepEqual(result, expected);
});

test('defaultLiveFileRoots: 存在しないパスは除外される', () => {
  withTmpDir((dir) => {
    // 空のディレクトリ: AGENTS.md も docs/GLOSSARY.md も .agent-skill-chain/* も存在しない。
    const result = defaultLiveFileRoots(dir);
    assert.deepEqual(result, []);
  });
});

test('defaultLiveFileRoots: 一部のみ存在する場合は存在するものだけ返す', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# agents\n');
    fs.mkdirSync(path.join(dir, '.agent-skill-chain', 'schemas'), { recursive: true });
    const result = defaultLiveFileRoots(dir);
    assert.deepEqual(result, [path.join(dir, 'AGENTS.md'), path.join(dir, '.agent-skill-chain', 'schemas')]);
  });
});

test('walkTextFiles: 対象拡張子（.md/.yaml/.yml/.sh/.json/.ts）のファイルのみを再帰的に収集する', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'a.md'), '# a');
    fs.writeFileSync(path.join(dir, 'b.png'), 'binary');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'c.yaml'), 'c: 1');
    fs.writeFileSync(path.join(dir, 'sub', 'd.txt'), 'plain');
    fs.mkdirSync(path.join(dir, 'sub', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'nested', 'e.ts'), 'export {};');
    fs.writeFileSync(path.join(dir, 'sub', 'nested', 'f.sh'), '#!/bin/sh');
    fs.writeFileSync(path.join(dir, 'sub', 'nested', 'g.json'), '{}');
    fs.writeFileSync(path.join(dir, 'sub', 'nested', 'h.yml'), 'h: 1');

    const result = walkTextFiles([dir]).sort();
    const expected = [
      path.join(dir, 'a.md'),
      path.join(dir, 'sub', 'c.yaml'),
      path.join(dir, 'sub', 'nested', 'e.ts'),
      path.join(dir, 'sub', 'nested', 'f.sh'),
      path.join(dir, 'sub', 'nested', 'g.json'),
      path.join(dir, 'sub', 'nested', 'h.yml'),
    ].sort();
    assert.deepEqual(result, expected);
  });
});

test('walkTextFiles: 存在しないエントリパスは無視され例外を投げない', () => {
  withTmpDir((dir) => {
    const missing = path.join(dir, 'does-not-exist');
    fs.writeFileSync(path.join(dir, 'a.md'), '# a');
    const result = walkTextFiles([missing, path.join(dir, 'a.md')]);
    assert.deepEqual(result, [path.join(dir, 'a.md')]);
  });
});

test('walkTextFiles: 単一ファイルをエントリに渡した場合、対象拡張子ならそのまま返す', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'single.md');
    fs.writeFileSync(filePath, '# single');
    assert.deepEqual(walkTextFiles([filePath]), [filePath]);
  });
});

test('walkTextFiles: 単一ファイルが対象外拡張子なら空配列を返す', () => {
  withTmpDir((dir) => {
    const filePath = path.join(dir, 'single.png');
    fs.writeFileSync(filePath, 'binary');
    assert.deepEqual(walkTextFiles([filePath]), []);
  });
});

test('walkTextFiles: 空配列を渡すと空配列を返す', () => {
  assert.deepEqual(walkTextFiles([]), []);
});
