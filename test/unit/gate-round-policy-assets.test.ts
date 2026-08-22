import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('gate-review skill (AC-1〜AC-8): 既定予算・宣言・4類型・追跡・fallbackを配布する', () => {
  const skill = fs.readFileSync(
    path.join(process.cwd(), '.agent-skill-chain', 'templates', 'claude', 'skills', 'gate-review', 'SKILL.md'),
    'utf8',
  );
  for (const fragment of [
    '初回をround 0',
    '最終round 4、最大5回',
    'gate-declare-final-round.sh',
    '既出blocking未是正',
    'Issue目的の直接阻害',
    'test/build失敗または回帰',
    'データ喪失またはセキュリティ低下',
    '元/分類後severity',
    'raw evidence',
    'follow-up',
    'human_required',
    '通常のblocking差し戻し',
  ]) assert.match(skill, new RegExp(fragment), fragment);
  assert.match(skill, /round導出元には使わない/);
  assert.match(skill, /Strict固定・quick境界はroundを理由に減らさない/);
});

// Issue #786 / AC-6: 「ラウンド値を解決できない経路は有限性保証の対象外」という条項は、
// 進行役契約（skill）とrole contractの双方に現れなければAC-6のThenを満たさない。
// 通常差し戻しfallbackの記述だけでは、その経路の差し戻し回数が無制限であることが配布先に届かない。
test('AC-6: ラウンド値を解決できない経路が有限性保証の対象外であることを配布契約が明示する', () => {
  const root = process.cwd();
  const skill = fs.readFileSync(
    path.join(root, '.agent-skill-chain', 'templates', 'claude', 'skills', 'gate-review', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /解決できない経路は本予算の対象外であり、差し戻し回数の有限性を保証しない/);
  assert.match(skill, /この経路は差し戻し回数の有限性保証の対象外として扱う/);

  const roles = fs.readFileSync(path.join(root, '.agent-skill-chain', 'config', 'roles.yaml'), 'utf8');
  assert.equal((roles.match(/差し戻し回数の有限性保証の対象外/g) ?? []).length, 5);

  const gate = fs.readFileSync(path.join(root, 'src', 'commands', 'gate.ts'), 'utf8');
  assert.match(gate, /通常差し戻しfallbackを維持し、この経路は差し戻し回数の有限性保証の対象外です/);
});

// Issue #786: 分類recordの適用後に blocking 0件を根拠として判定値を直接代入すると、
// レビュアの inconclusive/fail が消えて approved が確定する。gate コマンド側で
// 集約結果の final/inconclusive を approve 側へ代入する経路を残さない。
test('AC-6: gateコマンドは集約済み判定をapprove側へ直接代入しない', () => {
  const gate = fs.readFileSync(path.join(process.cwd(), 'src', 'commands', 'gate.ts'), 'utf8');
  assert.doesNotMatch(gate, /\.final = 'approved'/);
  assert.doesNotMatch(gate, /\.inconclusive = false/);
  assert.doesNotMatch(gate, /\.conformance = 'pass'/);
  assert.doesNotMatch(gate, /\.falsification = 'pass'/);
});
