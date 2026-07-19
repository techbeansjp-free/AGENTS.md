import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/lib/config.js';

test('loadConfig: 実物の .agent-skill-chain/config/agent-skill-chain.yaml を読み込み主要フィールドを検証する', () => {
  const config = loadConfig();

  assert.equal(config.schema_version, 'agent-skill-chain/config/v1');
  assert.equal(config.coordination.backend, 'github');
  assert.equal(config.durability.backend, 'remote');
  assert.equal(config.autonomy.default, 'gated');
  assert.equal(config.risk.default, 'unclassified');
  assert.equal(config.worktree.path_pattern, '{issue_created_at}-{type}-{issue_id}-{slug}');
  assert.equal(config.worktree.root, '.worktrees');
  assert.equal(config.worktree.slug_max_length, 48);
  assert.equal(config.branch.pattern, '{type}/{issue_id}-{slug}');
  assert.deepEqual(config.issue.allowed_types, ['feature', 'bugfix', 'hotfix', 'refactor', 'docs', 'process']);
  assert.equal(config.wip.limit, 3);
  assert.equal(config.lease.ttl_seconds, 3600);
  assert.equal(config.bdd.profile, 'standard');
  assert.equal(config.templates.verify_sync, true);
  assert.equal(config.checks.spec, 'agent-skill-chain/spec-gate');
});

test('loadConfig: スキーマ不適合の config は例外を投げる', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'load-config-test-'));
  fs.writeFileSync(path.join(tmp, '.git'), '');
  const configDir = path.join(tmp, '.agent-skill-chain', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  // coordination.backend が enum(github|local) 不適合、かつ必須フィールド(durability等)を欠く。
  fs.writeFileSync(
    path.join(configDir, 'agent-skill-chain.yaml'),
    'schema_version: agent-skill-chain/config/v1\ncoordination:\n  backend: invalid-backend\n',
  );

  assert.throws(() => loadConfig(tmp), /スキーマ（agent-skill-chain\/config\/v1）に適合しません/);
});
