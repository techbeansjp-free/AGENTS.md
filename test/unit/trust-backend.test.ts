import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDedicatedAppBackend, type RepositoryRuleset } from '../../src/lib/trust-backend.js';

const CHECKS = ['spec', 'design', 'implementation', 'validation']
  .map((gate) => `agent-skill-chain/${gate}-gate`);

function ruleset(overrides: Partial<RepositoryRuleset> = {}): RepositoryRuleset {
  return {
    id: 42,
    name: 'agent-skill-chain-gate-v1',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [{
      type: 'required_status_checks',
      parameters: {
        required_status_checks: CHECKS.map((context) => ({ context, integration_id: 77 })),
      },
    }],
    ...overrides,
  };
}

test('mainの全gate contextが専用Appへ固定されたactive rulesetを解決する', () => {
  assert.deepEqual(
    resolveDedicatedAppBackend({ appId: 77, checkNames: CHECKS, rulesets: [ruleset({ id: 9 }), ruleset()] }),
    { kind: 'dedicated_app', appId: 77, rulesetIds: [9, 42] },
  );
});

test('標準Actions App、inactive、別App、一部context不足、main非対象を拒否する', () => {
  assert.throws(
    () => resolveDedicatedAppBackend({ appId: 15_368, checkNames: CHECKS, rulesets: [ruleset()] }),
    /標準GitHub Actions App/,
  );
  for (const invalid of [
    ruleset({ enforcement: 'disabled' }),
    ruleset({
      rules: [{
        type: 'required_status_checks',
        parameters: { required_status_checks: CHECKS.map((context) => ({ context, integration_id: 88 })) },
      }],
    }),
    ruleset({
      rules: [{
        type: 'required_status_checks',
        parameters: { required_status_checks: CHECKS.slice(1).map((context) => ({ context, integration_id: 77 })) },
      }],
    }),
    ruleset({ conditions: { ref_name: { include: ['refs/heads/develop'], exclude: [] } } }),
  ]) {
    assert.throws(
      () => resolveDedicatedAppBackend({ appId: 77, checkNames: CHECKS, rulesets: [invalid] }),
      /active ruleset/,
    );
  }
});

test('同名Checkがsource未固定の旧rulesetだけではtrust backendにならない', () => {
  const unscoped = ruleset({
    rules: [{
      type: 'required_status_checks',
      parameters: { required_status_checks: CHECKS.map((context) => ({ context })) },
    }],
  });
  assert.throws(
    () => resolveDedicatedAppBackend({ appId: 77, checkNames: CHECKS, rulesets: [unscoped] }),
    /専用App source/,
  );
});

