import crypto from 'node:crypto';
import fs from 'node:fs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function digestOf(content: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

export function digestOfFile(filePath: string): string {
  return digestOf(fs.readFileSync(filePath));
}

export function isValidDigest(value: string): boolean {
  return DIGEST_RE.test(value);
}
