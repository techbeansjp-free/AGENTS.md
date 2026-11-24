import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../src/summarize.mjs';

test('sums a single numeric column', () => {
  assert.match(summarize('a\n1\n2'), /a: /);
});

test('does not include the header row in totals', () => {
  assert.equal(summarize('a,b\n1,2\n3,4'), 'a: 4 (2)\nb: 6 (2)');
});

test('does not count a trailing empty line', () => {
  assert.equal(summarize('a\n1\n2\n'), 'a: 3 (2)');
});
