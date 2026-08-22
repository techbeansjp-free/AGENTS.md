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

test("validateAgainstSchema('state'): review_intensityは任意でlight/fullを許可し未知値を拒否する", () => {
  const doc = loadSchemaDoc('state');
  for (const reviewIntensity of ['light', 'full']) {
    const state = { ...structuredClone(doc.examples[0]), review_intensity: reviewIntensity };
    assert.deepEqual(validateAgainstSchema('state', state, packageRoot()), { valid: true, errors: [] });
  }

  const invalid = { ...structuredClone(doc.examples[0]), review_intensity: 'minimal' };
  assert.equal(validateAgainstSchema('state', invalid, packageRoot()).valid, false);
  assert.deepEqual(validateAgainstSchema('state', structuredClone(doc.examples[0]), packageRoot()), {
    valid: true,
    errors: [],
  });
});

test("validateAgainstSchema('state'): round budget宣言は任意だが完全payloadだけを許可する", () => {
  const doc = loadSchemaDoc('state');
  const state = structuredClone(doc.examples[0]) as { gate: Record<string, unknown> };
  state.gate.round_budget_declaration = {
    schema_version: 'agent-skill-chain/round-budget-declaration/v1', issue_id: 'ISSUE-123', gate: 'design',
    previous_attempt_id: 'attempt-design-previous', final_round: 4,
    blocking_categories: ['previous_blocking_unresolved', 'issue_purpose_blocked', 'test_build_regression', 'data_loss_or_security'],
    nonblocking_action: 'warning_with_persisted_follow_up',
    declaration_digest: `sha256:${'a'.repeat(64)}`, declared_at: '2026-08-19T00:00:00.000Z', record_id: '10',
  };
  assert.equal(validateAgainstSchema('state', state, packageRoot()).valid, true);
  const invalid = structuredClone(state) as { gate: { round_budget_declaration: Record<string, unknown> } };
  delete invalid.gate.round_budget_declaration.previous_attempt_id;
  assert.equal(validateAgainstSchema('state', invalid, packageRoot()).valid, false);
});

test("validateAgainstSchema('worker-report'): blocking remediationとrequired_addition理由を条件検査する", () => {
  const base = {
    schema_version: 'agent-skill-chain/worker-report/v1', issue_id: 'ISSUE-123',
    role: 'implementation_worker', segment: 'implementation', status: 'completed', target_sha: 'abc123',
    remediation_required: true,
  };
  assert.equal(validateAgainstSchema('worker-report', base, packageRoot()).valid, false);
  assert.equal(validateAgainstSchema('worker-report', {
    ...base,
    remediations: [{ method: 'required_addition', finding_code: 'F-1', summary: '追加' }],
  }, packageRoot()).valid, false);
  assert.equal(validateAgainstSchema('worker-report', {
    ...base,
    remediations: [{
      method: 'required_addition', finding_code: 'F-1', summary: '追加',
      non_addition_failure_reason: '書換え・削除ではIssue目的を達成できない',
    }],
  }, packageRoot()).valid, true);
});

test("validateAgainstSchema('gate-report'): light_reviewは完全な任意証跡だけを許可する", () => {
  const doc = loadSchemaDoc('gate-report');
  const report = structuredClone(doc.examples[0]) as { gate: Record<string, unknown> };
  report.gate.light_review = {
    requested: true,
    applied: true,
    disabled_reasons: [],
    remediation_round: 0,
    strict_locked: false,
  };
  assert.deepEqual(validateAgainstSchema('gate-report', report, packageRoot()), { valid: true, errors: [] });

  const invalid = structuredClone(report) as { gate: { light_review: Record<string, unknown> } };
  delete invalid.gate.light_review.strict_locked;
  assert.equal(validateAgainstSchema('gate-report', invalid, packageRoot()).valid, false);
});

