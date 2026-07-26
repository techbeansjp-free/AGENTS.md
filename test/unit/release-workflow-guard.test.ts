import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NAMESPACED_ENTRIES } from '../../src/lib/asset-manifest.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const root = process.cwd();
const sentinelName = 'RELEASE_BLOCKED_UNTIL_ISSUE_283';
const guardCondition = "steps.release_guard.outputs.release_allowed == 'true'";
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-release.yml');
const templatePath = path.join(
  root,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-release.yml',
);
const guardScriptPath = path.join(root, '.agent-skill-chain', 'scripts', 'release-guard.sh');

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
}

interface ReleaseWorkflow {
  jobs: {
    release: {
      if?: string;
      steps: WorkflowStep[];
    };
  };
}

function executeGuard(sentinelPresent: boolean): string {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-release-guard-'));
  try {
    const scriptDir = path.join(fixtureRoot, '.agent-skill-chain', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    const fixtureScript = path.join(scriptDir, 'release-guard.sh');
    fs.copyFileSync(guardScriptPath, fixtureScript);
    fs.chmodSync(fixtureScript, 0o755);
    if (sentinelPresent) {
      fs.writeFileSync(path.join(fixtureRoot, '.agent-skill-chain', sentinelName), 'test sentinel\n');
    }
    const outputPath = path.join(fixtureRoot, 'github-output.txt');
    const result = spawnSync(fixtureScript, [], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(outputPath, 'utf8').trim();
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('release guard: sentinel有りはreleaseを禁止し、無しは従来経路を許可する', () => {
  assert.equal(executeGuard(true), 'release_allowed=false');
  assert.equal(executeGuard(false), 'release_allowed=true');
});

test('release workflow: checkout直後のguardがfalseならrelease-producing stepは0件になる', () => {
  const workflow = readYamlFile<ReleaseWorkflow>(workflowPath);
  const steps = workflow.jobs.release.steps;
  assert.match(steps[0]?.uses ?? '', /^actions\/checkout@/);
  assert.equal(steps[1]?.id, 'release_guard');
  assert.equal(steps[1]?.run, './.agent-skill-chain/scripts/release-guard.sh');

  const releaseProducingSteps = steps.slice(2);
  assert.ok(releaseProducingSteps.length > 0);
  assert.deepEqual(
    releaseProducingSteps.filter((step) => !step.if?.includes(guardCondition)),
    [],
    'guard=false時に実行可能なnpm/build/version/bump/tag/publish関連stepが無いこと',
  );
});

test('release workflow: sentinel無しでは従来経路と[skip ci]を維持しroot/templateも同期する', () => {
  const workflow = readYamlFile<ReleaseWorkflow>(workflowPath);
  const releaseJob = workflow.jobs.release;
  assert.equal(releaseJob.if, "${{ !contains(github.event.head_commit.message, '[skip ci]') }}");

  const steps = releaseJob.steps;
  for (const expected of [
    'npm ci',
    'npm run build',
    'release-resolve-version.sh',
    'release-bump.sh',
    'release-tag.sh',
    'release-publish.sh',
  ]) {
    assert.ok(steps.some((step) => step.run?.includes(expected)), `従来release経路に${expected}が残ること`);
  }
  assert.equal(fs.readFileSync(workflowPath, 'utf8'), fs.readFileSync(templatePath, 'utf8'));
});

test('release sentinel: packageとconsumer namespaced asset集合に含まれない', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    files: string[];
  };
  assert.equal(fs.existsSync(path.join(root, '.agent-skill-chain', sentinelName)), true);
  assert.equal(packageJson.files.some((entry) => entry.includes(sentinelName)), false);
  assert.equal(
    NAMESPACED_ENTRIES.includes(sentinelName),
    false,
    'init/setup/upgradeが共有するconsumer namespaced asset集合にsentinelを含めないこと',
  );
});
