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
  assert.deepEqual(config.review.round_limit, { narrowing_threshold: 2, cutoff_threshold: 4 });
  assert.equal(config.review.prompt_max_input_bytes, 1_500_000);
  assert.equal(config.worker.adapter, 'claude');
  assert.equal(config.worker.agent_tool_dispatch?.enabled, true);
  assert.equal(config.templates.claude_agents_source, '.agent-skill-chain/templates/claude/agents');
  assert.equal(config.templates.claude_agents_target, '.claude/agents');
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

// ADR-0023（Issue #503）AC-4/AC-7: 本リポジトリ自身は既定プロファイル（profile: standard）。
test('loadConfig (ADR-0023): 本リポジトリ自身の profile は standard、templates.claude_skills_source/target は既定パスへフォールバックする', () => {
  const config = loadConfig(packageRoot());
  assert.equal(config.profile, 'standard');
  assert.equal(config.templates.claude_skills_source, undefined);
  assert.equal(config.templates.claude_skills_target, undefined);
});

// ADR-0023（Issue #503）: 軽量プロファイル用テンプレート自体もconfig schemaへ適合すること。
test('loadConfig (ADR-0023): .agent-skill-chain/templates/lightweight/agent-skill-chain.yaml はスキーマに適合し profile: lightweight を持つ', () => {
  const lightweightConfigPath = path.join(
    packageRoot(),
    '.agent-skill-chain',
    'templates',
    'lightweight',
    'agent-skill-chain.yaml',
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'load-config-lightweight-test-'));
  fs.writeFileSync(path.join(tmp, '.git'), '');
  const configDir = path.join(tmp, '.agent-skill-chain', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(lightweightConfigPath, path.join(configDir, 'agent-skill-chain.yaml'));

  const config = loadConfig(tmp);
  assert.equal(config.profile, 'lightweight');
  assert.equal(config.coordination.backend, 'local');
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

test('loadConfig: round_limitの大なり・等号は日本語の設定エラー、各下限と非整数はスキーマエラーになる', () => {
  const valid = structuredClone(loadConfig(packageRoot()));
  for (const roundLimit of [
    { narrowing_threshold: 5, cutoff_threshold: 4 },
    { narrowing_threshold: 4, cutoff_threshold: 4 },
  ]) {
    const config = structuredClone(valid);
    config.review.round_limit = roundLimit;
    assert.throws(() => loadConfig(packageRoot(), config), /真に小さい/);
  }
  for (const roundLimit of [
    { narrowing_threshold: 0, cutoff_threshold: 4 },
    { narrowing_threshold: 1, cutoff_threshold: 1 },
    { narrowing_threshold: 1.5, cutoff_threshold: 4 },
  ]) {
    const config = structuredClone(valid);
    config.review.round_limit = roundLimit;
    assert.throws(() => loadConfig(packageRoot(), config), /スキーマ.*適合しません/s);
  }
});

test('loadConfig: prompt_max_input_bytesは正整数だけを受理する', () => {
  const valid = structuredClone(loadConfig(packageRoot()));
  for (const value of [0, -1, 1.5]) {
    const config = structuredClone(valid);
    config.review.prompt_max_input_bytes = value;
    assert.throws(() => loadConfig(packageRoot(), config), /スキーマ.*適合しません/s);
  }
});
