// Issue #759 PLAN #1 / DESIGN E5: 正準ツリー digest の 2 実装（CLI の TypeScript 実装と、
// 準備段が Node.js の 1 回起動で実行する cli-resolve.sh 内の実装）が同一ツリーに対して
// 同値を返すことを固定し、片方だけの変更で乖離しない状態を保つ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalTreeDigest, CanonicalTreeDigestError } from '../../src/lib/tree-digest.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const resolverPath = path.join(packageRoot, '.agent-skill-chain', 'scripts', 'cli-resolve.sh');

/** 準備段側の実装（cli-resolve.sh の asc_canonical_tree_digest）を実際の bash で駆動する。 */
function shellDigest(root: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'bash',
    ['-c', `source ${JSON.stringify(resolverPath)}; asc_canonical_tree_digest ${JSON.stringify(root)}`],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function createTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-tree-digest-'));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"agent-skill-chain"}\n');
  fs.writeFileSync(path.join(dir, 'bin', 'entry.js'), 'console.log(1);\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'lib', 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'lib', 'nested', 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(dir, 'マルチバイト.md'), '日本語\n');
  return dir;
}

test('正準ツリーdigest: CLI実装と準備段実装が同一ツリーに対し同値を返す', (t) => {
  const dir = createTree();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fromCli = canonicalTreeDigest(dir);
  const fromShell = shellDigest(dir);

  assert.equal(fromShell.status, 0, fromShell.stderr);
  assert.match(fromCli, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fromShell.stdout, fromCli);
});

test('正準ツリーdigest: 実行ビット・内容・相対パスのいずれの変化でも値が変わる', (t) => {
  const dir = createTree();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const baseline = canonicalTreeDigest(dir);

  fs.chmodSync(path.join(dir, 'bin', 'entry.js'), 0o644);
  const withoutExecutable = canonicalTreeDigest(dir);
  assert.notEqual(withoutExecutable, baseline);
  assert.equal(shellDigest(dir).stdout, withoutExecutable);

  fs.chmodSync(path.join(dir, 'bin', 'entry.js'), 0o755);
  assert.equal(canonicalTreeDigest(dir), baseline);

  fs.writeFileSync(path.join(dir, 'lib', 'a.txt'), 'a2\n');
  const withChangedContent = canonicalTreeDigest(dir);
  assert.notEqual(withChangedContent, baseline);
  assert.equal(shellDigest(dir).stdout, withChangedContent);

  fs.writeFileSync(path.join(dir, 'lib', 'a.txt'), 'a\n');
  fs.renameSync(path.join(dir, 'lib', 'a.txt'), path.join(dir, 'lib', 'renamed.txt'));
  const withRenamedPath = canonicalTreeDigest(dir);
  assert.notEqual(withRenamedPath, baseline);
  assert.equal(shellDigest(dir).stdout, withRenamedPath);
});

test('正準ツリーdigest: 配置場所と時刻に依存しない', (t) => {
  const dir = createTree();
  const otherParent = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-tree-digest-moved-'));
  const moved = path.join(otherParent, 'agent-skill-chain');
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(otherParent, { recursive: true, force: true });
  });
  fs.cpSync(dir, moved, { recursive: true, preserveTimestamps: false });
  const past = new Date(0);
  fs.utimesSync(path.join(moved, 'package.json'), past, past);

  assert.equal(canonicalTreeDigest(moved), canonicalTreeDigest(dir));
  assert.equal(shellDigest(moved).stdout, canonicalTreeDigest(dir));
});

test('正準ツリーdigest: 走査根直下の node_modules と .git はエントリ自体を含めて除外する', (t) => {
  const dir = createTree();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const baseline = canonicalTreeDigest(dir);

  // Issue #759: 調達段は複製先パッケージ root 直下へ依存ディレクトリを指す symbolic link を置く。
  // エントリ自体が除外されない実装では、この link が「対象範囲内の symbolic link」として
  // 算出を常に中止させ、調達が成立しない。
  fs.mkdirSync(path.join(dir, 'deps'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'deps'), path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  assert.equal(canonicalTreeDigest(dir), baseline);
  const fromShell = shellDigest(dir);
  assert.equal(fromShell.status, 0, fromShell.stderr);
  assert.equal(fromShell.stdout, baseline);
});

test('正準ツリーdigest: 対象範囲内のsymbolic linkでは算出せず両実装とも失敗する', (t) => {
  const dir = createTree();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.symlinkSync(path.join(dir, 'lib', 'a.txt'), path.join(dir, 'lib', 'linked.txt'));

  assert.throws(() => canonicalTreeDigest(dir), CanonicalTreeDigestError);
  const fromShell = shellDigest(dir);
  assert.notEqual(fromShell.status, 0);
  assert.match(fromShell.stderr, /symbolic link/);
});

test('正準ツリーdigest: 実配布物（.agent-skill-chain/schemas）でも両実装が一致する', () => {
  const target = path.join(packageRoot, '.agent-skill-chain', 'schemas');
  assert.equal(fs.existsSync(target), true);
  const fromShell = shellDigest(target);
  assert.equal(fromShell.status, 0, fromShell.stderr);
  assert.equal(fromShell.stdout, canonicalTreeDigest(target));
  // git blob と混同しない値であること（ドメイン分離の確認）。
  assert.notEqual(
    canonicalTreeDigest(target),
    `sha256:${execFileSync('bash', ['-c', 'printf "" | sha256sum | cut -d" " -f1'], { encoding: 'utf8' }).trim()}`,
  );
});
