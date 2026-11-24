import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../src/summarize.mjs';

test('sums a single numeric column', () => {
  assert.match(summarize('a\n1\n2'), /a: /);
});

test('header row is excluded from totals (no NaN)', () => {
  const out = summarize('a,b\n1,2\n3,4');
  assert.equal(out, 'a: 4 (2)\nb: 6 (2)');
  assert.ok(!out.includes('NaN'));
});

test('trailing empty line is not counted', () => {
  assert.equal(summarize('a\n1\n2\n'), 'a: 3 (2)');
  assert.equal(summarize('a\n1\n2\n\n'), 'a: 3 (2)');
});
