import crypto from 'node:crypto';
import fs from 'node:fs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// Issue #309: 実在する成果物の内容と、成果物欠落を表す sentinel 値は、同一のハッシュ空間
// （プレフィックス無しの digestOf）を共有してはならない。実在ファイルの内容がたまたま
// 旧sentinel文字列そのものであるようなケースで、両者が衝突しうるため。
// ARTIFACT_PRESENT_DOMAIN / ARTIFACT_ABSENT_DOMAIN は "present" / "absent" の時点で
// 文字列として分岐しており、一方が他方の（content付き）プレフィックスになることは無い。
const ARTIFACT_PRESENT_DOMAIN = 'agent-skill-chain:artifact-present:v1\n';
const ARTIFACT_ABSENT_DOMAIN = 'agent-skill-chain:artifact-absent:v1\n';

export function digestOf(content: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

export function digestOfFile(filePath: string): string {
  return digestOf(fs.readFileSync(filePath));
}

/**
 * 実在する成果物の内容用の digest。ドメイン分離 prefix を内容の前に付与してからハッシュ化する
 * ことで、成果物欠落 sentinel（{@link ARTIFACT_ABSENT_DIGEST}）とは原理的に衝突しない
 * （Issue #309）。
 */
export function artifactDigestOf(content: string | Buffer): string {
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return digestOf(Buffer.concat([Buffer.from(ARTIFACT_PRESENT_DOMAIN, 'utf8'), contentBuffer]));
}

export function artifactDigestOfFile(filePath: string): string {
  return artifactDigestOf(fs.readFileSync(filePath));
}

/**
 * 成果物欠落を表す sentinel digest。{@link artifactDigestOf} とは異なるドメイン
 * （ARTIFACT_ABSENT_DOMAIN）から導出するため、実在成果物のいかなる内容の digest とも
 * 衝突しない（Issue #309）。
 */
export const ARTIFACT_ABSENT_DIGEST = digestOf(ARTIFACT_ABSENT_DOMAIN);

export function isValidDigest(value: string): boolean {
  return DIGEST_RE.test(value);
}
