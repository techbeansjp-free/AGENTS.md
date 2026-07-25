import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-gate.yml');
const templatePath = path.join(root, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-gate.yml');

test('gate workflow: 通常の認証欠如はneutralを維持し、core認証欠如はaction_requiredで停止する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name: Detect automatic reviewer credentials/);
  assert.match(workflow, /conclusion: "neutral"/);
  assert.match(workflow, /manual review, local gate record, and admin merge procedure/);
  assert.match(workflow, /name: Publish action-required gate when core reviewer credentials are unavailable/);
  assert.match(workflow, /core_review_required == 'true'[\s\S]*?conclusion: "action_required"/);
  assert.match(workflow, /required frontier-coding \/ maximum-reasoning reviewer is unavailable/);
  assert.match(workflow, /if \[ "\$CORE_REVIEW_REQUIRED" = "true" \]; then PROFILE=strict; fi/);
  assert.match(workflow, /name: End gate job after unavailable-reviewer publication[\s\S]*?run: exit 0/);
  assert.match(workflow, /name: Run gate reviewer judgment \(\$\{\{ matrix\.gate \}\}\)[\s\S]*?if: steps\.credentials\.outputs\.available == 'true'/);
  assert.match(workflow, /name: Surface reviewer error[\s\S]*?if: steps\.judgment\.outputs\.outcome == 'error'/);
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
});
