import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-gate.yml');
const templatePath = path.join(root, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-gate.yml');

test('gate workflow: coreは公式Codex ActionをStrict独立2回起動し、認証欠如はaction_requiredで停止する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name: Detect automatic reviewer credentials/);
  assert.match(workflow, /conclusion: "neutral"/);
  assert.match(workflow, /manual review, local gate record, and admin merge procedure/);
  assert.match(workflow, /name: Publish action-required gate when core reviewer credentials are unavailable/);
  assert.match(workflow, /core_review_required == 'true'[\s\S]*?conclusion: "action_required"/);
  assert.match(workflow, /required frontier-coding \/ maximum-reasoning reviewer is unavailable/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, labeled, unlabeled\]/);
  assert.match(workflow, /if \[ "\$CORE_REVIEW_REQUIRED" = "true" \]; then PROFILE=strict; fi/);
  assert.match(workflow, /name: Run gate review \(\$\{\{ matrix\.gate \}\}\)[\s\S]*?if: steps\.credentials\.outputs\.available == 'true'/);
  assert.equal((workflow.match(/uses: openai\/codex-action@v1/g) ?? []).length, 2);
  assert.equal((workflow.match(/openai-api-key: \$\{\{ secrets\.OPENAI_API_KEY \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/model: gpt-5\.6-sol/g) ?? []).length, 2);
  assert.equal((workflow.match(/effort: xhigh/g) ?? []).length, 2);
  assert.equal((workflow.match(/permission-profile: ":read-only"/g) ?? []).length, 2);
  assert.equal((workflow.match(/safety-strategy: drop-sudo/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /safety-strategy: read-only/);
  assert.match(workflow, /name: Run Codex core reviewer 2[\s\S]*?steps\.ctx\.outputs\.profile == 'strict'/);
  assert.match(workflow, /gate record-verdict[\s\S]*?"\$GITHUB_WORKSPACE" "\$EXPECTED"/);
  assert.match(workflow, /if: steps\.credentials\.outputs\.available == 'true' && steps\.ctx\.outputs\.core_review_required != 'true'[\s\S]*?id: adapter_judgment/);
  assert.match(workflow, /ANTHROPIC_API_KEY: \$\{\{ steps\.ctx\.outputs\.adapter == 'claude' && secrets\.ANTHROPIC_API_KEY \|\| '' \}\}/);
  assert.match(workflow, /OPENAI_API_KEY: \$\{\{ steps\.ctx\.outputs\.adapter == 'codex' && secrets\.OPENAI_API_KEY \|\| '' \}\}/);
  assert.match(workflow, /name: Surface reviewer error[\s\S]*?steps\.codex_judgment\.outputs\.outcome == 'error'/);
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
});
