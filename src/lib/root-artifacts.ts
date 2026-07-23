/**
 * Issueセグメント成果物のうち、squash merge のたびにmainリポジトリルート直下へ恒久混入しうる
 * 4ファイル（コード内リテラル、設定化しない。Issue #208）。`checkOutputExists()`
 * （src/commands/verify.ts の 'code' ケース）が diff --stat から除外するpathspecと同一の4件を
 * そのまま踏襲する。
 */
export const ROOT_ARTIFACT_FILES = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'] as const;

export type RootArtifactFile = (typeof ROOT_ARTIFACT_FILES)[number];
