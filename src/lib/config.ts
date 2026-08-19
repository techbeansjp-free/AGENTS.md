import path from 'node:path';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset, repoRoot } from './paths.js';
import { validateAgainstSchema } from './schema.js';
import type { WorkerConfig } from './worker-selection.js';
import { resolveGateRoundLimit, validateGateRoundLimit, type GateRoundLimit } from './gate-round.js';

export interface AgentSkillChainConfig {
  schema_version: string;
  // ADR-0023。軽量プロファイルかどうかを機械的に判定する唯一の正本。後方互換な任意項目であり、
  // 本フィールドを持たない既存の設定ファイルは standard として扱う（未設定＝standard相当）。
  profile?: 'standard' | 'lightweight';
  coordination: { backend: 'github' | 'local' };
  durability: { backend: 'remote' | 'local_mirror' };
  autonomy: { default: 'gated' | 'full' };
  risk: { default: 'unclassified' | 'normal' | 'high' };
  review: {
    adapter?: 'claude' | 'codex' | 'human';
    standard: { reviewer_count: number; modes: string[] };
    strict: { reviewer_count: number; trigger: { risk_not_normal: boolean; autonomy_full: boolean } };
    round_limit?: GateRoundLimit;
    prompt_max_input_bytes?: number;
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
  // auto_update_branch（Issue #493）は、対象PRがbase branchに対して最新でない（behind）と
  // 判明した場合に `gh api -X PUT .../update-branch` による自動最新化を試みてよいかの opt-in。
  // 既定は未設定＝無効（最新化を試みず日本語エラーで中断する安全側の既定挙動）。
  merge?: { autonomous: boolean; auto_update_branch?: boolean };
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
    // ADR-0023。claude_agents_source/claude_agents_targetと同形式の任意項目（Issue #503）。
    claude_skills_source?: string;
    claude_skills_target?: string;
    verify_sync: boolean;
  };
  checks: { spec: string; design: string; implementation: string; validation: string };
}

let cached: { root: string; config: AgentSkillChainConfig } | undefined;

/**
 * `overrideConfig` を指定した場合、対象ディレクトリのファイルを一切読み取らず、渡されたオブジェクト
 * をそのままスキーマ検証してから返す（ディスクへの読み取り・キャッシュ更新も行わない）。
 * `upgrade --dry-run` が、破損・不正値を含む対象configファイルを書き換えずに（読み取り専用のまま）、
 * 既に算出済みの「修復後相当」のconfig内容だけを後続のtemplate解決へ渡すために使う
 * （手動implementation-gateレビュー指摘: upgrade-dry-run-writes-target-config/file の派生修正）。
 */
export function loadConfig(root: string = repoRoot(), overrideConfig?: unknown): AgentSkillChainConfig {
  if (overrideConfig !== undefined) {
    const outcome = validateAgainstSchema('config', overrideConfig, root);
    if (!outcome.valid) {
      throw new Error(
        `config/agent-skill-chain.yaml がスキーマ（agent-skill-chain/config/v1）に適合しません:\n` +
          outcome.errors.map((e) => `  - ${e}`).join('\n'),
      );
    }
    const config = overrideConfig as AgentSkillChainConfig;
    const roundLimitError = validateGateRoundLimit(resolveGateRoundLimit(config.review.round_limit));
    if (roundLimitError) throw new Error(`config/agent-skill-chain.yaml の設定エラー: ${roundLimitError}`);
    return config;
  }
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
  const roundLimitError = validateGateRoundLimit(resolveGateRoundLimit(config.review.round_limit));
  if (roundLimitError) throw new Error(`config/agent-skill-chain.yaml の設定エラー: ${roundLimitError}`);
  cached = { root, config };
  return config;
}
