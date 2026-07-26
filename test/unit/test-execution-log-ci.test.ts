import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
// Issue #290: agent-skill-chain自身の自己テスト（npm test）は配布テンプレート対象外の
// 本リポジトリ専用ファイル agent-skill-chain-self-test.yml へ分離済み。配布テンプレートには
// 対応物が存在しないため、テンプレート正本との完全一致検査は行わない。
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-self-test.yml');
const policyPath = path.join(root, '.agent-skill-chain', 'standards', 'TEST_POLICY.md');

test('CIはnpm testの完全ログを失敗終了を保ったまま常時artifactへ保存する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(
    workflow,
    /name: Run npm test and save execution log[\s\S]*?set -o pipefail[\s\S]*?npm test 2>&1 \| tee test-execution\.log/,
  );
  assert.match(
    workflow,
    /name: Upload npm test execution log[\s\S]*?if: always\(\)[\s\S]*?uses: actions\/upload-artifact@v4[\s\S]*?path: test-execution\.log/,
  );
  assert.ok(!workflow.includes('continue-on-error: true'), 'テスト失敗を成功扱いにしないこと');
});

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
