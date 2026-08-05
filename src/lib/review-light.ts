import { gh } from './exec.js';
import { reviewFilePath, stateFilePath, type CoordinationBackend } from './local-state.js';
import { classifyCoreReview, type CoreReviewDecision } from './model-selection.js';
import { resolveReviewProfile, type ReviewAutonomy, type ReviewRisk } from './review-profile.js';
import { changedPaths, selfReferenceGuardrailReasons } from './self-reference-guardrail.js';
import { tryReadYamlFile } from './yaml-io.js';

export const LIGHT_REVIEW_LABEL = 'review:light';
export const LIGHT_REVIEW_MAX_REMEDIATION_ROUNDS = 1;

export interface LightReviewDecision {
  requested: boolean;
  applied: boolean;
  disabled_reasons: string[];
  remediation_round: number;
  strict_locked: boolean;
}

interface ReviewSignal {
  requested: boolean;
  risk: ReviewRisk;
  autonomy: ReviewAutonomy;
  reviewSubject: 'ordinary' | 'core_audit';
}

interface PreviousGateReport {
  gate?: {
    light_review?: {
      remediation_round?: unknown;
      strict_locked?: unknown;
    };
  };
}

interface GithubLabelsPayload {
  labels?: ({ name?: string } | string)[];
}

interface LocalReviewState {
  review_intensity?: unknown;
  risk?: unknown;
  autonomy?: unknown;
  review_subject?: unknown;
}

interface GithubIssueEvent {
  event?: unknown;
  created_at?: unknown;
  label?: { name?: unknown };
  actor?: { type?: unknown };
}

function riskFromLabels(labels: readonly string[]): ReviewRisk {
  if (labels.includes('risk:high')) return 'high';
  if (labels.includes('risk:normal')) return 'normal';
  return 'unclassified';
}

function readGithubSignal(root: string, issueNumber: string): ReviewSignal {
  const view = gh(['issue', 'view', issueNumber, '--json', 'labels'], root);
  if (view.status !== 0) {
    return { requested: false, risk: 'unclassified', autonomy: 'gated', reviewSubject: 'ordinary' };
  }
  try {
    const payload = JSON.parse(view.stdout) as GithubLabelsPayload;
    const labels = (payload.labels ?? [])
      .map((label) => (typeof label === 'string' ? label : label.name))
      .filter((label): label is string => typeof label === 'string');
    return {
      requested: labels.includes(LIGHT_REVIEW_LABEL),
      risk: riskFromLabels(labels),
      autonomy: labels.includes('autonomy:full') ? 'full' : 'gated',
      reviewSubject: labels.includes('review:core-audit') ? 'core_audit' : 'ordinary',
    };
  } catch {
    return { requested: false, risk: 'unclassified', autonomy: 'gated', reviewSubject: 'ordinary' };
  }
}

function readLocalSignal(root: string, issueNumber: string): ReviewSignal {
  const state = tryReadYamlFile<LocalReviewState>(stateFilePath(root, issueNumber));
  const risk: ReviewRisk =
    state?.risk === 'normal' || state?.risk === 'high' || state?.risk === 'unclassified'
      ? state.risk
      : 'unclassified';
  return {
    requested: state?.review_intensity === 'light',
    risk,
    autonomy: state?.autonomy === 'full' ? 'full' : 'gated',
    reviewSubject: state?.review_subject === 'core_audit' ? 'core_audit' : 'ordinary',
  };
}

function flattenEvents(value: unknown): GithubIssueEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (Array.isArray(entry) ? flattenEvents(entry) : [entry as GithubIssueEvent]));
}

/** review:light の直近 labeled event が GitHub User によるものかを安全側に検証する。 */
export function verifyGrantorIsHuman(
  root: string,
  issueNumber: string,
  backend: CoordinationBackend,
): boolean {
  if (backend === 'local') return false;
  const response = gh(
    ['api', `repos/{owner}/{repo}/issues/${issueNumber}/events`, '--paginate', '--slurp'],
    root,
  );
  if (response.status !== 0) return false;
  try {
    const events = flattenEvents(JSON.parse(response.stdout)).filter(
      (event) => event.event === 'labeled' && event.label?.name === LIGHT_REVIEW_LABEL,
    );
    if (
      events.length === 0 ||
      events.some((event) => typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at)))
    ) {
      return false;
    }
    events.sort((left, right) => Date.parse(left.created_at as string) - Date.parse(right.created_at as string));
    return events.at(-1)?.actor?.type === 'User';
  } catch {
    return false;
  }
}

