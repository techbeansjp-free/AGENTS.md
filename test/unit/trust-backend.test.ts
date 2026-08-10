import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDedicatedAppId,
  resolveDedicatedAppBackend,
  resolveDedicatedAppBackendFromApi,
  type RepositoryRuleset,
} from '../../src/lib/trust-backend.js';

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

test('専用App IDは文字列を受理し、未設定・不正・標準Actions Appを拒否する', () => {
  assert.equal(parseDedicatedAppId('77'), 77);
  for (const value of [undefined, '', '0', '01', '1.5', 0, 15_368]) {
    assert.throws(() => parseDedicatedAppId(value), /専用GitHub App ID/);
  }
});

// ISSUE-537: 拒否時のエラーメッセージへ、専用App作成・installation手順を記したrunbookへの
// 参照を含めたため、その文言が実際にエラーメッセージへ含まれることを実測する。
test('専用App ID拒否時のエラーメッセージはASC_GATE_APP_ID_RUNBOOK.mdへの参照を含む', () => {
  for (const value of [undefined, 15_368]) {
    assert.throws(() => parseDedicatedAppId(value), /docs\/ASC_GATE_APP_ID_RUNBOOK\.md/);
  }
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

test('API一覧はpaginationし、個別取得したruleset詳細だけでbackendを解決する', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, rules: [] }));
  const calls: string[] = [];
  const backend = await resolveDedicatedAppBackendFromApi({
    appId: 77,
    checkNames: CHECKS,
    reader: {
      async list(page, perPage) {
        calls.push(`list:${page}:${perPage}`);
        return page === 1 ? firstPage : [{ id: 101 }];
      },
      async get(id) {
        calls.push(`get:${id}`);
        return id === 101 ? ruleset({ id }) : ruleset({ id, enforcement: 'disabled' });
      },
    },
  });
  assert.deepEqual(backend, { kind: 'dedicated_app', appId: 77, rulesetIds: [101] });
  assert.deepEqual(calls.slice(0, 2), ['list:1:100', 'list:2:100']);
  assert.equal(calls.filter((call) => call.startsWith('get:')).length, 101);
});

test('API rulesetの欠損・重複・詳細ID不一致をfail-closedで拒否する', async () => {
  for (const reader of [
    {
      async list() { return { id: 1 }; },
      async get() { return ruleset({ id: 1 }); },
    },
    {
      async list() { return [{ id: 1 }, { id: 1 }]; },
      async get() { return ruleset({ id: 1 }); },
    },
    {
      async list() { return [{ id: 1 }]; },
      async get() { return ruleset({ id: 2 }); },
    },
  ]) {
    await assert.rejects(
      resolveDedicatedAppBackendFromApi({ appId: 77, checkNames: CHECKS, reader }),
      /ruleset/,
    );
  }
});
