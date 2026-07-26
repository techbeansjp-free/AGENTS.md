import { parse, stringify } from 'yaml';
import { git, gh } from './exec.js';
import { validateAgainstSchema } from './schema.js';

const MARKER = '<!-- agent-skill-chain:lease -->';

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
  sha: string;
  legacy: boolean;
  lease: WriterLease;
}

export type PublicWriterLease = Omit<WriterLease, 'writer_lease'> & {
  writer_lease: Omit<WriterLease['writer_lease'], 'token'>;
};

interface GhComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
}

/**
 * GitHubモードの writer lease 正本は Issue番号+segmentごとの専用git ref
 * （`refs/agent-skill-chain/leases/<issue_number>-<segment>`）である（ADR-0002）。
 * git の receive-pack はref更新時に現在値をサーバ側で再検証するため、force無しpushは
 * 真にatomicなcompare-and-set保証を持つ（SPEC.mdの技術検証で実測確認済み）。
 * Issueコメントへの投稿（postLeaseComment）はhuman向け可視性のためのbest-effort処理として残すが、
 * 競合判定・token検証等いかなるロジックにも使用しない（正本はgit refのみ、二重の正本を持たない）。
 */
export function renderLeaseComment(lease: WriterLease): string {
  return `${MARKER}\n\`\`\`yaml\n${stringify(publicLease(lease))}\`\`\`\n`;
}

/** token は lease ref の blob だけへ保存し、commit message・Issue comment・CLI表示へ渡さない。 */
export function publicLease(lease: WriterLease): PublicWriterLease {
  const { token: _token, ...writerLease } = lease.writer_lease;
  return { ...lease, writer_lease: writerLease };
}

function readLeasePayload(sha: string, cwd?: string): WriterLease | undefined {
  const payload = git(['show', `${sha}:lease.yaml`], cwd);
  if (payload.status !== 0) return undefined;
  try {
    const lease = parse(payload.stdout) as WriterLease;
    const outcome = validateAgainstSchema('lease', lease);
    return outcome.valid ? lease : undefined;
  } catch {
    return undefined;
  }
}

function createLeaseCommit(lease: WriterLease, parent: string | undefined, cwd?: string): { sha?: string; stderr?: string } {
  const blob = git(['hash-object', '-w', '--stdin'], cwd, stringify(lease));
  if (blob.status !== 0) return { stderr: blob.stderr.trim() };
  const tree = git(['mktree'], cwd, `100600 blob ${blob.stdout.trim()}\tlease.yaml\n`);
  if (tree.status !== 0) return { stderr: tree.stderr.trim() };
  const args = ['commit-tree', tree.stdout.trim()];
  if (parent) args.push('-p', parent);
  args.push('-m', stringify(publicLease(lease)));
  const commit = git(args, cwd);
  return commit.status === 0 ? { sha: commit.stdout.trim() } : { stderr: commit.stderr.trim() };
}

function leaseRefName(issueNumber: string, segment: string): string {
  return `${REF_PREFIX}/${issueNumber}-${segment}`;
}

export type LeaseRefPushOutcome =
  | { ok: true; sha: string }
  | { ok: false; reason: 'conflict'; stderr: string }
  | { ok: false; reason: 'error'; stderr: string };

