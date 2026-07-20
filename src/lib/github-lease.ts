import { parse, stringify } from 'yaml';
import { git, gh } from './exec.js';
import { validateAgainstSchema } from './schema.js';

const MARKER = '<!-- agent-skill-chain:lease -->';

/** `git hash-object -t tree /dev/null` の固定値。全リポジトリに常に存在する空tree。 */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const REF_PREFIX = 'refs/agent-skill-chain/leases';

export interface WriterLease {
  schema_version: string;
  writer_lease: {
    issue_id: string;
    holder: string;
    segment: string;
    acquired_at: string;
    expires_at: string;
    token: string;
  };
}

/** git ref（`refs/agent-skill-chain/leases/<issue>-<segment>`）から読み出したwriter lease。 */
export interface LeaseRefEntry {
  segment: string;
  ref: string;
  lease: WriterLease;
}

interface GhComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
}

/**
 * GitHubモードの writer lease 正本は issue番号+segmentごとの専用git ref
 * （`refs/agent-skill-chain/leases/<issue_number>-<segment>`）である（ADR-0002）。
 * git の receive-pack はref更新時に現在値をサーバ側で再検証するため、force無しpushは
 * 真にatomicなcompare-and-set保証を持つ（SPEC.mdの技術検証で実測確認済み）。
 * Issueコメントへの投稿（postLeaseComment）はhuman向け可視性のためのbest-effort処理として残すが、
 * 競合判定・token検証等いかなるロジックにも使用しない（正本はgit refのみ、二重の正本を持たない）。
 */
export function renderLeaseComment(lease: WriterLease): string {
  return `${MARKER}\n\`\`\`yaml\n${stringify(lease)}\`\`\`\n`;
}

function leaseRefName(issueNumber: string, segment: string): string {
  return `${REF_PREFIX}/${issueNumber}-${segment}`;
}

export type LeaseRefPushOutcome =
  | { ok: true; sha: string }
  | { ok: false; reason: 'conflict'; stderr: string }
  | { ok: false; reason: 'error'; stderr: string };

/**
 * pushの失敗理由を2種に分類する（DESIGN.md §権限不足時のfallback）。
 * 非fast-forward・既存ref衝突（`[rejected]`）は既存leaseとの競合として扱う。加えて、真に
 * 同時（ほぼ同時刻）に同一ref新規作成を試みた場合、サーバ側のref lock競合により
 * `[remote rejected] ... (failed to update ref)` / `cannot lock ref '...': reference already
 * exists` という別系統の文言で拒否されることを実プロセス並行実行テストで実測確認した
 * （非fast-forward判定より前の、ref作成そのものの排他ロック層で先に競合するケース）。
 * これも既存leaseとの競合（＝取得済みだった）として分類する——同じくfast-forward拒否と同様、
 * 「他プロセスが同じrefを取得しようとした」ことを示す信号であり、権限・接続エラーとは性質が
 * 異なるため。それ以外（認証・権限・接続エラー等）は既存の楽観的排他制御へフォールバックせず
 * 別種のエラーとして扱う（安全側ラチェット。権限不足を無自覚にTOCTOU再導入で覆い隠さないため）。
 */
export function classifyPushFailure(stderr: string): 'conflict' | 'error' {
  return /\[rejected\]/.test(stderr) ||
    /\[remote rejected\]/.test(stderr) ||
    /non-fast-forward/i.test(stderr) ||
    /failed to update ref/i.test(stderr) ||
    /cannot lock ref/i.test(stderr) ||
    /reference already exists/i.test(stderr)
    ? 'conflict'
    : 'error';
}

