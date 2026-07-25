import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-gate.yml');
const templatePath = path.join(root, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-gate.yml');

test('gate workflow: 認証情報未設定はneutral Check Runを発行してjobを成功終了し、実行後エラーのfailure経路を残す', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name: Detect automatic reviewer credentials/);
  assert.match(workflow, /conclusion: "neutral"/);
  assert.match(workflow, /manual review, local gate record, and admin merge procedure/);
  assert.match(workflow, /name: End gate job successfully after neutral publication[\s\S]*?run: exit 0/);
  assert.match(workflow, /name: Run gate reviewer judgment \(\$\{\{ matrix\.gate \}\}\)[\s\S]*?if: steps\.credentials\.outputs\.available == 'true'/);
  assert.match(workflow, /name: Surface reviewer error[\s\S]*?if: steps\.judgment\.outputs\.outcome == 'error'/);
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
});
