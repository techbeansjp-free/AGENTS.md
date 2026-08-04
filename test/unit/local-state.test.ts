import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  issueDir,
  stateFilePath,
  leaseFilePath,
  integrationFilePath,
  reviewFilePath,
  reportFilePath,
} from '../../src/lib/local-state.js';

const ROOT = '/tmp/example-root';
const ISSUE_NUMBER = '123';

test('issueDir: root/issues/<番号> を返す', () => {
  assert.equal(issueDir(ROOT, ISSUE_NUMBER), path.join(ROOT, 'issues', ISSUE_NUMBER));
});

test('stateFilePath: issueDir配下の .agent-skill-chain/state.yaml を返す', () => {
  assert.equal(
    stateFilePath(ROOT, ISSUE_NUMBER),
    path.join(ROOT, 'issues', ISSUE_NUMBER, '.agent-skill-chain', 'state.yaml'),
  );
});

test('leaseFilePath: issueDir配下の .agent-skill-chain/lease.yaml を返す', () => {
  assert.equal(
    leaseFilePath(ROOT, ISSUE_NUMBER),
    path.join(ROOT, 'issues', ISSUE_NUMBER, '.agent-skill-chain', 'lease.yaml'),
  );
});

test('integrationFilePath: issueDir配下の .agent-skill-chain/integration.yaml を返す', () => {
  assert.equal(
    integrationFilePath(ROOT, ISSUE_NUMBER),
    path.join(ROOT, 'issues', ISSUE_NUMBER, '.agent-skill-chain', 'integration.yaml'),
  );
});

test('reviewFilePath: issueDir配下の .agent-skill-chain/reviews/<gateId>.yaml を返す', () => {
  assert.equal(
    reviewFilePath(ROOT, ISSUE_NUMBER, 'design'),
    path.join(ROOT, 'issues', ISSUE_NUMBER, '.agent-skill-chain', 'reviews', 'design.yaml'),
  );
});

test('reviewFilePath: gateIdが異なれば異なるファイル名になる', () => {
  const spec = reviewFilePath(ROOT, ISSUE_NUMBER, 'spec');
  const validation = reviewFilePath(ROOT, ISSUE_NUMBER, 'validation');
  assert.notEqual(spec, validation);
  assert.equal(path.basename(spec), 'spec.yaml');
  assert.equal(path.basename(validation), 'validation.yaml');
});

test('issueNumberが異なれば全パスが異なるディレクトリに解決される', () => {
  assert.notEqual(stateFilePath(ROOT, '1'), stateFilePath(ROOT, '2'));
  assert.notEqual(issueDir(ROOT, '1'), issueDir(ROOT, '2'));
});

test('全パス関数の出力は issueDir 配下（プレフィックス一致）である', () => {
  const dir = issueDir(ROOT, ISSUE_NUMBER);
  for (const p of [
    stateFilePath(ROOT, ISSUE_NUMBER),
    leaseFilePath(ROOT, ISSUE_NUMBER),
    integrationFilePath(ROOT, ISSUE_NUMBER),
    reviewFilePath(ROOT, ISSUE_NUMBER, 'design'),
  ]) {
    assert.equal(p.startsWith(dir + path.sep), true, `${p} は ${dir} 配下ではない`);
  }
});

// Issue #399: coordination.backend: github ではroot直下 `issues/` を一切使わない（root直下汚染の
// 再発防止）。os.tmpdir() 配下の完全非追跡な場所へ書く。
test('issueDir: backend未指定（既定）はlocalと同じ挙動（root/issues/<番号>）', () => {
  assert.equal(issueDir(ROOT, ISSUE_NUMBER), issueDir(ROOT, ISSUE_NUMBER, 'local'));
});

test('issueDir: backend=github はrepoRoot配下を一切返さない', () => {
  const dir = issueDir(ROOT, ISSUE_NUMBER, 'github');
  assert.equal(dir.startsWith(ROOT + path.sep), false, `${dir} が ${ROOT} 配下を指している`);
  assert.equal(dir.includes(path.join('issues', ISSUE_NUMBER)) || dir.endsWith(path.join('issues', ISSUE_NUMBER)), true);
});

test('issueDir: backend=github は os.tmpdir() 配下を返す', () => {
  const dir = issueDir(ROOT, ISSUE_NUMBER, 'github');
  assert.equal(dir.startsWith(os.tmpdir() + path.sep), true, `${dir} が os.tmpdir() 配下ではない`);
});

test('issueDir: backend=github は同一rootに対して呼び出しごとに同じパスを返す（安定性）', () => {
  assert.equal(issueDir(ROOT, ISSUE_NUMBER, 'github'), issueDir(ROOT, ISSUE_NUMBER, 'github'));
});

test('issueDir: backend=github はrootが異なれば異なるscratchパスへ解決される（他repoとの衝突回避）', () => {
  const other = '/tmp/other-root';
  assert.notEqual(issueDir(ROOT, ISSUE_NUMBER, 'github'), issueDir(other, ISSUE_NUMBER, 'github'));
});

test('reviewFilePath: backend=github でも issueNumber・gateId が異なれば異なるパスに解決される', () => {
  const a = reviewFilePath(ROOT, '1', 'design', 'github');
  const b = reviewFilePath(ROOT, '2', 'design', 'github');
  const c = reviewFilePath(ROOT, '1', 'spec', 'github');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('全パス関数の出力（backend=github）は issueDir(...,\'github\') 配下（プレフィックス一致）である', () => {
  const dir = issueDir(ROOT, ISSUE_NUMBER, 'github');
  for (const p of [
    stateFilePath(ROOT, ISSUE_NUMBER, 'github'),
    leaseFilePath(ROOT, ISSUE_NUMBER, 'github'),
    integrationFilePath(ROOT, ISSUE_NUMBER, 'github'),
    reviewFilePath(ROOT, ISSUE_NUMBER, 'design', 'github'),
    reportFilePath(ROOT, ISSUE_NUMBER, 'spec', 'github'),
  ]) {
    assert.equal(p.startsWith(dir + path.sep), true, `${p} は ${dir} 配下ではない`);
  }
});
