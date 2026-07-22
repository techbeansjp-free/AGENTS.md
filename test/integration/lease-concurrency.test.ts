import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { binPath } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// ISSUE-176 AC-1/AC-2: 「並行acquireで二重取得が発生しない」ことを、モックではなく実際に複数の
// 子プロセスを同時起動して競わせることで実測する。DESIGN.md §障害・ロールバック考慮が要求する
// 検証方法（`automated`、実プロセス競合）に対応する。

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `runCli`（spawnSync、ブロッキング）とは異なり、複数プロセスを同時に起動して真に競わせるため
 * 非同期の`spawn`を用いる。呼び出し側でPromiseの生成自体をループで先に済ませてからawaitすることで、
 * 各子プロセスの起動タイミングを可能な限り近づける。 */
function spawnCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [binPath, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const CONCURRENCY = 8;

test('lease acquire 並行実行 (AC-2, ローカルバックエンド): N並行acquireのうち成功は常に1件のみ', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 同一Issue・同一segmentに対し、8プロセスをほぼ同時に起動してacquireを競わせる。
  const promises = Array.from({ length: CONCURRENCY }, () =>
    spawnCli(['lease', 'acquire', 'ISSUE-1', 'spec'], repo.dir, process.env),
  );
  const results = await Promise.all(promises);

  // Then: OSのO_EXCLが排他性を担保するため、成功は常にちょうど1件のみであること
  // （read-check-then-writeのTOCTOUウィンドウが排除されていることの実測確認）。
  const successes = results.filter((r) => r.status === 0);
  const failures = results.filter((r) => r.status !== 0);
  assert.equal(
    successes.length,
    1,
    `成功は常に1件のみであること（二重取得が発生しないこと）。実測: successes=${successes.length}, failures=${failures.length}\n` +
      results.map((r, i) => `#${i}: status=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`).join('\n'),
  );
  assert.equal(failures.length, CONCURRENCY - 1);
  for (const f of failures) {
    assert.match(f.stderr, /競合|回収中に別プロセスが再取得/, `失敗は既存leaseとの競合を理由とすること: ${f.stderr}`);
  }
});

test('lease acquire 並行実行 (AC-1, GitHubバックエンド): N並行acquireのうち成功は常に1件のみ', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-lease-concurrency-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  // Given/When: 同一Issue・同一segmentに対し、8プロセスをほぼ同時に起動してacquireを競わせる。
  // gh-stubはcountActiveWriterLeaseIssues（WIP上限事前チェック）・postLeaseComment・
  // markActiveWriterLeaseLabel（いずれもbest-effort、失敗しても取得成否に影響しない）用に
  // 用意するのみで、排他性そのものはgit refへの実push（gh-stub非経由、実bare remoteへの
  // 実git push）が担う。
  const promises = Array.from({ length: CONCURRENCY }, () =>
    spawnCli(['lease', 'acquire', 'ISSUE-9', 'spec'], repo.dir, env),
  );
  const results = await Promise.all(promises);

  // Then: git refへのforce無しpushはサーバ側（receive-pack）が現在値を再検証する真のCASであるため、
  // 成功は常にちょうど1件のみであること（旧・楽観的排他制御が持っていたTOCTOUウィンドウが
  // 排除されていることの実測確認）。
  const successes = results.filter((r) => r.status === 0);
  const failures = results.filter((r) => r.status !== 0);
  assert.equal(
    successes.length,
    1,
    `成功は常に1件のみであること（二重取得が発生しないこと）。実測: successes=${successes.length}, failures=${failures.length}\n` +
      results.map((r, i) => `#${i}: status=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`).join('\n'),
  );
  assert.equal(failures.length, CONCURRENCY - 1);
  for (const f of failures) {
    assert.match(f.stderr, /競合/, `失敗は既存leaseとの競合を理由とすること: ${f.stderr}`);
  }
});
