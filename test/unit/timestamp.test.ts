import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatToRegex } from '../../src/lib/timestamp.js';

test('formatToRegex: config実物の形式 %Y%m%d_%H%M%S に一致する文字列を許容する', () => {
  const re = formatToRegex('%Y%m%d_%H%M%S');
  assert.match('20260719_064937', re);
});

test('formatToRegex: %Y%m%d_%H%M%S は桁数が異なる文字列を拒否する', () => {
  const re = formatToRegex('%Y%m%d_%H%M%S');
  assert.doesNotMatch('202607_1906493', re); // 桁配置が崩れている
  assert.doesNotMatch('2026719_064937', re); // 月日が1桁少ない
  assert.doesNotMatch('20260719_06493', re); // 秒が1桁少ない
});

test('formatToRegex: 全トークンが数字以外だと一致しない', () => {
  const re = formatToRegex('%Y%m%d_%H%M%S');
  assert.doesNotMatch('2026071a_064937', re);
});

test('formatToRegex: 単一トークンのみのフォーマット', () => {
  const re = formatToRegex('%Y');
  assert.match('2026', re);
  assert.doesNotMatch('202', re);
  assert.doesNotMatch('20266', re);
});

test('formatToRegex: リテラル文字（ドット）を含むフォーマットはエスケープされる', () => {
  const re = formatToRegex('%Y.%m.%d');
  assert.match('2026.07.19', re);
  // ドットは正規表現の「任意の1文字」ではなく、リテラルのドットとしてのみ一致する
  assert.doesNotMatch('2026X07X19', re);
  assert.doesNotMatch('2026-07-19', re);
});

test('formatToRegex: 正規表現特殊文字を含むリテラルが全てエスケープされる', () => {
  const re = formatToRegex('%Y[%m]{%d}');
  assert.match('2026[07]{19}', re);
  assert.doesNotMatch('2026007019', re);
  assert.doesNotMatch('2026X07X19', re);
});

test('formatToRegex: トークンを含まない純粋なリテラルはそのまま一致する', () => {
  const re = formatToRegex('static-prefix');
  assert.match('static-prefix', re);
  assert.doesNotMatch('static-prefixX', re);
  assert.doesNotMatch('Xstatic-prefix', re);
});

test('formatToRegex: 空文字列フォーマットは空文字列のみに一致する', () => {
  const re = formatToRegex('');
  assert.match('', re);
  assert.doesNotMatch('a', re);
});

test('formatToRegex: 前後にリテラルを伴うトークン組み合わせ', () => {
  const re = formatToRegex('run_%Y%m%d.log');
  assert.match('run_20260719.log', re);
  assert.doesNotMatch('run_20260719Xlog', re);
  assert.doesNotMatch('run_2026071.log', re);
});

test('formatToRegex: アンカーにより部分一致ではなく完全一致のみを許容する', () => {
  const re = formatToRegex('%Y%m%d');
  assert.doesNotMatch('prefix20260719', re);
  assert.doesNotMatch('20260719suffix', re);
  assert.match('20260719', re);
});

test('formatToRegex: 未知のトークン風文字列（%が単独）はリテラルとして扱われる', () => {
  const re = formatToRegex('%Y%z');
  // %z は TOKEN_PATTERNS に存在しないため、'%' と 'z' が個別のリテラル文字として扱われる
  assert.match('2026%z', re);
  assert.doesNotMatch('2026zz', re);
});

test('formatToRegex: 同じトークンを複数回含むフォーマット', () => {
  const re = formatToRegex('%H:%M:%S-%H:%M:%S');
  assert.match('06:49:37-06:49:37', re);
  assert.doesNotMatch('06:49:37', re);
});
