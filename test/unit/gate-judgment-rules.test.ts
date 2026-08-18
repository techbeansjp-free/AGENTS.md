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

test('判定軸: quick免除下の正当な不在は代替判定基準へ切り替わる', () => {
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'absent',
    acIds: { status: 'present', ids: ['AC-1'] },
    alternativeAvailable: true,
  }), 'alternative');
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'present',
    acIds: { status: 'empty', ids: [] },
    alternativeAvailable: true,
  }), 'alternative');
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'absent',
    acIds: { status: 'present', ids: ['AC-1'] },
    alternativeAvailable: false,
  }), 'inconclusive');
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'present',
    acIds: { status: 'empty', ids: [] },
    alternativeAvailable: false,
  }), 'inconclusive');
});

test('判定軸: 免除不成立の主経路と抽出不能は安全側を維持する', () => {
  assert.equal(determineJudgmentAxis({
    exempt: false,
    artifactStatus: 'present',
    acIds: { status: 'present', ids: ['AC-1'] },
    alternativeAvailable: true,
  }), 'ac_coverage');
  assert.equal(determineJudgmentAxis({
    exempt: false,
    artifactStatus: 'present',
    acIds: { status: 'empty', ids: [] },
    alternativeAvailable: true,
  }), 'inconclusive');
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'absent',
    acIds: { status: 'unreadable', ids: [] },
    alternativeAvailable: true,
  }), 'inconclusive');
  assert.equal(determineJudgmentAxis({
    exempt: true,
    artifactStatus: 'unreadable',
    acIds: { status: 'present', ids: ['AC-1'] },
    alternativeAvailable: true,
  }), 'ac_coverage');
});

test('成果物提示と起動中断は不在・読み取り不能を混同しない', () => {
  assert.equal(artifactPresentation(present, true), 'content');
  assert.equal(artifactPresentation(absent, true), 'exempt_absent');
  assert.equal(artifactPresentation(absent, false), 'missing');
  assert.equal(artifactPresentation(unreadable, true), 'unreadable');
  assert.equal(gateLaunchAbortReason([present, absent], true), undefined);
  assert.match(gateLaunchAbortReason([present, absent], false) ?? '', /必須成果物/);
  assert.match(gateLaunchAbortReason([absent, unreadable], true) ?? '', /取得できません/);
});
