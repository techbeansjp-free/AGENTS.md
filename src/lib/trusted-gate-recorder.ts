import fs from 'node:fs';
import path from 'node:path';
import { digestOf } from './digest.js';
import { canonicalJson, type GithubReviewRecord, type VerifiedReviewAttempt } from './review-evidence.js';
import { createInstallationToken, type GithubAppCredentials } from './github-app-auth.js';
import {
  INLINE_REPORT_MAX_BYTES,
  decodeGateCheckExternalId,
  encodeGateCheckExternalId,
  selectLatestWorkflowAttempt,
  type GateAttestationEnvelope,
  type GateCheckExternalId,
  type WorkflowAttemptRef,
} from './gate-provenance.js';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
export const TRUSTED_GATE_WORKFLOW_PATH = '.github/workflows/agent-skill-chain-trusted-gate.yml';
export const TRUSTED_GATE_WORKFLOW_REF = 'refs/heads/main';
export const TRUSTED_GATE_EVENT = 'agent-skill-chain-gate-record';
const MAX_CHECK_OUTPUT_BYTES = 65_535;
const GATE_VALUES = ['spec', 'design', 'implementation', 'validation'] as const;

export type TrustedGateId = (typeof GATE_VALUES)[number];

export interface TrustedGatePayload {
  pr_number: number;
  gate: TrustedGateId;
  target_sha: string;
}

export interface TrustedGateWorkflow {
  path: typeof TRUSTED_GATE_WORKFLOW_PATH;
  ref: typeof TRUSTED_GATE_WORKFLOW_REF;
  sha: string;
  run_id: number;
  run_number: number;
  run_attempt: number;
}

// #274のinline-only envelopeは#283のstorage manifest追加前のexact field集合。
// workflow/check/report provenanceの型は共有coreを正本とし、chunk fieldだけを段階導入まで除外する。
export type TrustedGateAttestationEnvelope = Omit<GateAttestationEnvelope, 'storage_manifest_digest'>;

export interface TrustedGateCheckOutput {
  schema_version: 'agent-skill-chain/check-output/v1';
  report: unknown;
  attestation: TrustedGateAttestationEnvelope;
}

export type TrustedGateExternalId = GateCheckExternalId;

export interface TrustedGateRepository {
  id: number;
  full_name: string;
  default_branch: string;
}

export interface TrustedGatePullRequest {
  number: number;
  state: string;
  user: { login: string | null } | null;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
}

export interface TrustedGateIssue {
  number: number;
  state: string;
  labels: ({ name?: string } | string)[];
}

export interface TrustedGateApiContext {
  actor: string;
  payload: TrustedGatePayload;
  repository: TrustedGateRepository;
  pullRequest: TrustedGatePullRequest;
  issue: TrustedGateIssue;
  issueId: string;
  issueNumber: number;
  profile: 'standard' | 'strict';
  reviewSubject: 'ordinary' | 'core_audit';
  commits: { author: { login: string | null } | null; committer: { login: string | null } | null }[];
  reviews: GithubReviewRecord[];
}

export interface TrustedGateCheckRun {
  id: number;
  name: string;
  head_sha: string;
  external_id: string;
  status: string;
  conclusion: string | null;
  app: {
    id: number;
    name: string;
    slug?: string;
  };
  output?: {
    text?: string | null;
  };
}

export interface TrustedGateActionRun {
  id: number;
  run_number: number;
  run_attempt: number;
  path: string;
  head_sha: string;
  head_branch: string;
  event: string;
  display_title: string;
  status: string;
  conclusion: string | null;
}

export interface TrustedGateRecordState {
  schema_version: 'agent-skill-chain/trusted-gate-record-state/v1';
  actor: string;
  payload: TrustedGatePayload;
  issue_id: string;
  profile: 'standard' | 'strict';
  review_subject: 'ordinary' | 'core_audit';
  base_sha: string;
  workflow: TrustedGateWorkflow;
  check: TrustedGateCheckRun;
  report: unknown;
  report_oversize: boolean;
  attestation: TrustedGateAttestationEnvelope;
}

function safeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}は正の安全な整数である必要があります`);
  return parsed;
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}の許可フィールドは${expected.join(',')}だけです`);
  }
}

