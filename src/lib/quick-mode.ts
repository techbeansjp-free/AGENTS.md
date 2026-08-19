import type { CoordinationBackend } from './local-state.js';
import { changedPaths, GUARDRAIL_PATHS } from './self-reference-guardrail.js';
import { readQuickSignals } from './gate-quick-exemption.js';

/**
 * quick モード（軽量な変更向けの成果物免除）の判定。
 *
 * Issue #425: 免除シグナルは、免除の対象そのものである Issue スコープ成果物
 * （SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md）に一切依存しない場所にだけ置く。
 * シグナルを成果物の内部（frontmatter 等）へ置くと「成果物を作らないための指定を
 * 成果物の中に書く」循環になり、免除が原理的に発動しなくなるため。GitHub モードでは
 * Issue 起票時点で存在する Issue ラベル、ローカルモードでは worktree 作成時点で
 * 書かれる state.yaml のフィールドを唯一の入力にする。
 */

/** GitHub モードで quick を宣言する Issue ラベル名。 */
export const QUICK_SIZE_LABEL = 'size:quick';

/**
 * quick 適用時に存在要求を免除する segment output。
 *
 * 免除するのは Issue スコープの4成果物ファイル（SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md）
 * に対応する output だけである。`acceptance_test_results`・`regression_test_results` は
 * VALIDATION.md の存在で代替判定される抽象出力のため同じ免除に含める。`ADR` は
 * 「docs/adr/ 配下に .md が1つ以上ある」というリポジトリ水準の検査であり4ファイルの
 * いずれでもないため免除しない（ADR を要する変更はそもそも下記ガードレールにより
 * quick 適用対象外になる）。`code`・`unit_test_results` は base ブランチとの差分検査であり
 * ファイル作成義務ではないため免除しない。
 */
export const QUICK_EXEMPT_OUTPUTS: readonly string[] = [
  'SPEC.md',
  'DESIGN.md',
  'PLAN.md',
  'acceptance_test_results',
  'regression_test_results',
];

export type IssueSize = 'quick' | 'standard';
export type IssueRisk = 'unclassified' | 'normal' | 'high';

export interface QuickModeDecision {
  /** quick シグナルの取得と構造解釈に成功したか。 */
  signalResolved: boolean;
  /** quick がシグナル（ラベルまたは state.yaml）で明示要求されたか。 */
  requested: boolean;
  /** 実際に成果物存在要求を免除するか。requested かつガードレール非抵触のときだけ真。 */
  exempt: boolean;
  /** ガードレール抵触理由（日本語、requested かつ非免除のときのみ非空）。 */
  blockedReasons: string[];
}

/**
 * quick 免除を適用してよいかを判定する。
 *
 * @param root リポジトリroot（gh 呼び出しと state.yaml 解決の基点）
 * @param worktreePath 当該 Issue の worktree（変更差分の基点）
 * @param issueNumber Issue 番号（文字列）
 * @param backend Coordination Backend
 */
export function resolveQuickMode(
  root: string,
  worktreePath: string,
  issueNumber: string,
  backend: CoordinationBackend,
): QuickModeDecision {
  const resolved = readQuickSignals(root, issueNumber, backend);
  // Issue #741: size/risk のどちらかでも一次情報から解決できない場合は、quick 免除も
  // 上流セグメントの閉包追加も適用しない（未解決を quick とも standard とも決めつけない）。
  if (resolved.size.status !== 'resolved' || resolved.risk.status !== 'resolved') {
    return { signalResolved: false, requested: false, exempt: false, blockedReasons: [] };
  }
  if (resolved.size.value !== 'quick') {
    return { signalResolved: true, requested: false, exempt: false, blockedReasons: [] };
  }

  const blockedReasons: string[] = [];
  if (resolved.risk.value !== 'normal') {
    blockedReasons.push(`risk が normal ではありません（現在: ${resolved.legacy.risk}）。quick は risk が normal の場合のみ適用できます`);
  }
  const changed = changedPaths(worktreePath);
  if (!changed.resolvable) {
    blockedReasons.push('変更差分を解決できないため、ガードレール抵触の有無を判定できません');
  }
  for (const guardrail of GUARDRAIL_PATHS) {
    if (changed.paths.some(guardrail.test)) blockedReasons.push(guardrail.reason);
  }
  return { signalResolved: true, requested: true, exempt: blockedReasons.length === 0, blockedReasons };
}

/** quick 適用対象外になった理由を利用者へ提示する固定書式のメッセージ。 */
export function quickBlockedNotice(decision: QuickModeDecision): string {
  return [
    'quick（size:quick）が指定されていますが、次の理由により quick 適用対象外のため通常の成果物要求を適用します:',
    ...decision.blockedReasons.map((reason) => `  - ${reason}`),
  ].join('\n');
}

/** quick シグナル未解決時に、免除と閉包追加の双方を抑止したことを示す固定書式。 */
export function quickUnresolvedNotice(): string {
  return 'quick シグナルを解決できなかったため、quick 免除も上流セグメントの閉包追加も適用しません';
}
