// 正本: AGENTS.md §設定
//
// セグメント作業ワーカー(spec/design/implementation/validation)を起動する際の
// adapter・model_tier・reasoning_effort・具体的なモデル文字列を、config とセグメント名だけから
// 決める純粋関数群。ファイル入出力・環境変数の読み書き・プロセス起動は一切行わない
// （単体テストの主対象）。ティア名から具体的なモデル文字列への解決（resolveModelForTier）は
// ここで完結させる。アダプタ（.agent-skill-chain/adapters/codex.sh）はこの解決を行わず、
// 解決済みの値を環境変数経由で受け取るだけである。
//
// AgentSkillChainConfig.worker はこのモジュールが定義する型をそのまま用いる
// （config.ts は読込・検証・型付けのみを担い、セグメント別上書き・ティア対応表の意味は持たない）。

export type WorkerSegment = 'spec' | 'design' | 'implementation' | 'validation';
export type WorkerAdapter = 'claude' | 'codex' | 'human';
export type ModelTier = 'highest_capability';
export type ReasoningEffort = 'medium' | 'high';

export interface WorkerSegmentOverride {
  adapter?: WorkerAdapter;
  model_tier?: ModelTier;
  reasoning_effort?: ReasoningEffort;
}

/**
 * ティア対応表（`worker.model_tiers`）。ティア名をキーとし、値は実行系アダプタ名をキーとする
 * 具体的なモデル文字列の集合。現時点で対応するアダプタキーは `codex` のみであり、claude/human 用の
 * モデル対応表は未定義である。
 */
export type ModelTierTable = Partial<Record<ModelTier, { codex?: string }>>;

/** config.ts の AgentSkillChainConfig['worker'] の型。 */
export interface WorkerConfig {
  adapter?: WorkerAdapter;
  agent_tool_dispatch?: { enabled: boolean };
  segment_overrides?: Partial<Record<WorkerSegment, WorkerSegmentOverride>>;
  model_tiers?: ModelTierTable;
}

export interface WorkerSelection {
  adapter: WorkerAdapter;
  agentToolDispatch: boolean;
  model_tier?: ModelTier;
  reasoning_effort?: ReasoningEffort;
}

const WORKER_SEGMENTS: readonly WorkerSegment[] = ['spec', 'design', 'implementation', 'validation'];

export function isWorkerSegment(value: string): value is WorkerSegment {
  return (WORKER_SEGMENTS as readonly string[]).includes(value);
}

/**
 * adapter は「セグメント別上書き → worker.adapter（スカラー、4セグメント共通の既定値）→ human
 * （最終フォールバック）」の順で解決する。model_tier・reasoning_effort は
 * セグメント別上書きにのみ存在しうる値であり、無指定の場合はキー自体を含めない
 * （呼び出し側・アダプタが「未解決」と「空文字での上書き」を区別できるようにするため）。
 * 具体的なモデル文字列はここでは扱わない（resolveModelForTier が別途ティア対応表から解決する）。
 */
export function resolveWorkerSelection(config: { worker: WorkerConfig }, segment: WorkerSegment): WorkerSelection {
  const override = config.worker.segment_overrides?.[segment];
  const adapter = override?.adapter ?? config.worker.adapter ?? 'human';
  const selection: WorkerSelection = {
    adapter,
    agentToolDispatch: config.worker.agent_tool_dispatch?.enabled === true,
  };
  if (override?.model_tier) selection.model_tier = override.model_tier;
  if (override?.reasoning_effort) selection.reasoning_effort = override.reasoning_effort;
  return selection;
}

export type ModelResolution = { ok: true; model: string } | { ok: false; reason: string };

/**
 * ティア対応表（`worker.model_tiers`）を引き、ティア名とアダプタ名の組から具体的なモデル文字列を
 * 得る。対応表そのものが無い・当該ティアのエントリが無い・当該アダプタ用のモデルが
 * 無い、のいずれの場合も値を推測せず解決失敗として返す（呼び出し側が既存のフェイルセーフへ倒す）。
 */
export function resolveModelForTier(config: { worker: WorkerConfig }, tier: ModelTier, adapter: WorkerAdapter): ModelResolution {
  const tierEntry = config.worker.model_tiers?.[tier];
  if (!tierEntry) {
    return {
      ok: false,
      reason: `モデルティア対応表にティア ${tier} のエントリがありません（worker.model_tiers.${tier} が未定義です）`,
    };
  }
  const model = adapter === 'codex' ? tierEntry.codex : undefined;
  if (!model) {
    return {
      ok: false,
      reason: `モデルティア対応表にアダプタ ${adapter} 用のモデルがありません（worker.model_tiers.${tier}.${adapter} が未定義です）`,
    };
  }
  return { ok: true, model };
}