export function parseTrustedGateDispatchEvent(value: unknown): { actor: string; payload: TrustedGatePayload } {
  if (!value || typeof value !== 'object') throw new Error('repository_dispatch eventを解釈できません');
  const event = value as {
    action?: unknown;
    sender?: { login?: unknown };
    client_payload?: unknown;
  };
  if (event.action !== TRUSTED_GATE_EVENT) throw new Error(`dispatch typeは${TRUSTED_GATE_EVENT}だけです`);
  if (!event.sender || typeof event.sender.login !== 'string' || !/^[A-Za-z0-9-]+$/.test(event.sender.login)) {
    throw new Error('dispatch actorを解決できません');
  }
  if (!event.client_payload || typeof event.client_payload !== 'object' || Array.isArray(event.client_payload)) {
    throw new Error('client_payloadを解釈できません');
  }
  exactKeys(event.client_payload, ['pr_number', 'gate', 'target_sha'], 'client_payload');
  const raw = event.client_payload as Record<string, unknown>;
  if (typeof raw.pr_number !== 'number' || !Number.isSafeInteger(raw.pr_number) || raw.pr_number <= 0) {
    throw new Error('client_payload.pr_numberは正のintegerである必要があります');
  }
  if (typeof raw.gate !== 'string' || !GATE_VALUES.includes(raw.gate as TrustedGateId)) {
    throw new Error('client_payload.gateが許可enumではありません');
  }
  if (typeof raw.target_sha !== 'string' || !/^[0-9a-f]{40}$/.test(raw.target_sha)) {
    throw new Error('client_payload.target_shaは40桁lowercase hexである必要があります');
  }
  return {
    actor: event.sender.login,
    payload: {
      pr_number: raw.pr_number,
      gate: raw.gate as TrustedGateId,
      target_sha: raw.target_sha,
    },
  };
}

export function parseTrustedGateWorkflow(env: NodeJS.ProcessEnv): TrustedGateWorkflow {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORYを解決できません');
  }
  const expectedWorkflowRef = `${repository}/${TRUSTED_GATE_WORKFLOW_PATH}@${TRUSTED_GATE_WORKFLOW_REF}`;
  if (env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef || env.GITHUB_REF !== TRUSTED_GATE_WORKFLOW_REF) {
    throw new Error('trusted gate workflowがrefs/heads/mainの固定pathから実行されていません');
  }
  const sha = env.GITHUB_WORKFLOW_SHA;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('GITHUB_WORKFLOW_SHAが40桁SHAではありません');
  if (env.GITHUB_SHA !== sha) throw new Error('workflow source SHAとrepository_dispatch SHAが一致しません');
  return {
    path: TRUSTED_GATE_WORKFLOW_PATH,
    ref: TRUSTED_GATE_WORKFLOW_REF,
    sha,
    run_id: safeInteger(env.GITHUB_RUN_ID, 'GITHUB_RUN_ID'),
    run_number: safeInteger(env.GITHUB_RUN_NUMBER, 'GITHUB_RUN_NUMBER'),
    run_attempt: safeInteger(env.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT'),
  };
}

export function trustedGateRunName(payload: TrustedGatePayload): string {
  return `gate-record-${payload.pr_number}-${payload.gate}-${payload.target_sha}`;
}

function issueLabels(issue: TrustedGateIssue): string[] {
  return issue.labels.map((label) => typeof label === 'string' ? label : label.name ?? '').filter(Boolean);
}

function issueNumberFromBranch(ref: string): number {
  const match = /^[^/]+\/([1-9][0-9]*)-[a-z0-9][a-z0-9-]*$/.exec(ref);
  if (!match) throw new Error('PR head branchからIssue番号を解決できません');
  return safeInteger(match[1], 'Issue番号');
}

async function githubResponse(
  fetchImpl: typeof fetch,
  token: string,
  apiPath: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetchImpl(`${GITHUB_API}${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${apiPath} がHTTP ${response.status}で失敗しました`);
  return response;
}

export async function githubJsonDirect<T>(
  fetchImpl: typeof fetch,
  token: string,
  apiPath: string,
  init: RequestInit = {},
): Promise<T> {
  return (await (await githubResponse(fetchImpl, token, apiPath, init)).json()) as T;
}

