import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GhJsonParseError,
  parseGhArrayResponse,
  parseGhObjectResponse,
  splitGhJsonDocuments,
} from '../../src/lib/gh-json.js';

// Issue #774: gh の一覧応答は取得先と gh のバージョンで 3 つの出力形を取る。
//   (i)   単一の JSON 文書
//   (ii)  空白区切りで連結された複数の JSON 文書
//   (iii) 各ページを要素とする配列（gh 2.63.0 以降のページ一括オプションが返す形）
// いずれからも同一の要素集合が得られること、および解釈できない出力を空の一覧へ倒さないことを検証する。

const REVIEWS = [
  { id: 1, body: 'first' },
  { id: 2, body: 'second' },
  { id: 3, body: 'third' },
];

test('gh-json: 配列応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す', () => {
  const flat = JSON.stringify(REVIEWS);
  const concatenated = `${JSON.stringify(REVIEWS.slice(0, 2))}\n${JSON.stringify(REVIEWS.slice(2))}`;
  const pages = JSON.stringify([REVIEWS.slice(0, 2), REVIEWS.slice(2)]);

  assert.deepEqual(parseGhArrayResponse(flat), REVIEWS);
  assert.deepEqual(parseGhArrayResponse(concatenated), REVIEWS);
  assert.deepEqual(parseGhArrayResponse(pages), REVIEWS);
});

test('gh-json: オブジェクト応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す', () => {
  const single = JSON.stringify({ check_runs: REVIEWS });
  const concatenated = [
    JSON.stringify({ check_runs: REVIEWS.slice(0, 1) }),
    JSON.stringify({ check_runs: REVIEWS.slice(1, 2) }),
    JSON.stringify({ check_runs: REVIEWS.slice(2) }),
  ].join('\n');
  const pages = JSON.stringify([
    { check_runs: REVIEWS.slice(0, 2) },
    { check_runs: REVIEWS.slice(2) },
  ]);

  assert.deepEqual(parseGhObjectResponse(single, 'check_runs'), REVIEWS);
  assert.deepEqual(parseGhObjectResponse(concatenated, 'check_runs'), REVIEWS);
  assert.deepEqual(parseGhObjectResponse(pages, 'check_runs'), REVIEWS);
});

test('gh-json: 実在する JSON 文書が空を示す場合だけ要素 0 件として成立する', () => {
  assert.deepEqual(parseGhArrayResponse('[]'), []);
  assert.deepEqual(parseGhArrayResponse('[[],[]]'), []);
  assert.deepEqual(parseGhObjectResponse('{"check_runs":[]}', 'check_runs'), []);
  assert.deepEqual(parseGhObjectResponse('[]', 'check_runs'), []);
  assert.deepEqual(parseGhObjectResponse('{"check_runs":[]}\n{"check_runs":[]}', 'check_runs'), []);
});

test('gh-json: 空・空白のみ・閉じていない断片・JSON でない文字列を空の一覧として扱わない', () => {
  for (const stdout of ['', '   ', '\n\t \n', '[{"id":1}', '{"check_runs":[', 'not json', 'null', '42']) {
    assert.throws(() => parseGhArrayResponse(stdout), GhJsonParseError, `配列応答: ${JSON.stringify(stdout)}`);
    assert.throws(
      () => parseGhObjectResponse(stdout, 'check_runs'),
      GhJsonParseError,
      `オブジェクト応答: ${JSON.stringify(stdout)}`,
    );
  }
});

test('gh-json: 文字列リテラル内の括弧・エスケープを含む連結文書を正しく分割する', () => {
  const noisy = [
    { id: 1, body: 'blockers: [{"code": "x"}] を含む本文\n} ] { [' },
    { id: 2, body: 'エスケープ済みの引用符 \\" と バックスラッシュ \\\\ と括弧 }' },
  ];
  const concatenated = `${JSON.stringify([noisy[0]])}\n${JSON.stringify([noisy[1]])}`;
  assert.equal(splitGhJsonDocuments(concatenated).length, 2);
  assert.deepEqual(parseGhArrayResponse(concatenated), noisy);

  const objectConcatenated =
    `${JSON.stringify({ check_runs: [noisy[0]] })} ${JSON.stringify({ check_runs: [noisy[1]] })}`;
  assert.deepEqual(parseGhObjectResponse(objectConcatenated, 'check_runs'), noisy);
});

test('gh-json: 配列と非配列が混在する応答は判別不能として解釈失敗にする', () => {
  assert.throws(() => parseGhArrayResponse('[{"id":1},[{"id":2}]]'), GhJsonParseError);
});

test('gh-json: 配列応答の文書が配列でない場合とオブジェクト応答のページが非オブジェクトの場合は解釈失敗にする', () => {
  assert.throws(() => parseGhArrayResponse('{"check_runs":[]}'), GhJsonParseError);
  assert.throws(() => parseGhObjectResponse('[[{"id":1}]]', 'check_runs'), GhJsonParseError);
});

test('gh-json: ページに当該属性が無い・配列でない場合は解釈失敗にする', () => {
  // GitHub の一覧 API は要素 0 件のページ・範囲外のページに対しても当該属性を空配列で返す
  // （実測: check-runs / actions runs を per_page=1 で全ページ取得、0 件応答、範囲外ページのいずれも
  // 属性は常に存在し配列だった）。したがって属性の欠落・型不正は一覧が空である証拠にならず、
  // 0 件として受理すると取得失敗が要素 0 件と区別できないまま下流へ流れる。
  assert.throws(() => parseGhObjectResponse('{"total_count":0}', 'check_runs'), GhJsonParseError);
  assert.throws(() => parseGhObjectResponse('{"check_runs":null}', 'check_runs'), GhJsonParseError);
  assert.throws(() => parseGhObjectResponse('{"check_runs":{"id":1}}', 'check_runs'), GhJsonParseError);
  // 複数ページのうち 1 ページでも属性を欠く場合、他ページが取得できていても解釈失敗とする。
  assert.throws(
    () => parseGhObjectResponse(`{"total_count":1}\n${JSON.stringify({ check_runs: REVIEWS })}`, 'check_runs'),
    GhJsonParseError,
  );
  assert.throws(
    () => parseGhObjectResponse(JSON.stringify([{ check_runs: REVIEWS }, { total_count: 3 }]), 'check_runs'),
    /check_runs/,
  );
  // 属性が存在し空配列である場合だけ、そのページの寄与が 0 件として成立する。
  assert.deepEqual(
    parseGhObjectResponse('{"total_count":0,"check_runs":[]}\n{"total_count":0,"check_runs":[]}', 'check_runs'),
    [],
  );
});

test('gh-json: 単一文書として解釈できる入力はその結果をそのまま用いる', () => {
  assert.deepEqual(splitGhJsonDocuments('{"check_runs":[]}'), [{ check_runs: [] }]);
  assert.deepEqual(splitGhJsonDocuments('  [1,2]  '), [[1, 2]]);
  assert.equal(splitGhJsonDocuments('[[1],[2]]').length, 1);
});
