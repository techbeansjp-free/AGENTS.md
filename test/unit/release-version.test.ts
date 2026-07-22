import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveVersion,
  latestSemverTag,
  SEMVER_TAG_RE,
  RELEASE_BUMP_BRANCH_RE,
} from '../../src/lib/release-version.js';

// ---- latestSemverTag ----

test('latestSemverTag: SEMVER_TAG_RE に一致するタグのみを対象に最大版数を返す', () => {
  assert.equal(latestSemverTag(['v0.1.0', 'v0.2.0', 'v0.1.9']), '0.2.0');
});

test('latestSemverTag: 旧日時形式タグ（v20260720.060726等）は非一致として除外される（ADR-0005）', () => {
  assert.equal(latestSemverTag(['v20260720.060726', 'not-a-tag', 'v1.2.3']), '1.2.3');
});

test('latestSemverTag: 一致タグが1件も無ければ undefined を返す', () => {
  assert.equal(latestSemverTag(['v20260720.060726', 'not-a-tag']), undefined);
  assert.equal(latestSemverTag([]), undefined);
});

test('latestSemverTag: 桁数の異なる版数を文字列比較ではなく数値として比較する（v0.2.9 < v0.2.10）', () => {
  assert.equal(latestSemverTag(['v0.2.9', 'v0.2.10']), '0.2.10');
});

test('latestSemverTag: メジャー・マイナーの桁も数値として比較する', () => {
  assert.equal(latestSemverTag(['v1.9.0', 'v1.10.0', 'v2.0.0', 'v10.0.0']), '10.0.0');
});

// ---- resolveVersion: 初回run（seed規則） ----

test('resolveVersion: 一致タグが1件も無い場合、pkgVersionをseedとしてpatch加算する（初回run、DESIGN.md記載の v0.2.0→v0.2.1 と同型）', () => {
  const result = resolveVersion([], '0.2.0');
  assert.deepEqual(result, { latest: '0.2.0', target: '0.2.1', needCommit: true });
});

test('resolveVersion: 旧日時形式タグのみが存在する場合も初回run扱い（seed=pkgVersion）になる', () => {
  const result = resolveVersion(['v20260720.060726'], '0.2.0');
  assert.deepEqual(result, { latest: '0.2.0', target: '0.2.1', needCommit: true });
});

// ---- resolveVersion: 既定経路（patch自動加算） ----

test('resolveVersion: 既存タグがpkgVersion以上の場合、既存タグの最大版数からpatch加算する', () => {
  const result = resolveVersion(['v0.2.0', 'v0.2.3'], '0.2.0');
  assert.deepEqual(result, { latest: '0.2.3', target: '0.2.4', needCommit: true });
});

test('resolveVersion: pkgVersionと既存タグ最大版数が等しい場合もpatch加算する（needCommit=true）', () => {
  const result = resolveVersion(['v1.0.0'], '1.0.0');
  assert.deepEqual(result, { latest: '1.0.0', target: '1.0.1', needCommit: true });
});

test('resolveVersion: patch加算は桁上げを伴っても数値として正しく計算される', () => {
  const result = resolveVersion(['v0.2.9'], '0.2.0');
  assert.deepEqual(result, { latest: '0.2.9', target: '0.2.10', needCommit: true });
});

// ---- resolveVersion: 人手先行bump尊重 ----

test('resolveVersion: pkgVersionが既存タグ最大版数より大きい場合、pkgVersionをtargetとして尊重しneedCommit=falseにする（人手のminor/major先行bump）', () => {
  const result = resolveVersion(['v0.2.0', 'v0.2.5'], '0.3.0');
  assert.deepEqual(result, { latest: '0.2.5', target: '0.3.0', needCommit: false });
});

// ---- resolveVersion: 後退禁止ガード（AC-5）はいかなる入力でも target > latest を維持する ----

test('resolveVersion: 生成されるtargetは常にlatestより大きい（後退禁止ガード、複数ケース横断）', () => {
  const cases: [string[], string][] = [
    [[], '0.2.0'],
    [['v0.2.0', 'v0.2.3'], '0.2.0'],
    [['v1.0.0'], '1.0.0'],
    [['v0.2.0', 'v0.2.5'], '0.3.0'],
    [['v9.9.9'], '9.9.9'],
  ];
  for (const [tags, pkgVersion] of cases) {
    const { latest, target } = resolveVersion(tags, pkgVersion);
    const [lMaj, lMin, lPatch] = latest.split('.').map(Number);
    const [tMaj, tMin, tPatch] = target.split('.').map(Number);
    const latestTuple = lMaj * 1_000_000 + lMin * 1_000 + lPatch;
    const targetTuple = tMaj * 1_000_000 + tMin * 1_000 + tPatch;
    assert.ok(targetTuple > latestTuple, `target(${target}) は latest(${latest}) より大きいはず`);
  }
});

test('resolveVersion: 不正なpkgVersion（semver形式でない）は例外を投げる', () => {
  assert.throws(() => resolveVersion([], 'not-a-version'));
  assert.throws(() => resolveVersion([], 'v0.2.0')); // 'v'接頭辞つきはpkgVersionとしては不正
});

// ---- 正規表現の単体検査 ----

test('SEMVER_TAG_RE: v<major>.<minor>.<patch> のみに一致する', () => {
  assert.ok(SEMVER_TAG_RE.test('v0.2.1'));
  assert.ok(SEMVER_TAG_RE.test('v10.20.30'));
  assert.ok(!SEMVER_TAG_RE.test('v20260720.060726'));
  assert.ok(!SEMVER_TAG_RE.test('0.2.1'));
  assert.ok(!SEMVER_TAG_RE.test('v0.2'));
  assert.ok(!SEMVER_TAG_RE.test('v0.2.1-beta'));
});

test('RELEASE_BUMP_BRANCH_RE: release/bump-v<semver> 形式のみに一致する（admin merge直前のスコープ検査で使用）', () => {
  assert.ok(RELEASE_BUMP_BRANCH_RE.test('release/bump-v0.2.1'));
  assert.ok(!RELEASE_BUMP_BRANCH_RE.test('release/bump-v0.2'));
  assert.ok(!RELEASE_BUMP_BRANCH_RE.test('feature/196-release-automation'));
  assert.ok(!RELEASE_BUMP_BRANCH_RE.test('release/bump-v0.2.1-extra'));
});
