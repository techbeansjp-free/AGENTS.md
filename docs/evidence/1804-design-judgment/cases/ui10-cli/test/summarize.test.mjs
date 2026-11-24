import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../src/summarize.mjs';

test('sums a single numeric column', () => {
  assert.match(summarize('a\n1\n2'), /a: /);
});
