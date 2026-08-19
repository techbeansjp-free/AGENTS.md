import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, runBytes, runOrThrow, git, gitBytes, gh, commandExists } from '../../src/lib/exec.js';
import { createGhStub } from '../helpers/gh-stub.js';

const NOT_A_REAL_BINARY = 'surely-not-a-real-binary-xyz';

test('run: 実在するコマンドは status:0 で標準出力を返す', () => {
  const result = run('git', ['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^git version/);
});

test('run: 存在しないコマンドは status:127 で stderr にエラー理由を含む', () => {
  const result = run(NOT_A_REAL_BINARY, []);
  assert.equal(result.status, 127);
  assert.ok(result.stderr.length > 0, 'stderr にエラー理由が含まれること');
});

test('runBytes: NULを含む標準出力をBufferのまま返す', () => {
  const result = runBytes(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0x61, 0x00, 0xff]))']);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from([0x61, 0x00, 0xff]));
});

test('runOrThrow: 成功時は trim された stdout を返す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-repo-'));
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: tmp, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'exec test'], { cwd: tmp, stdio: 'pipe' });

  const toplevel = runOrThrow('git', ['rev-parse', '--show-toplevel'], tmp);
  assert.equal(toplevel, fs.realpathSync(tmp), '末尾改行が trim されていること');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('runOrThrow: 失敗時は理由を含む例外を投げる', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-notrepo-'));

  assert.throws(() => runOrThrow('git', ['status'], tmp), /git status .*が失敗しました（終了コード/);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('git: gitラッパーは git 実体へ委譲する', () => {
  const result = git(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^git version/);
});

test('gitBytes: blobを文字列変換せず読み出す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-bytes-test-repo-'));
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: tmp, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'exec test'], { cwd: tmp });
  const bytes = Buffer.from([0x61, 0x00, 0xff]);
  fs.writeFileSync(path.join(tmp, 'blob.bin'), bytes);
  execFileSync('git', ['add', 'blob.bin'], { cwd: tmp });
  execFileSync('git', ['commit', '-m', 'test: add binary blob'], { cwd: tmp, stdio: 'pipe' });

  const result = gitBytes(['show', 'HEAD:blob.bin'], tmp);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, bytes);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('commandExists: 実在するコマンドは true、存在しないコマンドは false', () => {
  assert.equal(commandExists('git'), true);
  assert.equal(commandExists(NOT_A_REAL_BINARY), false);
});

test('gh: PATH注入したスタブ gh に対して auth status が status:0 になる', (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-gh-stub-'));
  const stub = createGhStub(scratchDir);
  const originalPath = process.env.PATH;
  const originalState = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  process.env.PATH = `${stub.binDir}${path.delimiter}${originalPath}`;
  process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = stub.statePath;

  t.after(() => {
    process.env.PATH = originalPath;
    if (originalState === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = originalState;
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  const result = gh(['auth', 'status']);
  assert.equal(result.status, 0);
});
