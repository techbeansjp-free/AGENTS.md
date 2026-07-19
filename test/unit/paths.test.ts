import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageRoot, repoRoot, resolveAsset, ASSET_NAMESPACE } from '../../src/lib/paths.js';

test('packageRoot: このworktree自身のルートを返す（package.jsonが存在する）', () => {
  const root = packageRoot();
  assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
});

test('repoRoot: .git を含む祖先ディレクトリを、深い階層から呼んでも正しく返す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-root-test-'));
  const gitRoot = path.join(tmp, 'proj');
  const deep = path.join(gitRoot, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(gitRoot, '.git'), '');

  const result = repoRoot(deep);
  assert.equal(result, gitRoot);
});

test('repoRoot: 起点ディレクトリ自身が .git を持つ場合はそのまま返す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-root-test-'));
  fs.writeFileSync(path.join(tmp, '.git'), '');

  assert.equal(repoRoot(tmp), tmp);
});

test('repoRoot: .git がどこにも見つからない場合は例外を投げる', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-root-test-'));
  const orphan = path.join(tmp, 'x', 'y');
  fs.mkdirSync(orphan, { recursive: true });

  // os.tmpdir() 配下は通常 git リポジトリの外側であるため、ここから遡っても
  // .git は見つからず、必ず例外になるはず。
  assert.throws(() => repoRoot(orphan), /\.git が見つかりません/);
});

test('resolveAsset: root/.agent-skill-chain/<relativePath> が存在すればそちらを優先する', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-asset-test-'));
  const inRepoDir = path.join(tmp, ASSET_NAMESPACE, 'config');
  fs.mkdirSync(inRepoDir, { recursive: true });
  const inRepoFile = path.join(inRepoDir, 'agent-skill-chain.yaml');
  fs.writeFileSync(inRepoFile, 'dummy: true\n');

  const resolved = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), tmp);
  assert.equal(resolved, inRepoFile);
});

test('resolveAsset: rootに無ければ packageRoot() 側のアセットへフォールバックする', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-asset-test-'));
  // root には .agent-skill-chain を一切作らない。

  const resolved = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), tmp);
  const expected = path.join(packageRoot(), ASSET_NAMESPACE, 'config', 'agent-skill-chain.yaml');
  assert.equal(resolved, expected);
  assert.equal(fs.existsSync(resolved), true);
});

test('resolveAsset: rootにもpackageRootにも無ければ例外を投げる', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-asset-test-'));

  assert.throws(
    () => resolveAsset(path.join('config', 'does-not-exist-asset.yaml'), tmp),
    /アセットが見つかりません/,
  );
});