/**
 * pushの失敗理由を2種に分類する（権限不足時のfallbackを取り違えないための分類。DESIGN.md参照）。
 * 非fast-forward・既存ref衝突（`[rejected]`）は既存leaseとの競合として扱う。加えて、真に
 * 同時（ほぼ同時刻）に同一ref新規作成を試みた場合、サーバ側のref作成競合により
 * `[remote rejected] ... (failed to update ref)` / `cannot lock ref '...': reference already
 * exists` という別系統の文言で拒否されることを実プロセス並行実行テストで実測確認した
 * （非fast-forward判定より前の、ref作成そのものの排他生成層で先に競合するケース）。
 * これも既存leaseとの競合（＝取得済みだった）として分類する——同じくfast-forward拒否と同様、
 * 「他プロセスが同じrefを取得しようとした」ことを示す信号であり、権限・接続エラーとは性質が
 * 異なるため。それ以外（認証・権限・接続エラー等）は既存の楽観的な同時実行制御へフォールバック
 * せず別種のエラーとして扱う（安全側ラチェット。権限不足を無自覚にTOCTOU再導入で覆い隠さないため）。
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

/** refをfetchしてローカルへ複製し、token非含有subjectと非表示blobからwriter leaseを復元する。 */
function readLeaseFromRef(
  ref: string,
  cwd?: string,
): { sha: string; lease: WriterLease; legacy: boolean } | undefined {
  const fetch = git(['fetch', 'origin', `+${ref}:${ref}`], cwd);
  if (fetch.status !== 0) return undefined; // ref不在（＝lease無し）または接続エラー。読み出し専用経路のため安全側でundefinedとして扱う。
  const rev = git(['rev-parse', ref], cwd);
  if (rev.status !== 0) return undefined;
  const sha = rev.stdout.trim();
  const log = git(['log', '-1', '--format=%B', sha], cwd);
  if (log.status !== 0) return undefined;
  const payloadLease = readLeasePayload(sha, cwd);
  if (payloadLease) return { sha, lease: payloadLease, legacy: false };
  // 旧形式は期限切れreclaimまたは正当なresumeの移行だけに読み取る。raw messageを表示しない。
  try {
    const legacyLease = parse(log.stdout) as WriterLease;
    const outcome = validateAgainstSchema('lease', legacyLease);
    return outcome.valid ? { sha, lease: legacyLease, legacy: true } : undefined;
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
    if (found) entries.push({ segment, ref, sha: found.sha, legacy: found.legacy, lease: found.lease });
  }
  return entries;
}

export function activeLeaseFor(issueNumber: string, segment: string, cwd?: string): LeaseRefEntry | undefined {
  const ref = leaseRefName(issueNumber, segment);
  const found = readLeaseFromRef(ref, cwd);
  if (!found) return undefined;
  const now = new Date().toISOString();
  if (found.lease.writer_lease.expires_at <= now) return undefined;
  return { segment, ref, sha: found.sha, legacy: found.legacy, lease: found.lease };
}

/**
 * 有効期限内の writer lease を segment を問わず全て返す（1 Issueにつき同時1つのみ許可する制約の
 * Issue横断コンフリクト検査に使う。AGENTS.md の役割・権限・writer lease の定義を参照）。
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
  const commit = createLeaseCommit(lease, undefined, cwd);
  if (!commit.sha) return { ok: false, reason: 'error', stderr: commit.stderr ?? '' };
  const sha = commit.sha;
  const push = git(['push', 'origin', `${sha}:${ref}`], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha };
}

/**
 * renew: 現在のref先頭commitを親とする新commit（更新後のexpires_atを埋め込む）を作成し、
 * 同じrefへforce無しでpushする。fast-forward条件（現在のref値が新commitの祖先であること）が
 * 自動的にcompare-and-setの条件として機能する。
 */
export function renewLeaseRef(
  issueNumber: string,
  segment: string,
  lease: WriterLease,
  cwd?: string,
  expectedSha?: string,
): LeaseRefPushOutcome {
  const ref = leaseRefName(issueNumber, segment);
  const current = readLeaseFromRef(ref, cwd);
  if (!current) return { ok: false, reason: 'conflict', stderr: 'lease ref が見つかりません（既に回収された可能性があります）' };
  if (expectedSha && current.sha !== expectedSha) {
    return { ok: false, reason: 'conflict', stderr: 'lease ref が検査後に更新されました' };
  }
  const commit = createLeaseCommit(lease, current.sha, cwd);
  if (!commit.sha) return { ok: false, reason: 'error', stderr: commit.stderr ?? '' };
  const sha = commit.sha;
  const push = git(['push', 'origin', `${sha}:${ref}`], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha };
}

/**
 * resume: 検査時のref SHAを親にした新形式commitをforce無しpushする。refが検査後に変化すれば
 * non-fast-forwardとなり、期限切れleaseを別実行者の更新へ上書きしない。
 */
export function resumeLeaseRef(
  issueNumber: string,
  segment: string,
  expectedSha: string,
  lease: WriterLease,
  cwd?: string,
): LeaseRefPushOutcome {
  return renewLeaseRef(issueNumber, segment, lease, cwd, expectedSha);
}

