import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';
import { validateAgainstSchema } from '../../src/lib/schema.js';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const projectDir = path.join(packageRoot, '.agent-skill-chain', 'project');
const trackedArtifacts = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

test('self-extension project policy: manifestで登録した実在文書だけを規範として定義する', () => {
  const manifestPath = path.join(projectDir, 'manifest.yaml');
  const manifest = readYamlFile<Record<string, unknown>>(manifestPath);
  const validation = validateAgainstSchema('project-policy', manifest, packageRoot);
  assert.deepEqual(validation, { valid: true, errors: [] });

  const common = ((manifest.documents as { common: string[] }).common);
  assert.deepEqual(common, ['RULES.md', '自己拡張ワークフロー.md', 'OPERATING_PRINCIPLES.md', 'MODEL_TIER_TABLE.md']);
  for (const document of common) {
    const content = fs.readFileSync(path.join(projectDir, document), 'utf8');
    assert.ok(content.trim().length > 0, `${document} が空ではないこと`);
    assert.doesNotMatch(content, /\.agent-skill-chain\/(?:source|runtime\/templates)|\.\.\/source/, `${document} が廃止assetを参照しないこと`);
  }

  const modelSelection = (manifest.model_selection as {
    ordinary: { behavior: string };
    core_review: {
      required_profile: string;
      unavailable: string;
      execution: {
        reviewer_location: string;
        evidence_transport: string;
        ci_role: string;
        reviewer_count: number;
        trusted_reviewer_actors: string[];
      };
      capability: { model_tier: string; reasoning_tier: string };
      adapters: { codex: { model: string; reasoning_effort: string }; claude: { model_env: string } };
    };
  });
  assert.equal(modelSelection.ordinary.behavior, 'explicit_selection');
  assert.equal(modelSelection.core_review.required_profile, 'strict');
  assert.equal(modelSelection.core_review.unavailable, 'human_required');
  assert.deepEqual(modelSelection.core_review.execution, {
    reviewer_location: 'local',
    evidence_transport: 'github_pr_review',
    ci_role: 'verify_only',
    reviewer_count: 2,
    trusted_reviewer_actors: ['agent-skill-chain-review-recorder[bot]'],
  });
  assert.deepEqual(modelSelection.core_review.capability, {
    model_tier: 'frontier_coding',
    reasoning_tier: 'maximum_reasoning',
  });
  assert.deepEqual(modelSelection.core_review.adapters.codex, {
    model: 'gpt-5.6-sol',
    reasoning_effort: 'xhigh',
  });
  assert.equal(modelSelection.core_review.adapters.claude.model_env, 'CLAUDE_CORE_REVIEW_MODEL');
  assert.doesNotMatch(
    fs.readFileSync(path.join(projectDir, 'MODEL_TIER_TABLE.md'), 'utf8'),
    /規範ではない|旧モデル選定メモ/,
    '旧メモが非規範のまま残らないこと',
  );
});

test('self-extension lifecycle: isolated repoで成果物の作成、記録、close後の復元を行える', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // `.gitignore` は package の自己拡張方針を実証するためfixtureへ明示的に導入する。
  fs.copyFileSync(path.join(packageRoot, '.gitignore'), path.join(repo.dir, '.gitignore'));
  git(repo.dir, ['add', '.gitignore']);
  git(repo.dir, ['commit', '-m', 'test: add self-extension ignore policy']);
  git(repo.dir, ['push']);

  const start = runCli(['issue', 'start', 'ISSUE-245', 'process', 'self-extension-policy', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  for (const artifact of trackedArtifacts) {
    const ignored = spawnSync('git', ['check-ignore', '--quiet', artifact], { cwd: worktreePath });
    assert.equal(ignored.status, 1, `${artifact} はignoreされないこと`);
  }

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC: isolated lifecycle\n\n- Issue: `ISSUE-245`\n\n#### AC-1\n');
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN: isolated lifecycle\n');
  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN: isolated lifecycle\n');
  fs.writeFileSync(
    path.join(worktreePath, 'VALIDATION.md'),
    'schema_version: agent-skill-chain/validation-report/v1\nissue_id: ISSUE-245\ntarget_sha: pending\nacceptance_criteria: []\nregression:\n  executed: true\n  evidence: [isolated-test]\n',
  );
  const checkpoint = runCli(['checkpoint', 'test: record self-extension issue artifacts'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  // local backendではIntegration RecordがDraft PRに相当し、Issue番号とbranchを恒久記録する。
  const pr = runCli(['pr', 'create', 'ISSUE-245', branch], { cwd: repo.dir });
  assert.equal(pr.status, 0, pr.stderr);
  assert.match(fs.readFileSync(pr.stdout.trim(), 'utf8'), /closes: ISSUE-245/);

  git(repo.dir, ['merge', '--no-ff', branch, '-m', 'merge: close ISSUE-245']);
  git(repo.dir, ['push']);
  for (const artifact of trackedArtifacts) {
    assert.ok(fs.existsSync(path.join(repo.dir, artifact)), `close後も${artifact}をmainから復元できること`);
  }
  assert.match(git(repo.dir, ['log', '--oneline', '--all', '--', 'SPEC.md']), /record self-extension issue artifacts/);
});

test('self-extension lifecycle (github backend): Draft PR本文がIssue #245をClosesで追跡する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-extension-github-stub-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  const start = runCli(['issue', 'start', 'ISSUE-245', 'process', 'self-extension-policy', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  for (const artifact of trackedArtifacts) {
    const ignored = spawnSync('git', ['check-ignore', '--quiet', artifact], { cwd: worktreePath });
    assert.equal(ignored.status, 1, `${artifact} はGitHub backendでもignoreされないこと`);
    fs.writeFileSync(path.join(worktreePath, artifact), `# ${artifact}\n`);
  }
  const checkpoint = runCli(['checkpoint', 'test: record GitHub-native self-extension artifacts'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const checkpointSha = git(worktreePath, ['rev-parse', 'HEAD']).trim();

  assert.equal(git(repo.dir, ['rev-parse', `origin/${branch}`]).trim(), checkpointSha, 'checkpointをremote branchへpushすること');
  for (const artifact of trackedArtifacts) {
    assert.equal(git(worktreePath, ['ls-tree', '--name-only', checkpointSha, '--', artifact]).trim(), artifact, `${artifact} がcheckpoint commitに記録されること`);
    assert.equal(git(repo.dir, ['ls-tree', '--name-only', `origin/${branch}`, '--', artifact]).trim(), artifact, `${artifact} がremote branchから復元できること`);
  }

  const pr = runCli(['pr', 'create', 'ISSUE-245', branch], { cwd: repo.dir, env });
  assert.equal(pr.status, 0, pr.stderr);

  const calls = stub.readState().prCreateCalls ?? [];
  assert.equal(calls.length, 1, 'GitHub-native Draft PRを1件作成すること');
  assert.ok(calls[0].args.includes('--draft'), 'Draft PRとして作成すること');
  assert.match(calls[0].body ?? '', /Closes #245/, 'PR本文がIssue #245をclose連携すること');
});
