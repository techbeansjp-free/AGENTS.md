import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPattern } from '../../src/lib/pattern.js';

test('expandPattern: すべての変数を展開する', () => {
  const result: string = expandPattern('{type}/{issue_id}-{slug}', { type: 'feature', issue_id: '42', slug: 'foo-bar' });
  assert.equal(result, 'feature/42-foo-bar');
});

test('expandPattern: 未指定の変数があると例外を投げる', () => {
  assert.throws(() => expandPattern('{type}/{slug}', { type: 'feature' }), /slug/);
});

test('expandPattern: 変数を含まないパターンはそのまま返す', () => {
  assert.equal(expandPattern('static', {}), 'static');
});
