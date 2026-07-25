import fs from 'node:fs';
import { digestOf } from '../lib/digest.js';
import { gh } from '../lib/exec.js';
import {
  buildBootstrapCompletedRecord,
  parseBootstrapLedgerRecord,
  renderBootstrapLedgerRecord,
  resolveBootstrapLedgerState,
  validateBootstrapLedgerRecord,
  type BootstrapLedgerEntry,
  type BootstrapPreparedRecord,
} from '../lib/bootstrap-ledger.js';
import { CliError } from '../lib/issue.js';
import { canonicalJson, parseReviewEvidence, type GithubReviewRecord } from '../lib/review-evidence.js';
import { repoRoot } from '../lib/paths.js';
import { fail, guard, isHelp, ok, printUsage } from '../lib/cli-io.js';

const USAGE = `
使い方:
  agent-skill-chain gate bootstrap-ledger prepare <prepared_record_path>
  agent-skill-chain gate bootstrap-ledger complete <prepared_record_path>

PR #274だけに許可された一回限りbootstrapをGitHub正本へ記録する。prepareはowner admin承認、
独立Sol/xhigh PASS 2本、current SHAの全非gate Check成功をAPIから再検証しPR Reviewへ記録する。
completeは同じprepared keyのPRがmerge済みの場合だけmerge SHA/timeをPR conversationへ記録する。
本コマンドはmerge操作自体を行わない。
`;

const GATE_CHECK_NAMES = new Set(
  ['spec', 'design', 'implementation', 'validation'].map((gate) => `agent-skill-chain/${gate}-gate`),
);

interface PullRequest {
  number: number;
  state: string;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string };
  base: { ref: string };
}

interface CheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
}

interface IssueComment {
  id: number;
  body: string;
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CliError(`${label}のJSONを解釈できません`);
  }
}

function api<T>(root: string, args: string[], label: string, input?: string): T {
  const result = gh(['api', ...args], root, input);
  if (result.status !== 0) throw new CliError(`${label}を取得または記録できません: ${result.stderr.trim()}`);
  return parseJson<T>(result.stdout, label);
}

function paged<T>(root: string, endpoint: string, label: string): T[] {
  const value = api<T[] | T[][]>(
    root,
    [`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100`, '--paginate', '--slurp'],
    label,
  );
  if (!Array.isArray(value)) throw new CliError(`${label}の一覧応答が配列ではありません`);
  return value.flat() as T[];
}