/** refをfetchしてローカルへ複製し、先頭commitのメッセージをwriter leaseとしてparseする。 */
function readLeaseFromRef(ref: string, cwd?: string): { sha: string; lease: WriterLease } | undefined {
  const fetch = git(['fetch', 'origin', `+${ref}:${ref}`], cwd);
  if (fetch.status !== 0) return undefined; // ref不在（＝lease無し）または接続エラー。読み出し専用経路のため安全側でundefinedとして扱う。
  const rev = git(['rev-parse', ref], cwd);
  if (rev.status !== 0) return undefined;
  const sha = rev.stdout.trim();
  const log = git(['log', '-1', '--format=%B', sha], cwd);
  if (log.status !== 0) return undefined;
  try {
    const lease = parse(log.stdout) as WriterLease;
    const outcome = validateAgainstSchema('lease', lease);
    if (!outcome.valid) return undefined;
    return { sha, lease };
  } catch {
    return undefined;
  }
}

function listLeaseRefNames(issueNumber: string, cwd?: string): { ref: string; segment: string }[] {
  const prefix = `${REF_PREFIX}/${issueNumber}-`;
  const result = git(['ls-remote', 'origin', `${prefix}*`], cwd);
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const ref = line.slice(tab + 1).trim();
      return { ref, segment: ref.slice(prefix.length) };
    });
}

/** 有効期限に関わらず、指定Issueの全segmentのwriter leaseをgit refから読み出す。 */
export function allLeasesFor(issueNumber: string, cwd?: string): LeaseRefEntry[] {
  const entries: LeaseRefEntry[] = [];
  for (const { ref, segment } of listLeaseRefNames(issueNumber, cwd)) {
    const found = readLeaseFromRef(ref, cwd);
    if (found) entries.push({ segment, ref, lease: found.lease });
  }
  return entries;
}

export function activeLeaseFor(issueNumber: string, segment: string, cwd?: string): LeaseRefEntry | undefined {
  const ref = leaseRefName(issueNumber, segment);
  const found = readLeaseFromRef(ref, cwd);
  if (!found) return undefined;
  const now = new Date().toISOString();
  if (found.lease.writer_lease.expires_at <= now) return undefined;
  return { segment, ref, lease: found.lease };
}

/**
 * 有効期限内の writer lease を segment を問わず全て返す（1 Issueにつき同時1つのみ許可する制約の
 * issue横断コンフリクト検査に使う。AGENTS.md §役割・権限・writer lease）。
 */
export function activeLeasesFor(issueNumber: string, cwd?: string): LeaseRefEntry[] {
  const now = new Date().toISOString();
  return allLeasesFor(issueNumber, cwd).filter((e) => e.lease.writer_lease.expires_at > now);
}

/**
 * acquire: 空treeを親とするparentlessコミットへlease内容を埋め込み、force無しでrefへpushする。
 * ref不在なら新規作成として成功し、既存refがあれば非fast-forwardとして拒否される
 * （SPEC.mdの技術検証で実測確認済みの挙動）。
 */
export function acquireLeaseRef(issueNumber: string, segment: string, lease: WriterLease, cwd?: string): LeaseRefPushOutcome {
  const ref = leaseRefName(issueNumber, segment);
  const commit = git(['commit-tree', EMPTY_TREE_SHA, '-m', stringify(lease)], cwd);
  if (commit.status !== 0) return { ok: false, reason: 'error', stderr: commit.stderr.trim() };
  const sha = commit.stdout.trim();
  const push = git(['push', 'origin', `${sha}:${ref}`], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha };
}

/**
 * renew: 現在のref先頭commitを親とする新commit（更新後のexpires_atを埋め込む）を作成し、
 * 同じrefへforce無しでpushする。fast-forward条件（現在のref値が新commitの祖先であること）が
 * 自動的にcompare-and-setの条件として機能する。
 */
export function renewLeaseRef(issueNumber: string, segment: string, lease: WriterLease, cwd?: string): LeaseRefPushOutcome {
  const ref = leaseRefName(issueNumber, segment);
  const current = readLeaseFromRef(ref, cwd);
  if (!current) return { ok: false, reason: 'conflict', stderr: 'lease ref が見つかりません（既に回収された可能性があります）' };
  const commit = git(['commit-tree', EMPTY_TREE_SHA, '-p', current.sha, '-m', stringify(lease)], cwd);
  if (commit.status !== 0) return { ok: false, reason: 'error', stderr: commit.stderr.trim() };
  const sha = commit.stdout.trim();
  const push = git(['push', 'origin', `${sha}:${ref}`], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha };
}

