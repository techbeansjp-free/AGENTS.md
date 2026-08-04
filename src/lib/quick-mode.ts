import { git, gh } from './exec.js';
import { defaultBranch } from './worktree.js';
import { stateFilePath, type CoordinationBackend } from './local-state.js';
import { tryReadYamlFile } from './yaml-io.js';

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

/**
 * quick を取り消すガードレール対象パス。いずれかが変更差分に含まれる場合、quick が
 * 指定されていても免除を適用しない。
 *
 * - `docs/adr/`: ADR を要する判断は「詳細に設計するほどでもない変更」ではない。
 * - `.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/`:
 *   免除の判定規則自体を定める資産であり、quick で自身の規律を緩める自己参照的な悪用を防ぐ。
 */
const GUARDRAIL_PATHS: { test: (p: string) => boolean; reason: string }[] = [
  { test: (p) => p.startsWith('docs/adr/'), reason: '変更差分に docs/adr/ 配下（ADRを要する変更）が含まれます' },
  {
    test: (p) => p === '.agent-skill-chain/config/segments.yaml',
    reason: '変更差分に .agent-skill-chain/config/segments.yaml（セグメント定義）が含まれます',
  },
  { test: (p) => p === 'AGENTS.md', reason: '変更差分に AGENTS.md（不変条件の正本）が含まれます' },
  {
    test: (p) => p.startsWith('.agent-skill-chain/schemas/'),
    reason: '変更差分に .agent-skill-chain/schemas/ 配下（スキーマ定義）が含まれます',
  },
];

export type IssueSize = 'quick' | 'standard';
export type IssueRisk = 'unclassified' | 'normal' | 'high';

export interface QuickModeDecision {
  /** quick シグナル（ラベルまたは state.yaml）が読み取れたか。 */
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

/** ラベル名の集合から risk を解決する。`risk:normal` が明示されている場合のみ normal。 */
function riskFromLabels(names: string[]): IssueRisk {
  if (names.includes('risk:high')) return 'high';
  if (names.includes('risk:normal')) return 'normal';
  // ラベル未付与は「リスク未分類」が既定値（安全側）。
  return 'unclassified';
}

interface GhLabelsPayload {
  labels?: ({ name?: string } | string)[];
}

function readSignalFromGitHub(root: string, issueNumber: string): SizeSignal {
  const view = gh([`issue`, 'view', issueNumber, '--json', 'labels'], root);
  // gh 未認証・ネットワーク不通・Issue 不在などは安全側（standard）へ倒す。quick は
  // 明示的なオプトインでのみ成立し、シグナルを読めない状況で自動適用してはならない。
  if (view.status !== 0) return { size: 'standard', risk: 'unclassified' };
  let payload: GhLabelsPayload;
  try {
    payload = JSON.parse(view.stdout) as GhLabelsPayload;
  } catch {
    return { size: 'standard', risk: 'unclassified' };
  }
  const names = (payload.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((name): name is string => typeof name === 'string');
  return { size: names.includes(QUICK_SIZE_LABEL) ? 'quick' : 'standard', risk: riskFromLabels(names) };
}

interface LocalStateSizeFields {
  size?: string;
  risk?: string;
}

function readSignalFromLocalState(root: string, issueNumber: string): SizeSignal {
  const state = tryReadYamlFile<LocalStateSizeFields>(stateFilePath(root, issueNumber));
  if (!state) return { size: 'standard', risk: 'unclassified' };
  const risk: IssueRisk =
    state.risk === 'normal' || state.risk === 'high' || state.risk === 'unclassified' ? state.risk : 'unclassified';
  return { size: state.size === 'quick' ? 'quick' : 'standard', risk };
}

/** `git status --porcelain` の1行からパスを取り出す（rename は変更前後の両方を対象にする）。 */
function pathsFromPorcelainLine(line: string): string[] {
  const body = line.slice(3);
  const parts = body.includes(' -> ') ? body.split(' -> ') : [body];
  return parts.map((p) => p.trim().replace(/^"(.*)"$/, '$1')).filter((p) => p.length > 0);
}

interface ChangedPaths {
  paths: string[];
  /** 差分を機械的に解決できたか。解決不能なら quick を適用してはならない（安全側）。 */
  resolvable: boolean;
}

/**
 * base ブランチとの三点差分（当該ブランチが持ち込んだ変更）に加え、未コミットの作業ツリー変更も
 * 対象にする。commit 前の状態でも同じ判定になり、「commit しなければガードレールを回避できる」
 * 抜け道も塞げるため。
 */
function changedPaths(worktreePath: string): ChangedPaths {
  const paths: string[] = [];
  let resolvable = true;
  try {
    const base = defaultBranch(worktreePath);
    const diff = git(['diff', '--name-only', `${base}...HEAD`], worktreePath);
    if (diff.status !== 0) {
      resolvable = false;
    } else {
      paths.push(...diff.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
    }
  } catch {
    resolvable = false;
  }
  const status = git(['status', '--porcelain', '--untracked-files=all'], worktreePath);
  if (status.status !== 0) {
    resolvable = false;
  } else {
    for (const line of status.stdout.split('\n')) {
      if (line.trim().length === 0) continue;
      paths.push(...pathsFromPorcelainLine(line));
    }
  }
  return { paths, resolvable };
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
  const signal = backend === 'github' ? readSignalFromGitHub(root, issueNumber) : readSignalFromLocalState(root, issueNumber);
  if (signal.size !== 'quick') return { requested: false, exempt: false, blockedReasons: [] };

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
  return { requested: true, exempt: blockedReasons.length === 0, blockedReasons };
}

/** quick 適用対象外になった理由を利用者へ提示する固定書式のメッセージ。 */
export function quickBlockedNotice(decision: QuickModeDecision): string {
  return [
    'quick（size:quick）が指定されていますが、次の理由により quick 適用対象外のため通常の成果物要求を適用します:',
    ...decision.blockedReasons.map((reason) => `  - ${reason}`),
  ].join('\n');
}
