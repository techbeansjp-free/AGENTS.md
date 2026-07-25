import crypto from 'node:crypto';
import fs from 'node:fs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_PRESENT_DOMAIN = Buffer.from('agent-skill-chain:artifact-present:v1\0');
export const ARTIFACT_ABSENT_DIGEST = digestOf('agent-skill-chain:artifact-absent:v1\0');

export function digestOf(content: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

export function digestOfFile(filePath: string): string {
  return digestOf(fs.readFileSync(filePath));
}

/** 成果物の実在blobを欠落sentinelと別domainでhashする。 */
export function artifactDigestOf(content: string | Buffer): string {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  return digestOf(Buffer.concat([ARTIFACT_PRESENT_DOMAIN, bytes]));
}

export function artifactDigestOfFile(filePath: string): string {
  return artifactDigestOf(fs.readFileSync(filePath));
}

export function isValidDigest(value: string): boolean {
  return DIGEST_RE.test(value);
}
