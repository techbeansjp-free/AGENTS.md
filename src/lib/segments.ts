import path from 'node:path';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset, repoRoot } from './paths.js';
import { validateAgainstSchema } from './schema.js';
import type { Segment } from './issue.js';

export interface SegmentDefinition {
  id: Segment;
  outputs: string[];
  next: Segment | 'completed';
}

export interface SegmentsDocument {
  schema_version: string;
  segments: SegmentDefinition[];
}

export function loadSegments(root: string = repoRoot()): SegmentsDocument {
  const segmentsPath = resolveAsset(path.join('config', 'segments.yaml'), root);
  const doc = readYamlFile<SegmentsDocument>(segmentsPath);
  const outcome = validateAgainstSchema('segments', doc, root);
  if (!outcome.valid) {
    throw new Error(
      `config/segments.yaml がスキーマ（agent-skill-chain/segments/v1）に適合しません:\n` +
        outcome.errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
  return doc;
}

export function segmentDefinition(id: Segment, root?: string): SegmentDefinition {
  const found = loadSegments(root).segments.find((s) => s.id === id);
  if (!found) throw new Error(`config/segments.yaml に segment '${id}' が定義されていません`);
  return found;
}

/** セグメント定義の next を辿り、終端を除く一本鎖の固定順を導出する。 */
export function deriveSegmentOrder(definitions: readonly SegmentDefinition[]): Segment[] {
  const byId = new Map<Segment, SegmentDefinition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`config/segments.yaml の segment '${definition.id}' が重複しています`);
    }
    byId.set(definition.id, definition);
  }

  const referenced = new Set(
    definitions.map((definition) => definition.next).filter((next): next is Segment => next !== 'completed'),
  );
  const heads = definitions.filter((definition) => !referenced.has(definition.id));
  if (heads.length !== 1) {
    throw new Error(`config/segments.yaml の連鎖先頭を一意に解決できません（候補数: ${heads.length}）`);
  }

  const order: Segment[] = [];
  const visited = new Set<Segment>();
  let current: Segment | 'completed' = heads[0].id;
  while (current !== 'completed') {
    if (visited.has(current)) {
      throw new Error(`config/segments.yaml の連鎖に循環があります: ${current}`);
    }
    const definition = byId.get(current);
    if (!definition) {
      throw new Error(`config/segments.yaml の next が未定義segmentを参照しています: ${current}`);
    }
    visited.add(current);
    order.push(current);
    current = definition.next;
  }

  if (visited.size !== definitions.length) {
    const unreachable = definitions.filter((definition) => !visited.has(definition.id)).map((definition) => definition.id);
    throw new Error(`config/segments.yaml の連鎖が一本に定まりません（未到達: ${unreachable.join(', ')}）`);
  }
  return order;
}
