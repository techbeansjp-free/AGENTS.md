import path from 'node:path';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset, repoRoot } from './paths.js';
import { validateAgainstSchema } from './schema.js';
import type { WorkerConfig } from './worker-selection.js';

export interface AgentSkillChainConfig {
  schema_version: string;
  coordination: { backend: 'github' | 'local' };
  durability: { backend: 'remote' | 'local_mirror' };
  autonomy: { default: 'gated' | 'full' };
  risk: { default: 'unclassified' | 'normal' | 'high' };
  review: {
    adapter?: 'claude' | 'codex' | 'human';
    standard: { reviewer_count: number; modes: string[] };
    strict: { reviewer_count: number; trigger: { risk_not_normal: boolean; autonomy_full: boolean } };
  };
  worker: WorkerConfig;
  worktree: {
    root: string;
    path_pattern: string;
    timestamp: { source: string; format: string; timezone: string };
    slug_max_length: number;
    immutable_path: boolean;
  };
  branch: { pattern: string };
  // バッククォート付き computed property name（`config/agent-skill-chain.yaml` の実キー名と
  // 完全に等価）。vocab lint の識別子文脈判定（Issue #187 ADR-1: YAML文脈は.yaml/.yml限定）が
  // 実ファイルではないTS型宣言のキー構文を誤って識別子文脈と見なさないよう、コード参照として
  // 正当な除外規則（バッククォート）を通す。
  [`issue`]: { allowed_types: string[] };
  wip: { limit: number; count_by: string };
  lease: { ttl_seconds: number; renewal_interval_seconds: number };
  bdd: { profile: 'standard' | 'strict' };
  // ADR-0021。本セクション自体を持たない既存の設定ファイルを妥当なまま受け入れるため任意項目にする
  // （未設定は無効と同義）。target・max_body_chars も省略時は CLI 側の既定へフォールバックする。
  issue_sync?: { enabled: boolean; target?: `issue_body` | `pr_body` | `both`; max_body_chars?: number };
  // Issue #427。進行役（AIエージェント）が `pr merge` コマンド自体でPRマージを実行してよいかの
  // opt-in。既定は未設定＝無効（`autonomy: gated | full` とは独立の別軸、混同しない）。
  // 本セクションを持たない既存の設定ファイルを妥当なまま受け入れるため任意項目にする。
  merge?: { autonomous: boolean };
  // Issue #427。`merge.autonomous` と同じ精神の独立した opt-in で、実装セグメント着手前
  // （`segment start <issue_id> implementation`）に人間の明示的な確認を要求するかを制御する。
  // 既定は未設定＝要求する（true相当）。`merge.autonomous`（既定false＝要求する）とは
  // 真偽の極性が逆であることに注意（本フィールドは「確認要否」、`merge.autonomous`は
  // 「自動実行の許可」を表す）。`autonomy: gated | full` とは独立の別軸、混同しない。
  human_confirmation?: { before_implementation: boolean };
  templates: {
    github_source: string;
    github_target: string;
    claude_agents_source?: string;
    claude_agents_target?: string;
    verify_sync: boolean;
  };
  checks: { spec: string; design: string; implementation: string; validation: string };
}

let cached: { root: string; config: AgentSkillChainConfig } | undefined;

export function loadConfig(root: string = repoRoot()): AgentSkillChainConfig {
  if (cached && cached.root === root) return cached.config;
  const configPath = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), root);
  const config = readYamlFile<AgentSkillChainConfig>(configPath);
  const outcome = validateAgainstSchema('config', config, root);
  if (!outcome.valid) {
    throw new Error(
      `config/agent-skill-chain.yaml がスキーマ（agent-skill-chain/config/v1）に適合しません:\n` +
        outcome.errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
  cached = { root, config };
  return config;
}