function readPreparedRecord(recordPath: string): BootstrapPreparedRecord {
  const stat = fs.lstatSync(recordPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError('bootstrap prepared recordが通常fileではありません');
  const text = fs.readFileSync(recordPath, 'utf8');
  const parsed = parseJson<unknown>(text, 'bootstrap prepared record');
  const record = validateBootstrapLedgerRecord(parsed);
  if (record.state !== 'prepared') throw new CliError('入力はprepared recordである必要があります');
  if (text !== `${canonicalJson(record)}\n`) {
    throw new CliError('bootstrap prepared recordがcanonical JSON + newline形式ではありません');
  }
  return record;
}

function assertPullIdentity(pull: PullRequest, record: BootstrapPreparedRecord, expectedState: 'open' | 'merged'): void {
  const stateMatches = expectedState === 'open'
    ? pull.state === 'open' && pull.merged === false
    : pull.state === 'closed' && pull.merged === true;
  if (
    pull.number !== 274 ||
    !stateMatches ||
    pull.head?.sha !== record.key.target_sha ||
    pull.base?.ref !== 'main'
  ) {
    throw new CliError(`PR #274が${expectedState}のexact target SHA/default main baseではありません`);
  }
}

function verifyPreparedEvidence(options: {
  root: string;
  record: BootstrapPreparedRecord;
  reviews: GithubReviewRecord[];
  checkRuns: CheckRun[];
}): void {
  const byReviewId = new Map(options.reviews.map((review) => [Number(review.id), review]));
  if (byReviewId.size !== options.reviews.length) throw new CliError('PR Review IDを一意に解決できません');
  const authorization = options.record.owner_authorization;
  const ownerReview = byReviewId.get(authorization.review_id);
  if (
    !ownerReview ||
    ownerReview.commit_id !== options.record.key.target_sha ||
    ownerReview.user?.login !== authorization.actor ||
    ownerReview.state !== 'COMMENTED' ||
    digestOf(ownerReview.body) !== authorization.evidence_digest
  ) {
    throw new CliError('owner authorization PR ReviewをAPI正本から再検証できません');
  }
  const permission = api<{ permission?: string }>(
    options.root,
    [
      `repos/{owner}/{repo}/collaborators/${encodeURIComponent(authorization.actor)}/permission`,
    ],
    'owner authorization permission',
  );
  if (permission.permission !== 'admin') {
    throw new CliError('owner authorization actorにadmin permissionがありません');
  }

  const evidence = options.record.independent_reviews.map((expected) => {
    const review = byReviewId.get(expected.review_id);
    if (
      !review ||
      review.commit_id !== options.record.key.target_sha ||
      review.state !== 'COMMENTED' ||
      digestOf(review.body) !== expected.evidence_digest
    ) {
      throw new CliError(`独立review ${expected.run_id}をAPI正本から再検証できません`);
    }
    const parsed = parseReviewEvidence(review.body);
    if (
      !parsed ||
      parsed.target_sha !== options.record.key.target_sha ||
      parsed.profile !== 'strict' ||
      parsed.expected_count !== 2 ||
      parsed.reviewer.run_id !== expected.run_id ||
      parsed.reviewer.model !== expected.model ||
      parsed.reviewer.reasoning !== expected.reasoning ||
      parsed.reviewer.capability.read_only !== true ||
      parsed.execution.sandbox !== 'read_only' ||
      parsed.verdict.conformance !== 'pass' ||
      parsed.verdict.falsification !== 'pass' ||
      parsed.verdict.inconclusive ||
      parsed.verdict.blockers.some((finding) => finding.severity === 'blocking')
    ) {
      throw new CliError(`独立review ${expected.run_id}がSol/xhigh PASS/read-only契約と一致しません`);
    }
    return parsed;
  });
  if (
    evidence[0].attempt_id !== evidence[1].attempt_id ||
    new Set(evidence.map((entry) => entry.reviewer.slot)).size !== 2
  ) {
    throw new CliError('独立reviewが同じStrict attemptの異なる2 slotではありません');
  }

  const current = options.checkRuns.filter((check) => !GATE_CHECK_NAMES.has(check.name));
  if (
    current.length === 0 ||
    !current.some((check) => check.name === 'verify') ||
    !current.some((check) => check.name === 'reconcile') ||
    current.some(
      (check) =>
        check.status !== 'completed' ||
        check.conclusion !== 'success' ||
        check.head_sha !== options.record.key.target_sha,
    )
  ) {
    throw new CliError('current SHAの必須非gate Checkが全てcompleted successではありません');
  }
  const actualChecks = current
    .map((check) => ({
      check_id: check.id,
      name: check.name,
      conclusion: 'success' as const,
      target_sha: check.head_sha,
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.check_id - right.check_id);
  const expectedChecks = [...options.record.non_gate_checks]
    .sort((left, right) => left.name.localeCompare(right.name) || left.check_id - right.check_id);
  if (canonicalJson(actualChecks) !== canonicalJson(expectedChecks)) {
    throw new CliError('prepared recordがcurrent SHAの全非gate Check集合と一致しません');
  }
}

function loadGithubState(
  root: string,
  record: BootstrapPreparedRecord,
  expectedState: 'open' | 'merged',
): {
  pull: PullRequest;
  reviews: GithubReviewRecord[];
  comments: IssueComment[];
  checkRuns: CheckRun[];
  entries: BootstrapLedgerEntry[];
} {
  const repository = api<{ id?: number; full_name?: string; default_branch?: string }>(
    root,
    ['repos/{owner}/{repo}'],
    'repository',
  );
  if (
    !Number.isSafeInteger(repository.id) ||
    repository.full_name !== record.key.repository ||
    repository.default_branch !== 'main'
  ) {
    throw new CliError('repository identity/default branchがbootstrap keyと一致しません');
  }
  const pull = api<PullRequest>(root, ['repos/{owner}/{repo}/pulls/274'], 'PR #274');
  assertPullIdentity(pull, record, expectedState);
  const reviews = paged<GithubReviewRecord>(root, 'repos/{owner}/{repo}/pulls/274/reviews', 'PR Reviews');
  const comments = paged<IssueComment>(root, 'repos/{owner}/{repo}/issues/274/comments', 'PR conversation');
  const checkPages = api<{ check_runs?: CheckRun[] } | { check_runs?: CheckRun[] }[]>(
    root,
    [
      `repos/{owner}/{repo}/commits/${record.key.target_sha}/check-runs?filter=latest&per_page=100`,
      '--paginate',
      '--slurp',
    ],
    'current Check Runs',
  );
  const pages = Array.isArray(checkPages) ? checkPages : [checkPages];
  const checkRuns = pages.flatMap((page) => page.check_runs ?? []);
  const entries: BootstrapLedgerEntry[] = [
    ...reviews.map((review) => ({
      id: Number(review.id),
      body: review.body,
      source: 'pr_review' as const,
      commit_id: review.commit_id,
    })),
    ...comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      source: 'issue_comment' as const,
    })),
  ];
  return { pull, reviews, comments, checkRuns, entries };
}

