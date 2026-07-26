import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateAgainstSchema, getValidator, type SchemaName } from '../../src/lib/schema.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';
import { packageRoot, resolveAsset } from '../../src/lib/paths.js';

const SCHEMA_NAMES: SchemaName[] = [
  'config',
  'state',
  'gate-report',
  'validation-report',
  'worker-report',
  'integration',
  'lease',
  'segments',
  'project-policy',
];

interface SchemaDoc {
  required: string[];
  examples: Record<string, unknown>[];
}

function loadSchemaDoc(name: SchemaName): SchemaDoc {
  const filePath = resolveAsset(path.join('schemas', `${name}.schema.yaml`));
  return readYamlFile<SchemaDoc>(filePath);
}

for (const name of SCHEMA_NAMES) {
  test(`validateAgainstSchema('${name}'): スキーマ同梱のexamples[0]（正しいデータ）はvalidになる`, () => {
    const doc = loadSchemaDoc(name);
    assert.ok(Array.isArray(doc.examples) && doc.examples.length > 0, `${name}.schema.yaml に examples が無い`);
    const outcome = validateAgainstSchema(name, doc.examples[0]);
    assert.deepEqual(outcome, { valid: true, errors: [] });
  });

  test(`validateAgainstSchema('${name}'): 必須フィールド欠落データはinvalidになりエラーメッセージを含む`, () => {
    const doc = loadSchemaDoc(name);
    assert.ok(Array.isArray(doc.required) && doc.required.length > 0, `${name}.schema.yaml に required が無い`);
    const broken = structuredClone(doc.examples[0]);
    const missingField = doc.required[0];
    delete broken[missingField];
    const outcome = validateAgainstSchema(name, broken);
    assert.equal(outcome.valid, false);
    assert.ok(outcome.errors.length > 0, 'invalid時にerrorsが空であってはならない');
    assert.ok(
      outcome.errors.every((e) => e.trim().length > 0),
      'errorsの各要素は空文字であってはならない',
    );
  });
}

test("validateAgainstSchema('state'): title/requestを含むstateは検証を通過する（ISSUE-183 AC-3）", () => {
  const doc = loadSchemaDoc('state');
  const withIssueBody = {
    ...structuredClone(doc.examples[0]),
    title: '使い捨て検証用issue',
    request: 'launch_workerの実機再検証用にspec segmentを1つ完走させる。\n複数行も許容する。',
  };
  const outcome = validateAgainstSchema('state', withIssueBody);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test("validateAgainstSchema('state'): title/requestを持たない既存stateは引き続き検証を通過する（後方互換、ISSUE-183 AC-3）", () => {
  const doc = loadSchemaDoc('state');
  const withoutIssueBody = structuredClone(doc.examples[0]);
  assert.ok(
    !('title' in withoutIssueBody) && !('request' in withoutIssueBody),
    '前提: examples[0]はtitle/requestを持たない既存形式であること',
  );
  const outcome = validateAgainstSchema('state', withoutIssueBody);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test("validateAgainstSchema('state'): review_subject=core_auditを許可し未知値を拒否する", () => {
  const doc = loadSchemaDoc('state');
  const coreAudit = { ...structuredClone(doc.examples[0]), review_subject: 'core_audit' };
  assert.deepEqual(validateAgainstSchema('state', coreAudit, packageRoot()), { valid: true, errors: [] });

  const invalid = { ...structuredClone(doc.examples[0]), review_subject: 'weak-review' };
  assert.equal(validateAgainstSchema('state', invalid, packageRoot()).valid, false);
});

test('validateAgainstSchema: 実物の config/agent-skill-chain.yaml をそのまま渡すとvalidになる', () => {
  const configPath = resolveAsset(path.join('config', 'agent-skill-chain.yaml'));
  const config = readYamlFile(configPath);
  const outcome = validateAgainstSchema('config', config);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test('validateAgainstSchema: 明らかに型が異なるデータ（配列でなく文字列）はinvalidになる', () => {
  const outcome = validateAgainstSchema('config', 'not-an-object');
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test('validateAgainstSchema: additionalProperties禁止のスキーマに未知フィールドを足すとinvalidになる', () => {
  const doc = loadSchemaDoc('segments');
  const broken = { ...structuredClone(doc.examples[0]), unexpected_field: 'nope' };
  const outcome = validateAgainstSchema('segments', broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test('getValidator: 同名・同rootの呼び出しは同一のvalidator関数を返す（コンパイル結果がキャッシュされる）', () => {
  const first = getValidator('config');
  const second = getValidator('config');
  assert.equal(first, second);
});

test('getValidator: 有効なデータに対しvalidatorを直接呼ぶとtrueを返す', () => {
  const doc = loadSchemaDoc('lease');
  const validator = getValidator('lease');
  assert.equal(validator(doc.examples[0]), true);
});
