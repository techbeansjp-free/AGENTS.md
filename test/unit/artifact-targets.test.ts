import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveArtifactTargets } from '../../src/lib/artifact-targets.js';
import type { Segment } from '../../src/lib/issue.js';

const ORDER: Segment[] = ['spec', 'design', 'implementation', 'validation'];

test('deriveArtifactTargets: Sが空ならRも空になる', () => {
  assert.deepEqual(deriveArtifactTargets([], ORDER, true), []);
});

test('deriveArtifactTargets: 閉包追加無効なら連鎖順序を使わずRをSと等しくする', () => {
  assert.deepEqual(deriveArtifactTargets(['validation', 'spec'], [], false), [
    { segment: 'validation', addedByClosure: false },
    { segment: 'spec', addedByClosure: false },
  ]);
});

test('deriveArtifactTargets: 最下流の開始済み要素より上流のspec/designだけを閉包追加する', () => {
  assert.deepEqual(deriveArtifactTargets(['implementation', 'validation'], ORDER, true), [
    { segment: 'spec', addedByClosure: true },
    { segment: 'design', addedByClosure: true },
    { segment: 'implementation', addedByClosure: false },
    { segment: 'validation', addedByClosure: false },
  ]);
});

test('deriveArtifactTargets: 文書のみの主経路ではimplementationを閉包追加しない', () => {
  assert.deepEqual(deriveArtifactTargets(['spec', 'design', 'validation'], ORDER, true), [
    { segment: 'spec', addedByClosure: false },
    { segment: 'design', addedByClosure: false },
    { segment: 'validation', addedByClosure: false },
  ]);
});

test('deriveArtifactTargets: Sの要素が連鎖順序に無ければ判定不能として例外にする', () => {
  assert.throws(
    () => deriveArtifactTargets(['validation'], ['spec', 'design', 'implementation'], true),
    /開始済みセグメントが連鎖順序に存在しません: validation/,
  );
});
