import { gh } from './exec.js';
import { stateFilePath, type CoordinationBackend } from './local-state.js';
import fs from 'node:fs';
import { readYamlFile } from './yaml-io.js';
import { changedPaths, GUARDRAIL_PATHS } from './self-reference-guardrail.js';

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

interface SizeSignal {
  size: IssueSize;
  risk: IssueRisk;
}

interface SignalResolution {
  resolved: boolean;
  signal?: SizeSignal;
}

/** ラベル名の集合から risk を解決する。`risk:normal` が明示されている場合のみ normal。 */
function riskFromLabels(names: string[]): IssueRisk {
  if (names.includes('risk:high')) return 'high';
  if (names.includes('risk:normal')) return 'normal';
  // ラベル未付与は「リスク未分類」が既定値（安全側）。
  return 'unclassified';
}

interface GhLabelsPayload {
  labels: ({ name: string } | string)[];
}

function readSignalFromGitHub(root: string, issueNumber: string): SignalResolution {
  const view = gh([`issue`, 'view', issueNumber, '--json', 'labels'], root);
  if (view.status !== 0) return { resolved: false };
  let payload: unknown;
  try {
    payload = JSON.parse(view.stdout);
  } catch {
    return { resolved: false };
  }
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as Partial<GhLabelsPayload>).labels)) {
    return { resolved: false };
  }
  const labels = (payload as GhLabelsPayload).labels;
  const names: string[] = [];
  for (const label of labels) {
    if (typeof label === 'string') {
      names.push(label);
    } else if (typeof label === 'object' && label !== null && typeof label.name === 'string') {
      names.push(label.name);
    } else {
      return { resolved: false };
    }
  }
  return {
    resolved: true,
    signal: { size: names.includes(QUICK_SIZE_LABEL) ? 'quick' : 'standard', risk: riskFromLabels(names) },
  };
}

interface LocalStateSizeFields {
  size?: string;
  risk?: string;
}

function readSignalFromLocalState(root: string, issueNumber: string): SignalResolution {
  const filePath = stateFilePath(root, issueNumber);
  if (!fs.existsSync(filePath)) return { resolved: false };
  let state: unknown;
  try {
    state = readYamlFile<unknown>(filePath);
  } catch {
    return { resolved: false };
  }
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return { resolved: false };
  const fields = state as LocalStateSizeFields;
  if (fields.size !== undefined && fields.size !== 'quick' && fields.size !== 'standard') return { resolved: false };
  if (
    fields.risk !== undefined &&
    fields.risk !== 'normal' &&
    fields.risk !== 'high' &&
    fields.risk !== 'unclassified'
  ) {
    return { resolved: false };
  }
  const risk: IssueRisk =
    fields.risk === 'normal' || fields.risk === 'high' || fields.risk === 'unclassified' ? fields.risk : 'unclassified';
  return { resolved: true, signal: { size: fields.size === 'quick' ? 'quick' : 'standard', risk } };
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
  const resolution =
    backend === 'github' ? readSignalFromGitHub(root, issueNumber) : readSignalFromLocalState(root, issueNumber);
  if (!resolution.resolved || !resolution.signal) {
    return { signalResolved: false, requested: false, exempt: false, blockedReasons: [] };
  }
  const signal = resolution.signal;
  if (signal.size !== 'quick') return { signalResolved: true, requested: false, exempt: false, blockedReasons: [] };

  const blockedReasons: string[] = [];
  if (signal.risk !== 'normal') {
    blockedReasons.push(`risk が normal ではありません（現在: ${signal.risk}）。quick は risk が normal の場合のみ適用できます`);
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
