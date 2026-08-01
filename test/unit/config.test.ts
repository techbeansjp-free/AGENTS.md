import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/lib/config.js';
import { packageRoot } from '../../src/lib/paths.js';

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
  assert.deepEqual(config.issue.allowed_types, ['feature', 'bugfix', 'hotfix', 'refactor', 'docs', 'process', 'chore']);
  assert.equal(config.wip.limit, 3);
  assert.equal(config.lease.ttl_seconds, 3600);
  assert.equal(config.bdd.profile, 'standard');
  assert.equal(config.templates.verify_sync, true);
  assert.equal(config.checks.spec, 'agent-skill-chain/spec-gate');
});

// ISSUE-307 SPEC.md AC-6: 本リポジトリの .agent-skill-chain/config/agent-skill-chain.yaml は
// 実装セグメントを codex・highest_capability・high に恒久設定しており、具体的なモデル文字列
// （gpt-5.6-sol）が現れるのは worker.model_tiers のみである。dogfooding worktree からの実行では
// 既定root（repoRoot()）が common .git 経由でメイン作業ツリーへ解決される（ADR-0004）ため、
// このworktreeでの変更を確実に対象にするには packageRoot()（このモジュールが実行されている
// 場所）を明示的に渡す（test/unit/schema.test.ts の同種テストと同じ回避策）。
test('loadConfig (AC-6): worker.segment_overrides.implementation が codex/highest_capability/high に恒久設定され、worker.model_tiersのみに具体的なモデル文字列を持つ', () => {
  const config = loadConfig(packageRoot());
  assert.equal(config.worker.adapter, 'claude');
  assert.deepEqual(config.worker.segment_overrides?.implementation, {
    adapter: 'codex',
    model_tier: 'highest_capability',
    reasoning_effort: 'high',
  });
  assert.equal(config.worker.model_tiers?.highest_capability?.codex, 'gpt-5.6-sol');

  const raw = fs.readFileSync(path.join(packageRoot(), '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'), 'utf8');
  const modelOccurrences = raw.match(/gpt-5\.6-sol/g) ?? [];
  assert.equal(modelOccurrences.length, 1, '具体的なモデル文字列が現れるのはworker.model_tiersの1箇所のみであること');
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