/** release: 検査したref SHAをforce-with-lease条件にして削除する。 */
export function releaseLeaseRef(
  issueNumber: string,
  segment: string,
  cwd?: string,
  expectedSha?: string,
): LeaseRefPushOutcome {
  const ref = leaseRefName(issueNumber, segment);
  const current = expectedSha ? undefined : readLeaseFromRef(ref, cwd);
  const expected = expectedSha ?? current?.sha;
  if (!expected) {
    return { ok: false, reason: 'conflict', stderr: 'lease ref が見つかりません（既に回収された可能性があります）' };
  }
  const push = git(['push', `--force-with-lease=${ref}:${expected}`, 'origin', `:${ref}`], cwd);
  if (push.status !== 0) return { ok: false, reason: classifyPushFailure(push.stderr), stderr: push.stderr.trim() };
  return { ok: true, sha: '' };
}

const ACTIVE_LEASE_LABEL = 'writer-lease:active';

/**
 * WIP上限（wip.limit、既定3、有効writer lease数で判定）用: writer-lease:active ラベルが
 * 付与された open Issue の件数を数える（GitHubモード）。
 */
export function countActiveWriterLeaseIssues(cwd?: string): number {
  const result = gh([`issue`, 'list', '--label', ACTIVE_LEASE_LABEL, '--state', 'open', '--json', 'number'], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue list に失敗しました: ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout) as { number: number }[];
  return parsed.length;
}

/**
 * lease acquire 成功時に WIP 上限判定用ラベルを付与する（best-effort）。
 * ラベル操作の失敗は WIP 判定の可用性を下げるのみで、lease自体の正本（git ref）とは独立して
 * 機能し続けるため、ここでは例外を投げない（AGENTS.md の障害・ロールバック考慮の方針に従う）。
 */
export function markActiveWriterLeaseLabel(issueNumber: string, cwd?: string): void {
  gh(['label', 'create', ACTIVE_LEASE_LABEL], cwd);
  gh([`issue`, 'edit', issueNumber, '--add-label', ACTIVE_LEASE_LABEL], cwd);
}

/** lease release 成功時に WIP 上限判定用ラベルを除去する（best-effort）。 */
export function unmarkActiveWriterLeaseLabel(issueNumber: string, cwd?: string): void {
  gh([`issue`, 'edit', issueNumber, '--remove-label', ACTIVE_LEASE_LABEL], cwd);
}

/** acquire成功後にhuman向け可視性のためbest-effortで投稿するIssueコメント。失敗しても呼び出し元は無視してよい。 */
export function postLeaseComment(issueNumber: string, lease: WriterLease, cwd?: string): string {
  const result = gh([`issue`, 'comment', issueNumber, '--body', renderLeaseComment(lease)], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue comment に失敗しました: ${result.stderr.trim()}`);
  }
  const match = /issuecomment-(\d+)/.exec(result.stdout.trim());
  if (!match) throw new Error(`投稿したコメントのIDを特定できません: ${result.stdout.trim()}`);
  return match[1];
}

function parseLeaseCommentHolder(comment: GhComment): string | undefined {
  if (!comment.body.includes(MARKER)) return undefined;
  const match = /```yaml\n([\s\S]*?)```/.exec(comment.body);
  if (!match) return undefined;
  try {
    const value = parse(match[1]) as { writer_lease?: { holder?: unknown } };
    return typeof value.writer_lease?.holder === 'string' ? value.writer_lease.holder : undefined;
  } catch {
    return undefined;
  }
}

/**
 * release/resume成功後、acquire時に投稿したhuman向け可視性コメントのうち該当holderのものを
 * best-effortで削除する。コメント中のlegacy tokenは読み出しも表示もせず、holderだけを比較する。
 * 正本はgit refのみであり、見つからない・削除に失敗した場合もlease操作は継続する。
 */
export function cleanupLeaseComment(issueNumber: string, holder: string, cwd?: string): void {
  try {
    const result = gh([`issue`, 'view', issueNumber, '--json', 'comments'], cwd);
    if (result.status !== 0) return;
    const parsed = JSON.parse(result.stdout) as { comments: GhComment[] };
    const match = parsed.comments.find((c) => parseLeaseCommentHolder(c) === holder);
    if (!match) return;
    const idMatch = /issuecomment-(\d+)/.exec(match.url);
    if (!idMatch) return;
    gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/issues/comments/${idMatch[1]}`], cwd);
  } catch {
    // best-effort: 可視性コメントの削除失敗はlease操作自体の成否に影響させない。
  }
}
