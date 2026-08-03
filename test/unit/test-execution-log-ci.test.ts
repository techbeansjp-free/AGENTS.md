import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const policyPath = path.join(root, '.agent-skill-chain', 'standards', 'TEST_POLICY.md');

test('独立検証の手順は保存ログ、失敗記録、フォローアップの必須項目を定める', () => {
  const policy = fs.readFileSync(policyPath, 'utf8');

  for (const required of [
    'set -o pipefail',
    'npm test 2>&1 | tee test-execution.log',
    'VALIDATION.md',
    'テストファイル名',
    'テストケース名',
    'エラーメッセージ',
    'スタックトレース',
    'タイミング依存',
    '順序依存',
    'リソース競合',
    '非同期処理の race condition',
  ]) {
    assert.ok(policy.includes(required), `手順に '${required}' があること`);
  }
});