async function githubArrayDirect<T>(
  fetchImpl: typeof fetch,
  token: string,
  apiPath: string,
): Promise<T[]> {
  const separator = apiPath.includes('?') ? '&' : '?';
  const all: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await githubJsonDirect<T[]>(
      fetchImpl,
      token,
      `${apiPath}${separator}per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch)) throw new Error(`GitHub API ${apiPath} の一覧応答が配列ではありません`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error(`GitHub API ${apiPath} のpagination上限を超えました`);
}

export async function fetchTrustedGateApiContext(options: {
  actor: string;
  payload: TrustedGatePayload;
  repository: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<TrustedGateApiContext> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const repoPath = `/repos/${options.repository}`;
  const [repository, permission, pullRequest] = await Promise.all([
    githubJsonDirect<TrustedGateRepository>(fetchImpl, options.githubToken, repoPath),
    githubJsonDirect<{ permission?: string }>(
      fetchImpl,
      options.githubToken,
      `${repoPath}/collaborators/${encodeURIComponent(options.actor)}/permission`,
    ),
    githubJsonDirect<TrustedGatePullRequest>(
      fetchImpl,
      options.githubToken,
      `${repoPath}/pulls/${options.payload.pr_number}`,
    ),
  ]);
  if (
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    repository.full_name !== options.repository ||
    repository.default_branch !== 'main'
  ) {
    throw new Error('repository API正本がmain固定workflowと一致しません');
  }
  if (!['write', 'maintain', 'admin'].includes(permission.permission ?? '')) {
    throw new Error('dispatch actorにwrite以上のrepository permissionがありません');
  }
  if (
    pullRequest.number !== options.payload.pr_number ||
    pullRequest.state !== 'open' ||
    pullRequest.head?.sha !== options.payload.target_sha ||
    pullRequest.base?.ref !== repository.default_branch ||
    !/^[0-9a-f]{40}$/.test(pullRequest.base?.sha ?? '')
  ) {
    throw new Error('PRのcurrent headまたはrepository default baseがdispatch入力と一致しません');
  }
  const issueNumber = issueNumberFromBranch(pullRequest.head.ref);
  const [issue, commits, reviews] = await Promise.all([
    githubJsonDirect<TrustedGateIssue>(fetchImpl, options.githubToken, `${repoPath}/issues/${issueNumber}`),
    githubArrayDirect<TrustedGateApiContext['commits'][number]>(
      fetchImpl,
      options.githubToken,
      `${repoPath}/pulls/${options.payload.pr_number}/commits`,
    ),
    githubArrayDirect<GithubReviewRecord>(
      fetchImpl,
      options.githubToken,
      `${repoPath}/pulls/${options.payload.pr_number}/reviews`,
    ),
  ]);
  if (issue.number !== issueNumber || issue.state !== 'open' || !Array.isArray(issue.labels)) {
    throw new Error('Issue API正本を解決できません');
  }
  const labels = issueLabels(issue);
  const profile = !labels.includes('risk:normal') || labels.includes('autonomy:full') ? 'strict' : 'standard';
  return {
    actor: options.actor,
    payload: options.payload,
    repository,
    pullRequest,
    issue,
    issueId: `ISSUE-${issueNumber}`,
    issueNumber,
    profile,
    reviewSubject: labels.includes('review:core-audit') ? 'core_audit' : 'ordinary',
    commits,
    reviews,
  };
}

export function trustedGateExternalId(
  workflow: TrustedGateWorkflow,
  payload: TrustedGatePayload,
): TrustedGateExternalId {
  return {
    workflowRunId: workflow.run_id,
    runNumber: workflow.run_number,
    runAttempt: workflow.run_attempt,
    prNumber: payload.pr_number,
    gate: payload.gate,
    targetSha: payload.target_sha,
  };
}

export function parseTrustedGateExternalId(value: string): TrustedGateExternalId {
  return decodeGateCheckExternalId(value);
}

function checkConclusion(final: unknown): 'success' | 'failure' | 'action_required' {
  if (final === 'approved') return 'success';
  if (final === 'rejected') return 'failure';
  return 'action_required';
}

export function buildTrustedGateAttestation(options: {
  repository: TrustedGateRepository;
  payload: TrustedGatePayload;
  workflow: TrustedGateWorkflow;
  check: Pick<TrustedGateCheckRun, 'id' | 'name' | 'app'>;
  report: { gate?: { review_attempt?: VerifiedReviewAttempt } };
}): TrustedGateAttestationEnvelope {
  const reviewAttempt = options.report.gate?.review_attempt;
  if (!reviewAttempt) throw new Error('verified gate reportにreview_attemptがありません');
  return {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: {
      full_name: options.repository.full_name,
      id: options.repository.id,
    },
    pr_number: options.payload.pr_number,
    target_sha: options.payload.target_sha,
    gate: options.payload.gate,
    review_attempt: reviewAttempt,
    workflow: options.workflow,
    check: {
      id: options.check.id,
      name: options.check.name,
      app_id: options.check.app.id,
    },
    report_digest: digestOf(canonicalJson(options.report)),
  };
}

export function buildTrustedGateCheckOutput(
  report: unknown,
  attestation: TrustedGateAttestationEnvelope,
): TrustedGateCheckOutput {
  return {
    schema_version: 'agent-skill-chain/check-output/v1',
    report,
    attestation,
  };
}

export function assertTrustedAppCheck(options: {
  check: TrustedGateCheckRun;
  expectedAppId: number;
  expectedName: string;
  expectedSha: string;
  expectedExternalId: TrustedGateExternalId;
  expectedStatus?: 'queued' | 'in_progress' | 'completed';
}): void {
  const check = options.check;
  if (
    !Number.isSafeInteger(check.id) ||
    check.id <= 0 ||
    check.app?.id !== options.expectedAppId ||
    typeof check.app.name !== 'string' ||
    check.app.name.length === 0 ||
    check.app.name === 'GitHub Actions' ||
    check.app.slug === 'github-actions' ||
    check.name !== options.expectedName ||
    check.head_sha !== options.expectedSha ||
    check.external_id !== encodeGateCheckExternalId(options.expectedExternalId) ||
    (options.expectedStatus && check.status !== options.expectedStatus)
  ) {
    throw new Error('Check Runの専用App identity/name/SHA/external workflow tupleが一致しません');
  }
}

async function appCheckRequest<T>(options: {
  repository: string;
  repositoryId: number;
  credentials: GithubAppCredentials;
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const installation = await createInstallationToken({
    ...options.credentials,
    repository: options.repository,
    repositoryId: options.repositoryId,
    fetchImpl,
  });
  return githubJsonDirect<T>(fetchImpl, installation.token, options.path, {
    method: options.method,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body), headers: { 'Content-Type': 'application/json' } }),
  });
}

export async function createTrustedGateCheck(options: {
  repository: string;
  repositoryId: number;
  credentials: GithubAppCredentials;
  checkName: string;
  payload: TrustedGatePayload;
  workflow: TrustedGateWorkflow;
  fetchImpl?: typeof fetch;
}): Promise<TrustedGateCheckRun> {
  const externalId = trustedGateExternalId(options.workflow, options.payload);
  const check = await appCheckRequest<TrustedGateCheckRun>({
    repository: options.repository,
    repositoryId: options.repositoryId,
    credentials: options.credentials,
    path: `/repos/${options.repository}/check-runs`,
    method: 'POST',
    body: {
      name: options.checkName,
      head_sha: options.payload.target_sha,
      status: 'in_progress',
      external_id: encodeGateCheckExternalId(externalId),
      output: {
        title: `${options.payload.gate} gate: recording`,
        summary: 'Dedicated GitHub App is verifying protected-base review evidence and attestation.',
      },
    },
    fetchImpl: options.fetchImpl,
  });
  assertTrustedAppCheck({
    check,
    expectedAppId: safeInteger(options.credentials.appId, 'GitHub App ID'),
    expectedName: options.checkName,
    expectedSha: options.payload.target_sha,
    expectedExternalId: externalId,
    expectedStatus: 'in_progress',
  });
  return check;
}

export async function readTrustedGateCheck(options: {
  repository: string;
  repositoryId: number;
  credentials: GithubAppCredentials;
  checkId: number;
  fetchImpl?: typeof fetch;
}): Promise<TrustedGateCheckRun> {
  return appCheckRequest<TrustedGateCheckRun>({
    repository: options.repository,
    repositoryId: options.repositoryId,
    credentials: options.credentials,
    path: `/repos/${options.repository}/check-runs/${safeInteger(options.checkId, 'Check ID')}`,
    method: 'GET',
    fetchImpl: options.fetchImpl,
  });
}

/**
 * 呼出し側はこのPromiseの後にAPI、filesystem、subprocessのpostconditionを置いてはならない。
 * App PATCH応答のHTTP成功確認だけを行い、completed Checkの再取得はしない。
 */
export async function finalizeTrustedGateCheck(options: {
  repository: string;
  repositoryId: number;
  credentials: GithubAppCredentials;
  checkId: number;
  report: { gate?: { final?: unknown; blockers?: unknown[] } };
  attestation: TrustedGateAttestationEnvelope;
  reportOversize: boolean;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fullOutput = canonicalJson(buildTrustedGateCheckOutput(options.report, options.attestation));
  const outputOversize = Buffer.byteLength(fullOutput, 'utf8') > MAX_CHECK_OUTPUT_BYTES;
  const durableText =
    options.reportOversize || outputOversize
      ? canonicalJson({
          schema_version: 'agent-skill-chain/check-output-error/v1',
          attestation: options.attestation,
          reason: options.reportOversize ? 'report_exceeds_48kib' : 'check_output_exceeds_github_limit',
        })
      : fullOutput;
  if (Buffer.byteLength(durableText, 'utf8') > MAX_CHECK_OUTPUT_BYTES) {
    throw new Error('action_required error envelopeもGitHub Check output上限を超えています');
  }
  const conclusion =
    options.reportOversize || outputOversize
      ? 'action_required'
      : checkConclusion(options.report.gate?.final);
  const blockers = Array.isArray(options.report.gate?.blockers) ? options.report.gate.blockers : [];
  await appCheckRequest<unknown>({
    repository: options.repository,
    repositoryId: options.repositoryId,
    credentials: options.credentials,
    path: `/repos/${options.repository}/check-runs/${safeInteger(options.checkId, 'Check ID')}`,
    method: 'PATCH',
    body: {
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: options.reportOversize || outputOversize
          ? `${options.attestation.gate} gate: durable output exceeds limit`
          : `${options.attestation.gate} gate: ${String(options.report.gate?.final ?? 'human_required')}`,
        summary: options.reportOversize || outputOversize
          ? 'Canonical gate output exceeds the trusted recorder limit; merge remains blocked.'
          : `blocker_count=${blockers.length}; blocker_digest=${digestOf(canonicalJson(blockers))}`,
        text: durableText,
      },
    },
    fetchImpl: options.fetchImpl,
  });
}

export function writeTrustedGateRecordState(
  statePath: string,
  envelopePath: string,
  state: TrustedGateRecordState,
): void {
  const resolvedState = path.resolve(statePath);
  const resolvedEnvelope = path.resolve(envelopePath);
  fs.mkdirSync(path.dirname(resolvedState), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedEnvelope), { recursive: true });
  fs.writeFileSync(resolvedState, `${canonicalJson(state)}\n`, { mode: 0o600 });
  fs.chmodSync(resolvedState, 0o600);
  fs.writeFileSync(resolvedEnvelope, `${canonicalJson(state.attestation)}\n`, { mode: 0o600 });
  fs.chmodSync(resolvedEnvelope, 0o600);
}

export function readTrustedGateRecordState(statePath: string): TrustedGateRecordState {
  const stat = fs.lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('trusted gate state fileのmodeまたは種別が不正です');
  }
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as TrustedGateRecordState;
  if (parsed.schema_version !== 'agent-skill-chain/trusted-gate-record-state/v1') {
    throw new Error('trusted gate state fileのschemaが不正です');
  }
  return parsed;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, output));
  else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => collectStrings(entry, output));
  }
  return output;
}

export function assertTrustedGateAttestationVerification(options: {
  verification: unknown;
  envelopeBytes: string | Buffer;
  envelope: TrustedGateAttestationEnvelope;
}): void {
  if (!Array.isArray(options.verification) || options.verification.length !== 1) {
    throw new Error('verified attestationはexactly oneである必要があります');
  }
  const result = options.verification[0] as {
    verificationResult?: {
      signature?: { certificate?: unknown };
      statement?: { subject?: { digest?: { sha256?: string } }[] };
    };
  };
  const verificationResult = result.verificationResult;
  const certificate = verificationResult?.signature?.certificate;
  const subjects = verificationResult?.statement?.subject;
  const digest = digestOf(options.envelopeBytes).slice('sha256:'.length);
  if (
    !certificate ||
    !Array.isArray(subjects) ||
    !subjects.some((subject) => subject.digest?.sha256 === digest)
  ) {
    throw new Error('attestation subject digestがenvelope bytesと一致しません');
  }
  const invocation = `https://github.com/${options.envelope.repository.full_name}/actions/runs/${options.envelope.workflow.run_id}/attempts/${options.envelope.workflow.run_attempt}`;
  if (!collectStrings(certificate).includes(invocation)) {
    throw new Error('attestation certificateのworkflow run/attemptがenvelopeと一致しません');
  }
}

export function parseTrustedGateCheckOutput(text: string): TrustedGateCheckOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Check output envelopeを解釈できません');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Check output envelopeがobjectではありません');
  }
  exactKeys(parsed, ['schema_version', 'report', 'attestation'], 'Check output envelope');
  const output = parsed as TrustedGateCheckOutput;
  if (
    output.schema_version !== 'agent-skill-chain/check-output/v1' ||
    text !== canonicalJson(output)
  ) {
    throw new Error('Check output envelopeがcheck-output/v1 canonical JSONではありません');
  }
  return output;
}

