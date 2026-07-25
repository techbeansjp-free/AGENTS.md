import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-gate.yml');
const templatePath = path.join(root, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-gate.yml');
const localHarnessPath = path.join(root, '.agent-skill-chain', 'scripts', 'gate-local-review.sh');
const launcherPath = path.join(root, '.agent-skill-chain', 'scripts', 'gate-launch-reviewer.sh');
const codexAdapterPath = path.join(root, '.agent-skill-chain', 'adapters', 'codex.sh');
const claudeAdapterPath = path.join(root, '.agent-skill-chain', 'adapters', 'claude.sh');

test('gate workflow: protected baseでlocal-review証跡だけを検証しCheck Runを発行する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /pull_request_review:/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /base\.ref == github\.event\.repository\.default_branch/);
  assert.match(workflow, /gate verify-evidence/);
  assert.match(workflow, /gate-publish\.sh/);
  assert.match(workflow, /conclusion: "action_required"/);
  assert.match(workflow, /without executing target code/);

  const forbidden = [
    ['OPENAI', 'API', 'KEY'].join('_'),
    ['ANTHROPIC', 'API', 'KEY'].join('_'),
    ['openai', 'codex-action', 'v1'].join('/').replace('/v1', '@v1'),
    'Run Codex core reviewer',
    'Run gate reviewer judgment',
    'self-hosted',
  ];
  for (const token of forbidden) assert.equal(workflow.includes(token), false, `CI内AI依存を含まない: ${token}`);
});

test('local review harness: PR base SHAの隔離cloneでbase sourceをbuildしてadapterを起動する', () => {
  const harness = fs.readFileSync(localHarnessPath, 'utf8');
  assert.match(harness, /gh api "repos\/\{owner\}\/\{repo\}\/pulls\/\$PR_NUMBER"/);
  assert.match(harness, /mktemp -d/);
  assert.match(harness, /git clone --quiet --no-checkout/);
  assert.match(harness, /checkout --quiet --detach "\$BASE_SHA"/);
  assert.match(harness, /PR_BASE_REF.*DEFAULT_BRANCH/);
  assert.match(harness, /remote remove origin/);
  assert.doesNotMatch(harness, /remote set-url origin/);
  assert.match(harness, /npm ci --ignore-scripts/);
  assert.match(harness, /npm run build/);
  assert.match(harness, /"\$TRUSTED_SCRIPT_DIR\/gate-launch-reviewer\.sh"/);
  assert.match(harness, /launcher-token\.json/);
  assert.match(harness, /ASC_REVIEW_ATTEMPT_ID/);
  const consumedCheck = harness.indexOf('launcher tokenが全slotで消費されませんでした');
  const dispatch = harness.indexOf('gh api -X POST "repos/{owner}/{repo}/dispatches" --input -');
  assert.ok(consumedCheck >= 0 && dispatch > consumedCheck);
  assert.match(harness, /event_type: "agent-skill-chain-gate-record"/);
  assert.match(harness, /client_payload: \{pr_number: Number\(prNumber\), gate, target_sha: targetSha\}/);
  assert.doesNotMatch(harness, /"\$SCRIPT_DIR\/gate-launch-reviewer\.sh"/);

  const launcher = fs.readFileSync(launcherPath, 'utf8');
  const codex = fs.readFileSync(codexAdapterPath, 'utf8');
  const claude = fs.readFileSync(claudeAdapterPath, 'utf8');
  assert.match(claude, /env -i/);
  assert.match(claude, /GH_CONFIG_DIR=/);
  assert.match(claude, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(codex, /shell_environment_policy\.inherit/);
  assert.match(codex, /permissions\.review\.filesystem/);
  assert.doesNotMatch(launcher, /GH_TOKEN=.*launch_gate_reviewer/);
});
