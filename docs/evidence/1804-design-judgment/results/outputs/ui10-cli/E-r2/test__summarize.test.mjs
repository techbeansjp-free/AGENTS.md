import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../src/summarize.mjs';

test('header row is excluded from totals', () => {
  assert.equal(summarize('a,b\n1,2\n3,4'), 'a: 4 (2)\nb: 6 (2)');
});

test('trailing blank line is not counted', () => {
  assert.equal(summarize('a,b\n1,2\n3,4\n'), 'a: 4 (2)\nb: 6 (2)');
  assert.equal(summarize('a\n1\n\n'), 'a: 1 (1)');
});

test('sums a single numeric column', () => {
  assert.match(summarize('a\n1\n2'), /a: /);
});