/** release: `git push origin --delete <ref>`。 */
export function releaseLeaseRef(issueNumber: string, segment: string, cwd?: string): LeaseRefPushOutcome {
  const ref = leaseRefName(issueNumber, segment);
  const push = git(['push', 'origin', '--delete', ref], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha: '' };
}

const ACTIVE_LEASE_LABEL = 'writer-lease:active';

/**
 * WIP上限（wip.limit、既定3、有効writer lease数で判定）用: writer-lease:active ラベルが
 * 付与された open issue の件数を数える（GitHubモード）。
 */
export function countActiveWriterLeaseIssues(cwd?: string): number {
  const result = gh(['issue', 'list', '--label', ACTIVE_LEASE_LABEL, '--state', 'open', '--json', 'number'], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue list に失敗しました: ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout) as { number: number }[];
  return parsed.length;
}

/**
 * lease acquire 成功時に WIP 上限判定用ラベルを付与する（best-effort）。
 * ラベル操作の失敗は WIP 判定の可用性を下げるのみで、lease自体の正本（git ref）とは独立して
 * 機能し続けるため、ここでは例外を投げない（AGENTS.md §障害・ロールバック考慮）。
 */
export function markActiveWriterLeaseLabel(issueNumber: string, cwd?: string): void {
  gh(['label', 'create', ACTIVE_LEASE_LABEL], cwd);
  gh(['issue', 'edit', issueNumber, '--add-label', ACTIVE_LEASE_LABEL], cwd);
}

/** lease release 成功時に WIP 上限判定用ラベルを除去する（best-effort）。 */
export function unmarkActiveWriterLeaseLabel(issueNumber: string, cwd?: string): void {
  gh(['issue', 'edit', issueNumber, '--remove-label', ACTIVE_LEASE_LABEL], cwd);
}

/** acquire成功後にhuman向け可視性のためbest-effortで投稿するIssueコメント。失敗しても呼び出し元は無視してよい。 */
export function postLeaseComment(issueNumber: string, lease: WriterLease, cwd?: string): string {
  const result = gh(['issue', 'comment', issueNumber, '--body', renderLeaseComment(lease)], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue comment に失敗しました: ${result.stderr.trim()}`);
  }
  const match = /issuecomment-(\d+)/.exec(result.stdout.trim());
  if (!match) throw new Error(`投稿したコメントのIDを特定できません: ${result.stdout.trim()}`);
  return match[1];
}

function parseLeaseCommentToken(comment: GhComment): string | undefined {
  if (!comment.body.includes(MARKER)) return undefined;
  const match = /```yaml\n([\s\S]*?)```/.exec(comment.body);
  if (!match) return undefined;
  try {
    const lease = parse(match[1]) as WriterLease;
    return lease.writer_lease?.token;
  } catch {
    return undefined;
  }
}

/**
 * release/renew成功後、acquire時に投稿したhuman向け可視性コメントのうち該当tokenのものを
 * best-effortで削除する。正本はgit refのみであり、この検索・削除はlease自体の成否（token検証・
 * 競合判定）には一切使わない——見つからない・削除に失敗した場合も呼び出し元の処理は継続する。
 */
export function cleanupLeaseComment(issueNumber: string, token: string, cwd?: string): void {
  try {
    const result = gh(['issue', 'view', issueNumber, '--json', 'comments'], cwd);
    if (result.status !== 0) return;
    const parsed = JSON.parse(result.stdout) as { comments: GhComment[] };
    const match = parsed.comments.find((c) => parseLeaseCommentToken(c) === token);
    if (!match) return;
    const idMatch = /issuecomment-(\d+)/.exec(match.url);
    if (!idMatch) return;
    gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/issues/comments/${idMatch[1]}`], cwd);
  } catch {
    // best-effort: 可視性コメントの削除失敗はlease操作自体の成否に影響させない。
  }
}
