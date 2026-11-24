// Hidden oracle for P1/P3 (not visible to the measured session). Each test name starts with the work unit.
import test from 'node:test';
import assert from 'node:assert';

test('csv: parse basics', async () => {
  const { parseCsv } = await import('../src/csv.mjs');
  assert.deepStrictEqual(parseCsv(''), []);
  assert.deepStrictEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCsv('a\n\nb'), [['a'], [''], ['b']]);
  assert.deepStrictEqual(parseCsv('a,,b'), [['a', '', 'b']]);
  assert.deepStrictEqual(parseCsv(','), [['', '']]);
});
test('csv: quoted fields', async () => {
  const { parseCsv } = await import('../src/csv.mjs');
  assert.deepStrictEqual(parseCsv('"a,b","c""d"\n"x\ny",z'), [['a,b', 'c"d'], ['x\ny', 'z']]);
  assert.deepStrictEqual(parseCsv('"",x'), [['', 'x']]);
  assert.deepStrictEqual(parseCsv('"a\r\nb"'), [['a\r\nb']]);
});
test('csv: errors', async () => {
  const { parseCsv } = await import('../src/csv.mjs');
  assert.throws(() => parseCsv('"abc'), SyntaxError);
  assert.throws(() => parseCsv('ab"c'), SyntaxError);
  assert.throws(() => parseCsv('"ab"c'), SyntaxError);
});
test('csv: stringify round trip', async () => {
  const { parseCsv, stringifyCsv } = await import('../src/csv.mjs');
  assert.strictEqual(stringifyCsv([['a', 'b,c'], ['d"e', 'f\ng']]), 'a,"b,c"\n"d""e","f\ng"');
  assert.strictEqual(stringifyCsv([['x', '']]), 'x,');
  const rows = [['1', '"q"', 'a,b'], ['', 'line\r\nbreak', 'z']];
  assert.deepStrictEqual(parseCsv(stringifyCsv(rows)), rows);
});

test('duration: parse', async () => {
  const { parseDuration } = await import('../src/duration/index.mjs');
  assert.strictEqual(parseDuration('45s'), 45);
  assert.strictEqual(parseDuration('1h30m'), 5400);
  assert.strictEqual(parseDuration('2d4h'), 187200);
  assert.strictEqual(parseDuration('1.5h'), 5400);
  assert.strictEqual(parseDuration('0s'), 0);
  assert.strictEqual(parseDuration('1d2h3m4s'), 93784);
  assert.strictEqual(parseDuration('0.5s'), 1);
  assert.strictEqual(parseDuration('0.01m'), 1);
});
test('duration: parse errors', async () => {
  const { parseDuration } = await import('../src/duration/index.mjs');
  for (const s of ['', '1h1h', '1m1h', 'h', '1.h', ' 1h', '1h ', '-1h', '1x', '1', '1.5', '+1s', '1 h']) assert.throws(() => parseDuration(s), RangeError, s);
});
test('duration: format', async () => {
  const { formatDuration } = await import('../src/duration/index.mjs');
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(93784), '1d2h3m4s');
  assert.strictEqual(formatDuration(3600), '1h');
  assert.strictEqual(formatDuration(86401), '1d1s');
  for (const v of [-1, 1.5, Number.NaN, 2 ** 53]) assert.throws(() => formatDuration(v), RangeError);
});

test('semver: compare', async () => {
  const { compareSemver } = await import('../src/semver.mjs');
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i + 1 < order.length; i++) { assert.strictEqual(compareSemver(order[i], order[i + 1]), -1, order[i]); assert.strictEqual(compareSemver(order[i + 1], order[i]), 1, order[i]); }
  assert.strictEqual(compareSemver('1.0.0+a', '1.0.0+b'), 0);
  assert.strictEqual(compareSemver('2.10.0', '2.9.9'), 1);
  for (const v of ['1.0', '01.0.0', '1.0.0-01', 'a.b.c', '1.0.0-']) assert.throws(() => compareSemver(v, '1.0.0'), TypeError, v);
});
test('semver: satisfies', async () => {
  const { satisfies } = await import('../src/semver.mjs');
  const yes = [['1.2.3', '1.2.3'], ['1.9.9', '^1.2.3'], ['0.2.9', '^0.2.3'], ['0.0.3', '^0.0.3'], ['1.2.9', '~1.2.3'], ['1.5.0', '>=1.0.0 <2.0.0'], ['3.0.0', '^1.0.0 || >=3.0.0'], ['1.2.4-beta', '>=1.2.4-alpha'], ['1.2.3', '=1.2.3'], ['1.2.4', '>1.2.3'], ['1.2.3', '<=1.2.3']];
  const no = [['2.0.0', '^1.2.3'], ['0.3.0', '^0.2.3'], ['0.0.4', '^0.0.3'], ['1.3.0', '~1.2.3'], ['1.3.0-beta', '^1.2.3'], ['2.0.0-alpha', '<2.0.0'], ['1.2.5-beta', '>=1.2.4-alpha'], ['2.5.0', '^1.0.0 || >=3.0.0'], ['1.2.3', '<1.2.3']];
  for (const [v, r] of yes) assert.strictEqual(satisfies(v, r), true, `${v} ${r}`);
  for (const [v, r] of no) assert.strictEqual(satisfies(v, r), false, `${v} ${r}`);
});
test('semver: maxSatisfying', async () => {
  const { maxSatisfying } = await import('../src/semver.mjs');
  assert.strictEqual(maxSatisfying(['1.2.3', '1.10.0', '1.9.0', '2.0.0'], '^1.2.0'), '1.10.0');
  assert.strictEqual(maxSatisfying(['1.0.0', '1.1.0-rc.1'], '^1.0.0'), '1.0.0');
  assert.strictEqual(maxSatisfying(['0.1.0'], '^1.0.0'), null);
});
