import { parse, stringify } from 'yaml';
import { gh } from './exec.js';
import { validateAgainstSchema } from './schema.js';

const MARKER = '<!-- agent-skill-chain:lease -->';

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

interface LeaseComment {
  commentId: string;
  createdAt: string;
  lease: WriterLease;
}

interface GhComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
}

/**
 * GitHubモードの writer lease は Issue コメントへ YAML（schemas/lease.schema.yaml準拠）を
 * 埋め込んで表現する。gh CLI には比較更新（compare-and-set）APIが無いため、
 * 「投稿前に既存アクティブleaseの有無を確認し、投稿後に競合有無を再確認する」楽観的排他制御
 * で近似する。真の原子性は保証しない（このモジュール内でのみ完結する既知の制約）。
 */
export function renderLeaseComment(lease: WriterLease): string {
  return `${MARKER}\n\`\`\`yaml\n${stringify(lease)}\`\`\`\n`;
}

function parseLeaseComment(comment: GhComment): LeaseComment | undefined {
  if (!comment.body.includes(MARKER)) return undefined;
  const match = /```yaml\n([\s\S]*?)```/.exec(comment.body);
  if (!match) return undefined;
  try {
    const lease = parse(match[1]) as WriterLease;
    const outcome = validateAgainstSchema('lease', lease);
    if (!outcome.valid) return undefined;
    return { commentId: extractNumericCommentId(comment.url), createdAt: comment.createdAt, lease };
  } catch {
    return undefined;
  }
}

function extractNumericCommentId(url: string): string {
  const match = /issuecomment-(\d+)/.exec(url);
  if (!match) throw new Error(`コメントURLから数値IDを抽出できません: ${url}`);
  return match[1];
}

export function listLeaseComments(issueNumber: string, cwd?: string): LeaseComment[] {
  const result = gh(['issue', 'view', issueNumber, '--json', 'comments'], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue view に失敗しました: ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout) as { comments: GhComment[] };
  return parsed.comments.map(parseLeaseComment).filter((c): c is LeaseComment => c !== undefined);
}

export function activeLeaseFor(issueNumber: string, segment: string, cwd?: string): LeaseComment | undefined {
  const now = new Date().toISOString();
  return listLeaseComments(issueNumber, cwd)
    .filter((c) => c.lease.writer_lease.segment === segment && c.lease.writer_lease.expires_at > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

export function postLeaseComment(issueNumber: string, lease: WriterLease, cwd?: string): string {
  const result = gh(['issue', 'comment', issueNumber, '--body', renderLeaseComment(lease)], cwd);
  if (result.status !== 0) {
    throw new Error(`gh issue comment に失敗しました: ${result.stderr.trim()}`);
  }
  const match = /issuecomment-(\d+)/.exec(result.stdout.trim());
  if (!match) throw new Error(`投稿したコメントのIDを特定できません: ${result.stdout.trim()}`);
  return match[1];
}

export function deleteLeaseComment(commentId: string, cwd?: string): void {
  const result = gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/issues/comments/${commentId}`], cwd);
  if (result.status !== 0) {
    throw new Error(`lease コメントの削除に失敗しました（comment ${commentId}）: ${result.stderr.trim()}`);
  }
}