export function selectLatestTrustedGateCheck(options: {
  actionRuns: TrustedGateActionRun[];
  checkRuns: TrustedGateCheckRun[];
  payload: TrustedGatePayload;
  workflowSha?: string;
  expectedAppId: number;
  expectedCheckName: string;
}): { actionRun: TrustedGateActionRun; checkRun: TrustedGateCheckRun; externalId: TrustedGateExternalId } {
  const expectedTitle = trustedGateRunName(options.payload);
  const actionCandidates = options.actionRuns.filter(
    (run) =>
      run.path === TRUSTED_GATE_WORKFLOW_PATH &&
      run.head_branch === 'main' &&
      run.event === 'repository_dispatch' &&
      run.display_title === expectedTitle &&
      (!options.workflowSha || run.head_sha === options.workflowSha) &&
      Number.isSafeInteger(run.run_number) &&
      Number.isSafeInteger(run.run_attempt),
  );
  if (actionCandidates.length === 0) throw new Error('対象payloadのtrusted recorder Actions runがありません');
  const asAttempts = actionCandidates.map((run): WorkflowAttemptRef => ({
    runId: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    workflowPath: run.path,
    event: 'repository_dispatch',
    status: run.status,
    conclusion: run.conclusion,
  }));
  const latestAttempt = selectLatestWorkflowAttempt(asAttempts);
  const latestMatches = actionCandidates.filter(
    (run) =>
      run.id === latestAttempt.runId &&
      run.run_number === latestAttempt.runNumber &&
      run.run_attempt === latestAttempt.runAttempt,
  );
  if (latestMatches.length !== 1) throw new Error('latest workflow attemptを一意に解決できません');
  const latestAction = latestMatches[0];
  if (latestAction.status !== 'completed' || latestAction.conclusion !== 'success') {
    throw new Error('latest trusted recorder Actions runがcompleted successではありません');
  }
  const matches = options.checkRuns.flatMap((checkRun) => {
    let externalId: TrustedGateExternalId;
    try {
      externalId = parseTrustedGateExternalId(checkRun.external_id);
    } catch {
      return [];
    }
    if (
      externalId.workflowRunId !== latestAction.id ||
      externalId.runNumber !== latestAction.run_number ||
      externalId.runAttempt !== latestAction.run_attempt ||
      externalId.prNumber !== options.payload.pr_number ||
      externalId.gate !== options.payload.gate ||
      externalId.targetSha !== options.payload.target_sha
    ) {
      return [];
    }
    return [{ checkRun, externalId }];
  });
  if (matches.length !== 1) throw new Error('latest Actions runにexactly oneの専用App Checkが対応していません');
  const selected = matches[0];
  assertTrustedAppCheck({
    check: selected.checkRun,
    expectedAppId: options.expectedAppId,
    expectedName: options.expectedCheckName,
    expectedSha: options.payload.target_sha,
    expectedExternalId: selected.externalId,
    expectedStatus: 'completed',
  });
  if (selected.checkRun.conclusion !== 'success') {
    throw new Error('latest専用App Checkがcompleted successではありません');
  }
  return { actionRun: latestAction, ...selected };
}

export function canonicalReportIsOversize(report: unknown): boolean {
  return Buffer.byteLength(canonicalJson(report), 'utf8') > INLINE_REPORT_MAX_BYTES;
}
