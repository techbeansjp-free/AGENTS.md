import { git } from './exec.js';
import type { Segment } from './issue.js';
import { extractSpecAcIds } from './spec-ac-ids.js';

export type ArtifactReadResult =
  | { status: 'present'; path: string; content: string }
  | { status: 'absent'; path: string }
  | { status: 'unreadable'; path: string; reason: string };

export type ArtifactSetStatus = 'present' | 'absent' | 'unreadable';
export type AcIdResult =
  | { status: 'present'; ids: string[] }
  | { status: 'empty'; ids: [] }
  | { status: 'unreadable'; ids: [] };

export const REQUIRED_GATE_ARTIFACTS: Record<Segment, readonly string[]> = {
  spec: ['SPEC.md'],
  design: ['DESIGN.md', 'PLAN.md'],
  implementation: [],
  validation: ['VALIDATION.md'],
};

/** target SHA のツリーで不在を肯定的に確認してから blob 本文を読む。 */
export function readArtifactAtSha(root: string, targetSha: string, artifactPath: string): ArtifactReadResult {
  const listed = git(['ls-tree', '-z', targetSha, '--', artifactPath], root);
  if (listed.status !== 0) return { status: 'unreadable', path: artifactPath, reason: 'tree を列挙できません' };
  const entries = listed.stdout.split('\0').filter(Boolean);
  if (entries.length === 0) return { status: 'absent', path: artifactPath };
  if (entries.length !== 1) return { status: 'unreadable', path: artifactPath, reason: 'tree entry を一意に解決できません' };
  const match = /^\d+\s+(\S+)\s+([0-9a-f]+)\t/.exec(entries[0]);
  if (!match || match[1] !== 'blob') return { status: 'unreadable', path: artifactPath, reason: 'tree entry が blob ではありません' };
  const shown = git(['cat-file', '-p', match[2]], root);
  if (shown.status !== 0) return { status: 'unreadable', path: artifactPath, reason: 'blob 本文を取得できません' };
  return { status: 'present', path: artifactPath, content: shown.stdout };
}

export function readRequiredGateArtifacts(root: string, targetSha: string, gateId: Segment): ArtifactReadResult[] {
  return REQUIRED_GATE_ARTIFACTS[gateId].map((artifactPath) => readArtifactAtSha(root, targetSha, artifactPath));
}

export function artifactSetStatus(results: readonly ArtifactReadResult[]): ArtifactSetStatus {
  if (results.some((result) => result.status === 'unreadable')) return 'unreadable';
  if (results.some((result) => result.status === 'absent')) return 'absent';
  return 'present';
}

export function extractAcIdsFromArtifact(result: ArtifactReadResult): AcIdResult {
  if (result.status === 'unreadable') return { status: 'unreadable', ids: [] };
  if (result.status === 'absent') return { status: 'empty', ids: [] };
  const ids = extractSpecAcIds(result.content);
  return ids.length > 0 ? { status: 'present', ids } : { status: 'empty', ids: [] };
}