function prepare(root: string, record: BootstrapPreparedRecord): string {
  const github = loadGithubState(root, record, 'open');
  const state = resolveBootstrapLedgerState(github.entries, record.key);
  if (state.completed) throw new CliError('bootstrapはcompleted済みで再実行できません');
  if (state.prepared) {
    if (canonicalJson(state.prepared.record) !== canonicalJson(record)) {
      throw new CliError('同じkeyに異なるprepared evidenceが存在します');
    }
    verifyPreparedEvidence({ root, record, reviews: github.reviews, checkRuns: github.checkRuns });
    return `prepared_review_id=${state.prepared.review_id}\nresumed=true`;
  }
  verifyPreparedEvidence({ root, record, reviews: github.reviews, checkRuns: github.checkRuns });
  const body = JSON.stringify({
    body: renderBootstrapLedgerRecord(record),
    event: 'COMMENT',
    commit_id: record.key.target_sha,
  });
  const created = api<GithubReviewRecord>(
    root,
    ['-X', 'POST', 'repos/{owner}/{repo}/pulls/274/reviews', '--input', '-'],
    'bootstrap prepared PR Review',
    body,
  );
  if (
    Number(created.id) <= 0 ||
    created.body !== renderBootstrapLedgerRecord(record) ||
    created.commit_id !== record.key.target_sha
  ) {
    throw new CliError('作成したbootstrap prepared PR Reviewを応答から検証できません');
  }
  return `prepared_review_id=${created.id}\nresumed=false`;
}

function complete(root: string, record: BootstrapPreparedRecord): string {
  const github = loadGithubState(root, record, 'merged');
  const state = resolveBootstrapLedgerState(github.entries, record.key);
  if (state.completed) throw new CliError('bootstrapはcompleted済みで二回目を実行できません');
  if (!state.prepared || canonicalJson(state.prepared.record) !== canonicalJson(record)) {
    throw new CliError('exact prepared PR Reviewが存在しません');
  }
  if (
    !github.pull.merge_commit_sha ||
    !/^[0-9a-f]{40}$/.test(github.pull.merge_commit_sha) ||
    !github.pull.merged_at ||
    Number.isNaN(Date.parse(github.pull.merged_at))
  ) {
    throw new CliError('PR #274のmerge SHA/timeをAPI正本から解決できません');
  }
  const completed = buildBootstrapCompletedRecord({
    key: record.key,
    preparedReviewId: state.prepared.review_id,
    mergeCommitSha: github.pull.merge_commit_sha,
    mergedAt: new Date(github.pull.merged_at).toISOString(),
  });
  const body = JSON.stringify({ body: renderBootstrapLedgerRecord(completed) });
  const created = api<IssueComment>(
    root,
    ['-X', 'POST', 'repos/{owner}/{repo}/issues/274/comments', '--input', '-'],
    'bootstrap completed PR conversation',
    body,
  );
  if (
    !Number.isSafeInteger(created.id) ||
    created.id <= 0 ||
    parseBootstrapLedgerRecord(created.body)?.state !== 'completed' ||
    created.body !== renderBootstrapLedgerRecord(completed)
  ) {
    throw new CliError('作成したbootstrap completed recordを応答から検証できません');
  }
  return `completed_comment_id=${created.id}\nmerge_commit_sha=${github.pull.merge_commit_sha}`;
}

export async function ledger(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [phase, recordPath] = args;
    if (!phase || !recordPath || args.length !== 2 || !['prepare', 'complete'].includes(phase)) {
      return fail('bootstrap-ledgerはprepare|completeとprepared_record_pathが必要です');
    }
    const root = repoRoot();
    const record = readPreparedRecord(recordPath);
    return ok(phase === 'prepare' ? prepare(root, record) : complete(root, record));
  });
}
