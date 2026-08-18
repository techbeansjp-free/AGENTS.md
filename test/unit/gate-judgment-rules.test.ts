import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactPresentation,
  determineJudgmentAxis,
  gateLaunchAbortReason,
} from '../../src/lib/gate-judgment-rules.js';

const present = { status: 'present' as const, path: 'DESIGN.md', content: 'design' };
const absent = { status: 'absent' as const, path: 'PLAN.md' };
const unreadable = { status: 'unreadable' as const, path: 'PLAN.md', reason: 'failure' };

test('ISSUE-733 AC-4〜AC-8・AC-19: 判定軸決定表の全行を排他的に導出する', () => {
  const cases: (Parameters<typeof determineJudgmentAxis>[0] & {
    expected: ReturnType<typeof determineJudgmentAxis>;
  })[] = [
    { exempt: true, artifactStatus: 'present' as const, acIds: { status: 'present' as const, ids: ['AC-1'] }, alternativeAvailable: false, expected: 'ac_coverage' },
    { exempt: true, artifactStatus: 'unreadable' as const, acIds: { status: 'present' as const, ids: ['AC-1'] }, alternativeAvailable: true, expected: 'ac_coverage' },
    { exempt: true, artifactStatus: 'absent' as const, acIds: { status: 'present' as const, ids: ['AC-1'] }, alternativeAvailable: true, expected: 'alternative' },
    { exempt: true, artifactStatus: 'absent' as const, acIds: { status: 'present' as const, ids: ['AC-1'] }, alternativeAvailable: false, expected: 'inconclusive' },
    { exempt: true, artifactStatus: 'present' as const, acIds: { status: 'empty' as const, ids: [] }, alternativeAvailable: true, expected: 'alternative' },
    { exempt: true, artifactStatus: 'unreadable' as const, acIds: { status: 'empty' as const, ids: [] }, alternativeAvailable: false, expected: 'inconclusive' },
    { exempt: false, artifactStatus: 'absent' as const, acIds: { status: 'present' as const, ids: ['AC-1'] }, alternativeAvailable: true, expected: 'ac_coverage' },
    { exempt: false, artifactStatus: 'present' as const, acIds: { status: 'empty' as const, ids: [] }, alternativeAvailable: true, expected: 'inconclusive' },
    { exempt: true, artifactStatus: 'absent' as const, acIds: { status: 'unreadable' as const, ids: [] }, alternativeAvailable: true, expected: 'inconclusive' },
    { exempt: false, artifactStatus: 'unreadable' as const, acIds: { status: 'unreadable' as const, ids: [] }, alternativeAvailable: false, expected: 'inconclusive' },
  ];
  for (const testCase of cases) {
    assert.equal(determineJudgmentAxis(testCase), testCase.expected, JSON.stringify(testCase));
  }
});

test('ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する', () => {
  for (const exempt of [true, false]) {
    assert.equal(artifactPresentation(present, exempt), 'content');
    assert.equal(artifactPresentation(unreadable, exempt), 'unreadable');
  }
  assert.equal(artifactPresentation(absent, true), 'exempt_absent');
  assert.equal(artifactPresentation(absent, false), 'missing');

  assert.equal(gateLaunchAbortReason([], true), undefined);
  assert.equal(gateLaunchAbortReason([], false), undefined);
  assert.equal(gateLaunchAbortReason([present], true), undefined);
  assert.equal(gateLaunchAbortReason([present], false), undefined);
  assert.equal(gateLaunchAbortReason([present, absent], true), undefined);
  assert.match(gateLaunchAbortReason([present, absent], false) ?? '', /必須成果物/);
  assert.match(gateLaunchAbortReason([present, unreadable], true) ?? '', /取得できません/);
  assert.match(gateLaunchAbortReason([present, unreadable], false) ?? '', /取得できません/);
  assert.match(gateLaunchAbortReason([absent, unreadable], true) ?? '', /取得できません/);
  assert.match(gateLaunchAbortReason([absent, unreadable], false) ?? '', /取得できません/);
});
