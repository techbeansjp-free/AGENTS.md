import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// Issue #169 T8: doctor拡張（init導入済み・enforce配線状態の情報表示）の結合テスト。
// いずれも情報表示のみであり、未導入・非配線であってもdoctor自体の成否判定には影響しない。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('doctor: initを実行していないtarget_dirでも、他の必須チェックがOKなら終了コードは0のままで、init未導入が情報表示される', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /情報 {2}init 導入済み: NG（未導入）/);
  assert.match(result.stdout, /情報 {2}enforce の配線状態: OFF/);
});

test('doctor: init実行後は導入済みバージョンが情報表示される', (t) => {
  const targetDir = mkScratch('doctor-init-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  // git repository化しないと repoRoot() が親の実リポジトリを拾ってしまうため、
  // 最小限のgit repoにする（.git の存在だけで doctor の git repository チェックは通る）。
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true });

  const result = runCli(['doctor'], { cwd: targetDir });

  assert.match(result.stdout, /情報 {2}init 導入済み: OK \(\d+\.\d+\.\d+\)/);
});

test('doctor: enforce on実行後はenforceの配線状態がONと表示される', (t) => {
  const targetDir = mkScratch('doctor-enforce-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true });

  const enforceOn = runCli(['enforce', 'on', targetDir]);
  assert.equal(enforceOn.status, 0, enforceOn.stderr);

  const result = runCli(['doctor'], { cwd: targetDir });

  assert.match(result.stdout, /情報 {2}enforce の配線状態: ON/);
});
