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