// Issue #786: 既存の publish 整合検査は final=approved に対し conformance/falsification の
// 両 pass を要求するため、この2フィールドには判定へ用いた有効 sub-verdict を記録する。
// レビュアが提出した raw 値は同じ現行記録へ併記し、失わせない。
test("validateAgainstSchema('gate-report'): 有効sub-verdictのraw併記は完全payloadだけを許可する", () => {
  const doc = loadSchemaDoc('gate-report');
  const report = structuredClone(doc.examples[0]) as { gate: Record<string, unknown> };
  report.gate.subverdict_reclassification = {
    original_conformance: 'fail',
    original_falsification: 'fail',
    basis: 'all_blocking_findings_reclassified',
  };
  assert.deepEqual(validateAgainstSchema('gate-report', report, packageRoot()), { valid: true, errors: [] });

  const missing = structuredClone(report) as { gate: { subverdict_reclassification: Record<string, unknown> } };
  delete missing.gate.subverdict_reclassification.original_falsification;
  assert.equal(validateAgainstSchema('gate-report', missing, packageRoot()).valid, false);

  const forgedBasis = structuredClone(report) as { gate: { subverdict_reclassification: Record<string, unknown> } };
  forgedBasis.gate.subverdict_reclassification.basis = 'blocking_count_zero';
  assert.equal(validateAgainstSchema('gate-report', forgedBasis, packageRoot()).valid, false);
});

test('validateAgainstSchema: 実物の config/agent-skill-chain.yaml をそのまま渡すとvalidになる', () => {
  const configPath = resolveAsset(path.join('config', 'agent-skill-chain.yaml'));
  const config = readYamlFile(configPath);
  const outcome = validateAgainstSchema('config', config);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

// ISSUE-307 SPEC.md AC-4, AC-5: config スキーマの worker.segment_overrides・worker.model_tiers が
// 新旧両形式を許容し、未知のアダプタ名・未知のティア名・未知のセグメント名・未知のキーを拒否する
// こと。ティア対応表のモデル値は固定値ではなく通常の文字列として検証されること。
//
// このリポジトリ自身をdogfooding worktree（.worktrees/配下）から実行する場合、
// resolveAsset()の既定root（repoRoot()）はcommon .gitディレクトリ経由でメイン作業ツリーへ
// 解決される（ADR-0004）ため、素の loadSchemaDoc('config')/validateAgainstSchema('config', x)
// はこのworktreeでの変更を反映しない。ここでは他のテスト（stateのcore_auditテスト）と同様に
// packageRoot()（このモジュールが実際に実行されている場所＝このworktree）を明示的なrootとして
// 渡し、このworktreeで変更したスキーマ定義を確実に対象にする。
function loadConfigSchemaDoc(): SchemaDoc {
  const filePath = resolveAsset(path.join('schemas', 'config.schema.yaml'), packageRoot());
  return readYamlFile<SchemaDoc>(filePath);
}
function validateConfig(data: unknown) {
  return validateAgainstSchema('config', data, packageRoot());
}

test("validateAgainstSchema('config') (AC-4): examples[1]（segment_overrides・model_tiersを含む新形式）はvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  assert.ok(doc.examples.length >= 2, 'config.schema.yaml のexamplesに新形式（segment_overrides・model_tiers）が無い');
  const outcome = validateConfig(doc.examples[1]);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (AC-4): worker.adapterのみのスカラー旧形式（examples[0]）は引き続きvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const oldWorker = (doc.examples[0] as { worker: Record<string, unknown> }).worker;
  assert.ok(!('segment_overrides' in oldWorker) && !('model_tiers' in oldWorker));
  const outcome = validateConfig(doc.examples[0]);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (AC-4): ティア対応表のモデル値を別の文字列へ変更してもスキーマ変更無しでvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const changed = structuredClone(doc.examples[1]) as { worker: { model_tiers: Record<string, Record<string, string>> } };
  changed.worker.model_tiers.highest_capability.codex = 'gpt-9.9-future-model';
  const outcome = validateConfig(changed);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (AC-4): 未知のadapter名を持つsegment_overridesはinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.implementation = { adapter: 'gpt5' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): 未知のmodel_tier名はinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.implementation = { adapter: 'codex', model_tier: 'super_ultra' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): highを超える旧値と未知のreasoning_effort名はinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  for (const effort of ['xhigh', 'maximum_reasoning', 'ultra']) {
    const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
    broken.worker.segment_overrides.implementation = { adapter: 'codex', reasoning_effort: effort };
    const outcome = validateConfig(broken);
    assert.equal(outcome.valid, false, `${effort} はinvalidであること`);
    assert.ok(outcome.errors.length > 0);
  }
});

test("validateAgainstSchema('config') (AC-4): 未知のセグメント名（4セグメント以外）はinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.review = { adapter: 'codex' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): segment_overrides内の未知キーはinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.implementation = { adapter: 'codex', unexpected_field: 'nope' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): model_tierを持つがadapterがcodexでない組合せはinvalidになる（黙って無視されない）", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.implementation = { adapter: 'claude', model_tier: 'highest_capability' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): reasoning_effortを持つがadapter未指定の組合せはinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  broken.worker.segment_overrides.implementation = { reasoning_effort: 'high' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): model_tiersの未知のティア名はinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { model_tiers: Record<string, unknown> } };
  broken.worker.model_tiers.super_ultra = { codex: 'x' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): model_tiersの未知のアダプタキーはinvalidになる（claude用モデルを本Issueで追加しない）", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { model_tiers: Record<string, Record<string, unknown>> } };
  broken.worker.model_tiers.highest_capability.claude = 'some-claude-model';
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): model_tiersのティアエントリにcodexキーが無い場合はinvalidになる（必須）", () => {
  const doc = loadConfigSchemaDoc();
  const broken = structuredClone(doc.examples[1]) as { worker: { model_tiers: Record<string, unknown> } };
  broken.worker.model_tiers.highest_capability = {};
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (AC-4): model_tier・reasoning_effortとadapter: codexの組合せはvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const ok = structuredClone(doc.examples[1]) as { worker: { segment_overrides: Record<string, unknown> } };
  ok.worker.segment_overrides.validation = { adapter: 'codex', model_tier: 'highest_capability', reasoning_effort: 'high' };
  const outcome = validateConfig(ok);
  assert.deepEqual(outcome, { valid: true, errors: [] });
});

