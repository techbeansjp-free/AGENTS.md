/**
 * ローカル設定（git管理外、`.agent-skill-chain/local/`配下）の解決結果を表す
 * 4状態（Issue #1485、v0.4.2 Bounded Decision Skill core、設計正本
 * `memo/v0.4.*-計画/04_bounded-decision-skill_再設計.md`「最終確定仕様」§3）。
 *
 * **`absent`のときだけprimary worktreeへfallbackする。** `disabled`・`invalid`は
 * fallbackしない（個人が明示的に無効化・記入した設定を、worktreeを越えて無視しない）。
 * この4状態への分類は`classify*`系のpure関数が担い、active→primaryのfallback
 * 判定は`src/adapters/local-config-workspace.ts`が担う（domain/adaptersの
 * 責務分離。git・fs I/Oはadapters側に置く）。
 */
export type LocalConfigResolution<T> =
  | { readonly state: "absent" }
  | {
      readonly state: "enabled";
      readonly config: T;
      readonly source: "active" | "primary";
    }
  | { readonly state: "disabled"; readonly source: "active" | "primary" }
  | {
      readonly state: "invalid";
      readonly source: "active" | "primary";
      readonly reason: string;
    };

/**
 * ローカル設定fileの生内容（存在しない場合はundefined）を4状態のうち
 * `source`を持たない中間形へ分類する関数の型。git・fsを持たない単一rootの
 * pure classifierが実装し、`resolveLocalConfigWithWorkspaceFallback`が
 * active/primaryそれぞれへ適用してsourceを付与する。
 */
export type LocalConfigClassification<T> =
  | { readonly state: "absent" }
  | { readonly state: "enabled"; readonly config: T }
  | { readonly state: "disabled" }
  | { readonly state: "invalid"; readonly reason: string };

/** 診断表示用の1行要約。値そのもの（secret等）は含めない。 */
export function describeLocalConfigResolution<T>(
  resolution: LocalConfigResolution<T>,
): string {
  if (resolution.state === "absent") return "absent（設定fileなし）";
  if (resolution.state === "enabled")
    return `enabled（source=${resolution.source}）`;
  if (resolution.state === "disabled")
    return `disabled（source=${resolution.source}）`;
  return `invalid（source=${resolution.source}: ${resolution.reason}）`;
}