function previousLightReview(
  root: string,
  issueNumber: string,
  gateId: string,
  backend: CoordinationBackend,
): { remediationRound: number; strictLocked: boolean } {
  const previous = tryReadYamlFile<PreviousGateReport>(reviewFilePath(root, issueNumber, gateId, backend));
  const light = previous?.gate?.light_review;
  const remediationRound =
    typeof light?.remediation_round === 'number' && Number.isInteger(light.remediation_round) && light.remediation_round >= 0
      ? light.remediation_round + 1
      : 0;
  return { remediationRound, strictLocked: light?.strict_locked === true };
}

function coreReviewReason(decision: CoreReviewDecision): string {
  if (decision.status === 'unresolved') return 'core_reviewガードレールを解決できないためStrictです';
  if (decision.reason === 'explicit_core_audit') return 'core_reviewの明示監査シグナルに該当します';
  return '変更差分がcore_reviewの対象パスに該当します';
}

export interface ResolveLightReviewOptions {
  root: string;
  worktreePath: string;
  issueNumber: string;
  gateId: string;
  backend: CoordinationBackend;
  targetSha: string;
  baseRef?: string;
  /** evidence検証では既存scaffoldを当該ラウンドとして再評価し、roundを進めない。 */
  advanceRemediationRound?: boolean;
}

/** 軽量シグナル、3層ガードレール、人間付与確認、一方向ラチェットを合成する。 */
export function resolveLightReview(options: ResolveLightReviewOptions): LightReviewDecision {
  const previous = previousLightReview(options.root, options.issueNumber, options.gateId, options.backend);
  const remediationRound = options.advanceRemediationRound === false
    ? Math.max(0, previous.remediationRound - 1)
    : previous.remediationRound;
  const signal =
    options.backend === 'github'
      ? readGithubSignal(options.root, options.issueNumber)
      : readLocalSignal(options.root, options.issueNumber);

  if (!signal.requested) {
    return {
      requested: false,
      applied: false,
      disabled_reasons: previous.strictLocked ? ['過去のラウンドで軽量プロファイルがStrictへ確定済みのため'] : [],
      remediation_round: remediationRound,
      strict_locked: previous.strictLocked,
    };
  }

  const disabledReasons: string[] = [];
  const existingProfile = resolveReviewProfile(signal.risk, signal.autonomy);
  if (existingProfile === 'strict') {
    disabledReasons.push(`I8ガードレールに該当します（risk: ${signal.risk}, autonomy: ${signal.autonomy}）`);
  }

  const coreReview = classifyCoreReview(options.worktreePath, {
    targetSha: options.targetSha,
    baseRef: options.baseRef,
    reviewSubject: signal.reviewSubject,
  });
  if (coreReview.required) disabledReasons.push(coreReviewReason(coreReview));

  const changed = changedPaths(options.worktreePath, options.targetSha);
  if (!changed.resolvable) {
    disabledReasons.push('変更差分を解決できないため、自己参照ガードレールを判定できません');
  } else {
    disabledReasons.push(...selfReferenceGuardrailReasons(changed.paths));
  }

  const rawStrict = disabledReasons.length > 0;
  const strictLocked = previous.strictLocked || rawStrict;
  if (previous.strictLocked && !rawStrict) {
    disabledReasons.push('過去のラウンドで軽量プロファイルがStrictへ確定済みのため');
  }

  const grantorConfirmed = verifyGrantorIsHuman(options.root, options.issueNumber, options.backend);
  if (!strictLocked && !grantorConfirmed) {
    disabledReasons.push('軽量シグナルの付与主体を人間と確認できませんでした');
  }

  return {
    requested: true,
    applied: !strictLocked && grantorConfirmed,
    disabled_reasons: disabledReasons,
    remediation_round: remediationRound,
    strict_locked: strictLocked,
  };
}
