import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRulesetWithDedicatedApp } from '../../src/commands/setup.js';

const CHECKS = ['spec', 'design', 'implementation', 'validation']
  .map((gate) => `agent-skill-chain/${gate}-gate`);

function template(): object {
  return {
    name: 'main-protection',
    rules: [{
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [...CHECKS.map((context) => ({ context })), { context: 'verify' }],
      },
    }],
  };
}

test('四つのgate Checkだけを専用App sourceへ固定する', () => {
  const source = template();
  const rendered = renderRulesetWithDedicatedApp(source, '77') as {
    rules: { parameters: { required_status_checks: { context: string; integration_id?: number }[] } }[];
  };
  const checks = rendered.rules[0].parameters.required_status_checks;
  for (const name of CHECKS) {
    assert.deepEqual(checks.find((check) => check.context === name), { context: name, integration_id: 77 });
  }
  assert.deepEqual(checks.find((check) => check.context === 'verify'), { context: 'verify' });
  assert.notDeepEqual(rendered, source, '入力templateを破壊しないこと');
});

test('専用App未設定、Actions App、gate context欠損・重複を拒否する', () => {
  assert.throws(() => renderRulesetWithDedicatedApp(template(), undefined), /専用GitHub App ID/);
  assert.throws(() => renderRulesetWithDedicatedApp(template(), 15_368), /標準GitHub Actions App/);
  for (const checks of [
    CHECKS.slice(1).map((context) => ({ context })),
    [...CHECKS.map((context) => ({ context })), { context: CHECKS[0] }],
  ]) {
    const source = template() as {
      rules: { parameters: { required_status_checks: { context: string }[] } }[];
    };
    source.rules[0].parameters.required_status_checks = checks;
    assert.throws(() => renderRulesetWithDedicatedApp(source, 77), /定義が一意ではありません/);
  }
});