// ADR-0023（Issue #503）AC-4/AC-7: profile（軽量プロファイルかどうかを機械的に判定する唯一の正本）。
test("validateAgainstSchema('config') (ADR-0023): profile: lightweight を持つconfigはvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const withProfile = { ...structuredClone(doc.examples[0]), profile: 'lightweight' };
  assert.deepEqual(validateConfig(withProfile), { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (ADR-0023): profileを持たないconfigは引き続きvalidになる（後方互換）", () => {
  const doc = loadConfigSchemaDoc();
  assert.ok(!('profile' in (doc.examples[0] as Record<string, unknown>)));
  assert.deepEqual(validateConfig(doc.examples[0]), { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (ADR-0023): profileが既知enum外の値だとinvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const broken = { ...structuredClone(doc.examples[0]), profile: 'ultra-light' };
  const outcome = validateConfig(broken);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.length > 0);
});

test("validateAgainstSchema('config') (ADR-0023): templates.claude_skills_source/claude_skills_targetを持つconfigはvalidになる", () => {
  const doc = loadConfigSchemaDoc();
  const withSkillsTemplate = structuredClone(doc.examples[0]) as { templates: Record<string, unknown> };
  withSkillsTemplate.templates.claude_skills_source = '.agent-skill-chain/templates/claude/skills';
  withSkillsTemplate.templates.claude_skills_target = '.claude/skills';
  assert.deepEqual(validateConfig(withSkillsTemplate), { valid: true, errors: [] });
});

test("validateAgainstSchema('config') (ISSUE-567 AC-3): examples[0]のissue_sync.enabledは新しい既定値trueと整合する", () => {
  const doc = loadConfigSchemaDoc();
  const example = doc.examples[0] as { issue_sync: { enabled: boolean } };
  assert.equal(example.issue_sync.enabled, true);
  assert.deepEqual(validateConfig(doc.examples[0]), { valid: true, errors: [] });
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
