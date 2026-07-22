import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { issueDir, stateFilePath, leaseFilePath, integrationFilePath, reviewFilePath } from '../../src/lib/local-state.js';

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
