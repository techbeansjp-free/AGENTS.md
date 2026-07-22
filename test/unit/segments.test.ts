import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSegments, segmentDefinition } from '../../src/lib/segments.js';
import { repoRoot } from '../../src/lib/paths.js';

const EXPECTED = [
  { id: 'spec', outputs: ['SPEC.md'], next: 'design' },
  { id: 'design', outputs: ['DESIGN.md', 'ADR', 'PLAN.md'], next: 'implementation' },
  { id: 'implementation', outputs: ['code', 'unit_test_results'], next: 'validation' },
  {
    id: 'validation',
    outputs: ['acceptance_test_results', 'regression_test_results'],
    next: 'completed',
  },
];

test('loadSegments: root省略時、実物の config/segments.yaml を読み込み4セグメントを返す', () => {
  const doc = loadSegments();
  assert.equal(doc.schema_version, 'agent-skill-chain/segments/v1');
  assert.equal(doc.segments.length, 4);
  assert.deepEqual(doc.segments, EXPECTED);
});

test('loadSegments: 明示的な root（このworktreeのrepoRoot）でも同じ内容を返す', () => {
  const doc = loadSegments(repoRoot());
  assert.deepEqual(doc.segments, EXPECTED);
});

test('segmentDefinition: 各segment idについて定義（outputs, next）を返す', () => {
  assert.deepEqual(segmentDefinition('spec'), EXPECTED[0]);
  assert.deepEqual(segmentDefinition('design'), EXPECTED[1]);
  assert.deepEqual(segmentDefinition('implementation'), EXPECTED[2]);
  assert.deepEqual(segmentDefinition('validation'), EXPECTED[3]);
});

test('segmentDefinition: segments.yamlに定義されたnextの連鎖が spec→design→implementation→validation→completed である', () => {
  assert.equal(segmentDefinition('spec').next, 'design');
  assert.equal(segmentDefinition('design').next, 'implementation');
  assert.equal(segmentDefinition('implementation').next, 'validation');
  assert.equal(segmentDefinition('validation').next, 'completed');
});

test('segmentDefinition: 未定義のsegment idを渡すと例外を投げる', () => {
  // Segment 型上は不正な値だが、実行時バリデーションを検証するため意図的に as any でキャストする。
  assert.throws(
    () => segmentDefinition('unknown' as unknown as Parameters<typeof segmentDefinition>[0]),
    /unknown/,
  );
});
