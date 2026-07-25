import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyCoreReview, loadCoreReviewPolicy } from '../../src/lib/model-selection.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitChange(repoDir: string, relativePath: string, content: string): string {
  const target = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  git(repoDir, ['add', relativePath]);
  git(repoDir, ['commit', '-m', `test: change ${relativePath}`]);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

test('model selection policy: manifestのCodex固定値とClaude能力証明契約を読み込む', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const policy = loadCoreReviewPolicy(repo.dir);
  assert.ok(policy);
  assert.equal(policy.required_profile, 'strict');
  assert.deepEqual(policy.capability, {
    model_tier: 'frontier_coding',
    reasoning_tier: 'maximum_reasoning',
  });
  assert.equal(policy.adapters.codex.model, 'gpt-5.6-sol');
  assert.equal(policy.adapters.codex.reasoning_effort, 'xhigh');
  assert.equal(policy.adapters.claude.model_env, 'CLAUDE_CORE_REVIEW_MODEL');
  assert.deepEqual(policy.github_automation, {
    adapter: 'codex',
    action: 'openai/codex-action@v1',
    api_key_secret: 'OPENAI_API_KEY',
  });
  assert.equal(policy.unavailable, 'human_required');
});

test('classifyCoreReview: manifestのcore path差分をrequiredとして分類する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  git(repo.dir, ['checkout', '-b', 'process/1-core-change']);
  const targetSha = commitChange(repo.dir, 'src/lib/example-core.ts', 'export const core = true;\n');

  const decision = classifyCoreReview(repo.dir, { targetSha, baseRef: 'main', reviewSubject: 'ordinary' });
  assert.equal(decision.required, true);
  assert.equal(decision.status, 'resolved');
  assert.equal(decision.reason, 'core_path_changed');
  assert.deepEqual(decision.changed_paths, ['src/lib/example-core.ts']);
});

test('classifyCoreReview: 非core差分は通常作業として明示選択を維持する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  git(repo.dir, ['checkout', '-b', 'docs/1-ordinary-change']);
  const targetSha = commitChange(repo.dir, 'README.md', '# ordinary docs\n');

  const decision = classifyCoreReview(repo.dir, { targetSha, baseRef: 'main', reviewSubject: 'ordinary' });
  assert.equal(decision.required, false);
  assert.equal(decision.status, 'resolved');
  assert.equal(decision.reason, 'ordinary');
});

test('classifyCoreReview: 明示core_auditはコード差分無しでもrequiredになる', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const decision = classifyCoreReview(repo.dir, {
    targetSha: git(repo.dir, ['rev-parse', 'HEAD']),
    baseRef: 'main',
    reviewSubject: 'core_audit',
  });
  assert.equal(decision.required, true);
  assert.equal(decision.status, 'resolved');
  assert.equal(decision.reason, 'explicit_core_audit');
});

test('classifyCoreReview: base/targetを解決できない場合は非coreへ降格せずunresolvedになる', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());

  const decision = classifyCoreReview(repo.dir, {
    targetSha: 'missing-target',
    baseRef: 'missing-base',
    reviewSubject: 'ordinary',
  });
  assert.equal(decision.required, true);
  assert.equal(decision.status, 'unresolved');
  assert.equal(decision.reason, 'classification_unavailable');
});

test('classifyCoreReview: model_selectionを持たないconsumer projectは従来の通常作業になる', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  fs.rmSync(path.join(repo.dir, '.agent-skill-chain', 'project', 'manifest.yaml'));

  const decision = classifyCoreReview(repo.dir, {
    targetSha: git(repo.dir, ['rev-parse', 'HEAD']),
    baseRef: 'main',
    reviewSubject: 'ordinary',
  });
  assert.equal(decision.required, false);
  assert.equal(decision.reason, 'policy_absent');
});
