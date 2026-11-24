// Hidden oracle for P2 (not visible to the measured session). Each test name starts with the work unit.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('money: construct and add', async () => {
  const { money, add } = await import('../src/money.mjs');
  const a = money(150, 'USD');
  assert.deepStrictEqual({ ...a }, { minor: 150, currency: 'USD' });
  assert.ok(Object.isFrozen(a));
  assert.deepStrictEqual({ ...add(a, money(-50, 'USD')) }, { minor: 100, currency: 'USD' });
  assert.throws(() => add(a, money(1, 'EUR')), TypeError);
  assert.throws(() => money(1.5, 'USD'), TypeError);
  assert.throws(() => money(1, 'GBP'), RangeError);
});
test('money: multiply half-even', async () => {
  const { money, multiply } = await import('../src/money.mjs');
  assert.strictEqual(multiply(money(5, 'USD'), 0.5).minor, 2);
  assert.strictEqual(multiply(money(7, 'USD'), 0.5).minor, 4);
  assert.strictEqual(multiply(money(-5, 'USD'), 0.5).minor, -2);
  assert.strictEqual(multiply(money(1000, 'JPY'), 0.08).minor, 80);
  assert.strictEqual(multiply(money(333, 'USD'), 0.1).minor, 33);
});
test('money: allocate', async () => {
  const { money, allocate } = await import('../src/money.mjs');
  assert.deepStrictEqual(allocate(money(100, 'USD'), [1, 1, 1]).map((m) => m.minor), [34, 33, 33]);
  assert.deepStrictEqual(allocate(money(5, 'USD'), [3, 7]).map((m) => m.minor), [2, 3]);
  assert.deepStrictEqual(allocate(money(10, 'USD'), [1, 0, 2]).map((m) => m.minor), [3, 0, 7]);
  assert.deepStrictEqual(allocate(money(2, 'JPY'), [1, 1, 1]).map((m) => m.minor), [1, 1, 0]);
  assert.throws(() => allocate(money(-1, 'USD'), [1]), RangeError);
  assert.throws(() => allocate(money(1, 'USD'), [0, 0]), RangeError);
  assert.throws(() => allocate(money(1, 'USD'), [1, -1]), RangeError);
});
test('money: format', async () => {
  const { money, format } = await import('../src/money.mjs');
  assert.strictEqual(format(money(123456, 'USD')), 'USD 1,234.56');
  assert.strictEqual(format(money(1234567, 'JPY')), 'JPY 1,234,567');
  assert.strictEqual(format(money(1234, 'KWD')), 'KWD 1.234');
  assert.strictEqual(format(money(-5, 'USD')), 'USD -0.05');
  assert.strictEqual(format(money(0, 'EUR')), 'EUR 0.00');
  assert.strictEqual(format(money(-123456789, 'JPY')), 'JPY -123,456,789');
});

const usesMoney = (f) => /from\s+["']\.\/money\.mjs["']/.test(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'));
test('invoice: totals', async () => {
  const { invoiceTotal } = await import('../src/invoice.mjs');
  const r = invoiceTotal([{ unitMinor: 1999, qty: 3, currency: 'USD' }, { unitMinor: 1, qty: 5, currency: 'USD' }], 10);
  assert.deepStrictEqual([r.subtotal.minor, r.tax.minor, r.total.minor, r.total.currency], [6002, 600, 6602, 'USD']);
  const h = invoiceTotal([{ unitMinor: 25, qty: 1, currency: 'USD' }], 10);
  assert.deepStrictEqual([h.tax.minor, h.total.minor], [2, 27]);
  assert.throws(() => invoiceTotal([], 10), RangeError);
  assert.throws(() => invoiceTotal([{ unitMinor: 1, qty: 0, currency: 'USD' }], 10), RangeError);
  assert.throws(() => invoiceTotal([{ unitMinor: 1, qty: 1.5, currency: 'USD' }], 10), RangeError);
  assert.throws(() => invoiceTotal([{ unitMinor: 1, qty: 1, currency: 'USD' }, { unitMinor: 1, qty: 1, currency: 'EUR' }], 10), TypeError);
  assert.ok(usesMoney('invoice.mjs'));
});
test('split: bill', async () => {
  const { splitBill } = await import('../src/split.mjs');
  const { money } = await import('../src/money.mjs');
  assert.deepStrictEqual(splitBill(money(1000, 'USD'), 3).map((m) => m.minor), [334, 333, 333]);
  assert.deepStrictEqual(splitBill(money(1, 'JPY'), 2).map((m) => [m.minor, m.currency]), [[1, 'JPY'], [0, 'JPY']]);
  for (const n of [0, -1, 1.5]) assert.throws(() => splitBill(money(1, 'USD'), n), RangeError);
  assert.ok(usesMoney('split.mjs'));
});
test('report: summarize', async () => {
  const { summarize } = await import('../src/report.mjs');
  const { money } = await import('../src/money.mjs');
  const r = summarize([money(150, 'USD'), money(1000, 'JPY'), money(-50, 'USD'), money(1, 'EUR')]);
  assert.deepStrictEqual(Object.entries(r), [['EUR', 'EUR 0.01'], ['JPY', 'JPY 1,000'], ['USD', 'USD 1.00']]);
  assert.deepStrictEqual(summarize([]), {});
  assert.ok(usesMoney('report.mjs'));
});
