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
