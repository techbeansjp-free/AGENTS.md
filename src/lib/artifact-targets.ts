import type { Segment } from './issue.js';

export interface ArtifactTarget {
  segment: Segment;
  addedByClosure: boolean;
}

const CLOSURE_EXCLUDED_SEGMENTS = new Set<Segment>(['implementation', 'validation']);

/**
 * 開始済み集合 S と連鎖順序から必須成果物検査の対象集合 R を導出する。
 * 外部状態には触れず、呼び出し側が解決した値だけを入力にする。
 */
export function deriveArtifactTargets(
  startedSegments: readonly Segment[],
  segmentOrder: readonly Segment[],
  addUpstreamClosure: boolean,
): ArtifactTarget[] {
  const started = [...new Set(startedSegments)];
  if (started.length === 0) return [];
  if (!addUpstreamClosure) return started.map((segment) => ({ segment, addedByClosure: false }));

  const positions = new Map<Segment, number>();
  for (const [index, segment] of segmentOrder.entries()) {
    if (positions.has(segment)) throw new Error(`セグメント連鎖順序に重複があります: ${segment}`);
    positions.set(segment, index);
  }
  for (const segment of started) {
    if (!positions.has(segment)) {
      throw new Error(`開始済みセグメントが連鎖順序に存在しません: ${segment}`);
    }
  }

  const deepest = Math.max(...started.map((segment) => positions.get(segment) as number));
  const startedSet = new Set(started);
  return segmentOrder
    .filter((segment, index) => {
      if (startedSet.has(segment)) return true;
      return index < deepest && !CLOSURE_EXCLUDED_SEGMENTS.has(segment);
    })
    .map((segment) => ({ segment, addedByClosure: !startedSet.has(segment) }));
}
