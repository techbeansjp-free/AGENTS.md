// Hidden oracle for UI-10 (kept outside the fixture). Run against a trial's src/summarize.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
const {summarize} = await import(process.env.TARGET);
test('header row is not summed', () => { assert.equal(summarize('a,b\n1,2\n3,4'), 'a: 4 (2)\nb: 6 (2)'); });
test('trailing blank line is not counted', () => { assert.equal(summarize('a\n1\n2\n'), 'a: 3 (2)'); });
test('output format unchanged for single column', () => { assert.equal(summarize('x\n5'), 'x: 5 (1)'); });
