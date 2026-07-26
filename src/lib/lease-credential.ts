import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { git } from './exec.js';
import type { WriterLease } from './github-lease.js';

const CREDENTIAL_SCHEMA = 'agent-skill-chain/lease-credential/v1';

export interface LeaseCredential {
  schema_version: typeof CREDENTIAL_SCHEMA;
  issue_id: string;
  segment: string;
  holder: string;
  token: string;
  worktree_path?: string;
  branch?: string;
}

function credentialDirectory(root: string): string {
  const result = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('lease credential の保存先を解決できません');
  }
  const commonDir = path.resolve(root, result.stdout.trim());
  return path.join(commonDir, 'agent-skill-chain', 'lease-credentials');
}

function credentialPath(root: string, issueNumber: string): string {
  return path.join(credentialDirectory(root), `${issueNumber}.yaml`);
}

function isCredential(value: unknown): value is LeaseCredential {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schema_version === CREDENTIAL_SCHEMA &&
    typeof candidate.issue_id === 'string' &&
    typeof candidate.segment === 'string' &&
    typeof candidate.holder === 'string' &&
    typeof candidate.token === 'string' &&
    (candidate.worktree_path === undefined || typeof candidate.worktree_path === 'string') &&
    (candidate.branch === undefined || typeof candidate.branch === 'string')
  );
}

/**
 * bearer token はstdoutへ返さず、Git管理対象外のcommon git dirに0600で保存する。
 * linked worktree間でも同じcredentialを参照するため、renew/release/resumeのライフサイクルを保てる。
 */
export function writeLeaseCredential(root: string, credential: LeaseCredential): void {
  const directory = credentialDirectory(root);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const target = credentialPath(root, credential.issue_id.replace(/^ISSUE-/, ''));
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, stringify(credential), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // rename済み、または作成前の失敗。
    }
  }
}

export function readLeaseCredential(root: string, issueNumber: string): LeaseCredential | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(credentialPath(root, issueNumber), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const credential = parse(raw) as unknown;
    return isCredential(credential) ? credential : undefined;
  } catch {
    return undefined;
  }
}

export function removeLeaseCredential(root: string, issueNumber: string): void {
  try {
    fs.unlinkSync(credentialPath(root, issueNumber));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function credentialFor(
  lease: WriterLease,
  worktree?: { path: string; branch?: string },
): LeaseCredential {
  return {
    schema_version: CREDENTIAL_SCHEMA,
    issue_id: lease.writer_lease.issue_id,
    segment: lease.writer_lease.segment,
    holder: lease.writer_lease.holder,
    token: lease.writer_lease.token,
    worktree_path: worktree ? path.resolve(worktree.path) : undefined,
    branch: worktree?.branch,
  };
}

export function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
