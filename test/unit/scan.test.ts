import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultLiveFileRoots, defaultReferenceFileRoots, defaultVocabFileRoots, walkTextFiles } from '../../src/lib/scan.js';
// Issue #185: このテストは「このworktree自身の実在パス」を検証する意図であり、コーディネーション
// 状態の基点であるrepoRoot()（共通/メイン作業ツリー）ではなく、現在の作業ツリー自身を返す
// worktreeRoot()を使う（開発環境自体がlinked worktreeの場合、repoRoot()はメイン側を返してしまい
// このworktree自身のアセットの存在確認にならないため）。
import { worktreeRoot } from '../../src/lib/paths.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-scan-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('defaultLiveFileRoots: このworktreeの実在パスのみを返す（AGENTS.md, docs/GLOSSARY.md, .agent-skill-chain/{standards,templates,config,schemas,scripts,ci}, src/）。lint referencesの見出し解決に必要な完全な一覧（Issue #187: src/ を対象へ追加。bin/ はビルド生成物のため対象外＝ADR-2）', () => {
  const root = worktreeRoot();
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
    path.join(root, 'src'),
  ];
  // このworktreeには全パスが実在するはず（存在しなければテストで検出する）。
  for (const p of expected) {
    assert.equal(fs.existsSync(p), true, `${p} が存在しない前提が崩れている`);
  }
  assert.deepEqual(result, expected);
  assert.ok(!result.includes(path.join(root, 'bin')), 'bin/ はビルド生成物のため対象へ含まれないこと（ADR-2）');
});

test('defaultVocabFileRoots: lint vocabのデフォルト対象。docs/GLOSSARY.mdは自己言及のため恒久除外し、AGENTS.md・.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}・src/（defaultLiveFileRootsと同一集合）を返す（識別子文脈スキャナ実装によりtemplates/config/schemas/scriptsの一時除外を撤廃済み。Issue #187: src/ を追加）', () => {
  const root = worktreeRoot();
  const result = defaultVocabFileRoots(root);
  const expected = [
    path.join(root, 'AGENTS.md'),
    path.join(root, '.agent-skill-chain', 'standards'),
    path.join(root, '.agent-skill-chain', 'templates'),
    path.join(root, '.agent-skill-chain', 'config'),
    path.join(root, '.agent-skill-chain', 'schemas'),
    path.join(root, '.agent-skill-chain', 'scripts'),
    path.join(root, '.agent-skill-chain', 'ci'),
    path.join(root, 'src'),
  ];
  for (const p of expected) {
    assert.equal(fs.existsSync(p), true, `${p} が存在しない前提が崩れている`);
  }
  assert.equal(fs.existsSync(path.join(root, 'docs', 'GLOSSARY.md')), true, 'docs/GLOSSARY.md が存在しない前提が崩れている');
  assert.deepEqual(result, expected);
});

test('defaultVocabFileRoots: 存在しないパスは除外される', () => {
  withTmpDir((dir) => {
    const result = defaultVocabFileRoots(dir);
    assert.deepEqual(result, []);
  });
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

test('defaultReferenceFileRoots: このworktreeの実在パス（defaultLiveFileRootsの全パス + .github/workflows）を返す（Issue #221: 実デプロイ済みワークフローYAMLを走査対象へ含める）', () => {
  const root = worktreeRoot();
  const result = defaultReferenceFileRoots(root);
  const workflowsPath = path.join(root, '.github', 'workflows');
  assert.equal(fs.existsSync(workflowsPath), true, `${workflowsPath} が存在しない前提が崩れている`);
  assert.deepEqual(result, [...defaultLiveFileRoots(root), workflowsPath]);
});

test('defaultReferenceFileRoots: .github/workflows が存在しない環境では除外され、defaultLiveFileRootsと同一集合に縮退する', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# agents\n');
    const result = defaultReferenceFileRoots(dir);
    assert.deepEqual(result, defaultLiveFileRoots(dir));
    assert.ok(!result.includes(path.join(dir, '.github', 'workflows')));
  });
});

test('defaultReferenceFileRoots: .github/workflows が存在する環境では末尾に追加される', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# agents\n');
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    const result = defaultReferenceFileRoots(dir);
    assert.deepEqual(result, [...defaultLiveFileRoots(dir), path.join(dir, '.github', 'workflows')]);
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
