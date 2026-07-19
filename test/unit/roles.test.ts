import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoles } from '../../src/lib/roles.js';

const EXPECTED_CONTRACTS = [
  'spec_worker',
  'design_worker',
  'implementation_worker',
  'validation_worker',
  'gate_reviewer',
  'adr_finalization_worker',
] as const;

test('loadRoles: 実物の .agent-skill-chain/config/roles.yaml を読み込む', () => {
  const roles = loadRoles();
  assert.equal(roles.schema_version, 'agent-skill-chain/config/v1');
  assert.ok(roles.role_contracts);
  assert.ok(roles.roles);
  assert.ok(roles.adapters);
  assert.equal(typeof roles.blocked_report_schema, 'string');
});

test('loadRoles: role_contracts に全必須ロールが存在する', () => {
  const roles = loadRoles();
  for (const role of EXPECTED_CONTRACTS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(roles.role_contracts, role),
      `role_contracts に ${role} が存在しません`,
    );
  }
});

test('loadRoles: 各 role_contract は inputs/outputs/rules/completion/forbidden を持つ', () => {
  const roles = loadRoles();
  for (const role of EXPECTED_CONTRACTS) {
    const contract = roles.role_contracts[role];
    assert.ok(Array.isArray(contract.inputs) && contract.inputs.length > 0, `${role}.inputs`);
    assert.ok(Array.isArray(contract.outputs) && contract.outputs.length > 0, `${role}.outputs`);
    assert.ok(Array.isArray(contract.rules) && contract.rules.length > 0, `${role}.rules`);
    assert.ok(Array.isArray(contract.completion) && contract.completion.length > 0, `${role}.completion`);
    assert.ok(Array.isArray(contract.forbidden) && contract.forbidden.length > 0, `${role}.forbidden`);
  }
});

test('loadRoles: adapters に claude/codex/human が定義されている', () => {
  const roles = loadRoles();
  assert.equal(roles.adapters.claude, '.agent-skill-chain/adapters/claude.sh');
  assert.equal(roles.adapters.codex, '.agent-skill-chain/adapters/codex.sh');
  assert.equal(roles.adapters.human, '.agent-skill-chain/adapters/human.sh');
});
