import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../helpers/cli.js';

// `test run`（src/commands/testing.ts）を検証する。cwd（対象worktree）の package.json に
// scripts.test が定義されていれば npm test を実行するコマンド。agent-skill-chain自身の
// worktreeではなく対象プロジェクト側で実行される想定のため、専用の最小fixtureディレクトリで検証する。

function makeFixtureDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-test-run-'));
  // repoRoot() は cwd から上へ .git を探すため、fixture自身も独立したgitリポジトリにする。
  fs.mkdirSync(path.join(dir, '.git'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('test run: package.jsonが無ければ明確な理由で失敗する', async (t) => {
  const { dir, cleanup } = makeFixtureDir();
  t.after(cleanup);

  const result = runCli(['test', 'run'], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package\.json が見つかりません/);
});

test('test run: package.jsonにscripts.testが無ければ明確な理由で失敗する', async (t) => {
  const { dir, cleanup } = makeFixtureDir();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }));

  const result = runCli(['test', 'run'], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\.test が定義されていません/);
});

test('test run: scripts.testが成功すれば終了コード0', async (t) => {
  const { dir, cleanup } = makeFixtureDir();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "process.exit(0)"' } }),
  );

  const result = runCli(['test', 'run'], { cwd: dir });
  assert.equal(result.status, 0, result.stderr);
});

test('test run: scripts.testが失敗すればnpm testの終了コードを反映して失敗する', async (t) => {
  const { dir, cleanup } = makeFixtureDir();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "process.exit(1)"' } }),
  );

  const result = runCli(['test', 'run'], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm test が失敗しました/);
});
