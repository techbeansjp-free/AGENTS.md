import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIssueId,
  parseAdrId,
  validateAcId,
  validateSlug,
  validateType,
  validateSegment,
  SEGMENTS,
  CliError,
} from '../../src/lib/issue.js';

// --- CliError ---

test('CliError: name が CliError であり Error のインスタンスである', () => {
  const err = new CliError('メッセージ');
  assert.equal(err.name, 'CliError');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof CliError);
  assert.equal(err.message, 'メッセージ');
});

// --- parseIssueId ---

test('parseIssueId: 正常な ISSUE-<番号> を解析する', () => {
  assert.deepEqual(parseIssueId('ISSUE-42'), { issueId: 'ISSUE-42', number: '42' });
});

test('parseIssueId: 番号0は許容される（ISSUE-0）', () => {
  assert.deepEqual(parseIssueId('ISSUE-0'), { issueId: 'ISSUE-0', number: '0' });
});

test('parseIssueId: 先頭ゼロ付きの番号も許容される（ISSUE-01）', () => {
  assert.deepEqual(parseIssueId('ISSUE-01'), { issueId: 'ISSUE-01', number: '01' });
});

test('parseIssueId: 桁数が多い番号も許容される', () => {
  assert.deepEqual(parseIssueId('ISSUE-123456'), { issueId: 'ISSUE-123456', number: '123456' });
});

test('parseIssueId: 数字以外の番号部分は CliError', () => {
  assert.throws(() => parseIssueId('ISSUE-abc'), CliError);
  assert.throws(() => parseIssueId('ISSUE-abc'), /ISSUE-<番号>/);
});

test('parseIssueId: 小文字の issue- は拒否される（大文字小文字を区別）', () => {
  assert.throws(() => parseIssueId('issue-42'), CliError);
});

test('parseIssueId: 番号が無い場合は拒否される', () => {
  assert.throws(() => parseIssueId('ISSUE-'), CliError);
});

test('parseIssueId: 末尾に余分な文字がある場合は拒否される（完全一致）', () => {
  assert.throws(() => parseIssueId('ISSUE-42x'), CliError);
});

test('parseIssueId: 空文字列は拒否される', () => {
  assert.throws(() => parseIssueId(''), CliError);
});

test('parseIssueId: プレフィックスが無い場合は拒否される', () => {
  assert.throws(() => parseIssueId('42'), CliError);
});

// --- parseAdrId ---

test('parseAdrId: 正常な ADR-<番号> を解析する', () => {
  assert.deepEqual(parseAdrId('ADR-7'), { adrId: 'ADR-7', number: '7' });
});

test('parseAdrId: 数字以外は CliError', () => {
  assert.throws(() => parseAdrId('ADR-x'), CliError);
  assert.throws(() => parseAdrId('ADR-x'), /ADR-<番号>/);
});

test('parseAdrId: プレフィックス違いは拒否される', () => {
  assert.throws(() => parseAdrId('ISSUE-7'), CliError);
  assert.throws(() => parseAdrId('adr-7'), CliError);
});

// --- validateAcId ---

test('validateAcId: 正常な AC-<番号> は例外を投げない', () => {
  assert.doesNotThrow(() => validateAcId('AC-1'));
  assert.doesNotThrow(() => validateAcId('AC-123'));
});

test('validateAcId: 番号が無い場合は CliError', () => {
  assert.throws(() => validateAcId('AC-'), CliError);
});

test('validateAcId: 小文字プレフィックスは拒否される', () => {
  assert.throws(() => validateAcId('ac-1'), CliError);
});

test('validateAcId: 数字以外を含む場合は拒否される', () => {
  assert.throws(() => validateAcId('AC-1a'), CliError);
});

// --- validateSlug ---

test('validateSlug: 小文字英数字とハイフンのみのslugは許容される', () => {
  assert.doesNotThrow(() => validateSlug('foo', 20));
  assert.doesNotThrow(() => validateSlug('foo-bar', 20));
  assert.doesNotThrow(() => validateSlug('a1-b2-c3', 20));
});

test('validateSlug: 先頭ハイフンは拒否される', () => {
  assert.throws(() => validateSlug('-foo', 20), CliError);
  assert.throws(() => validateSlug('-foo', 20), /ハイフン不可/);
});

test('validateSlug: 末尾ハイフンは拒否される', () => {
  assert.throws(() => validateSlug('foo-', 20), CliError);
});

test('validateSlug: 連続ハイフンは拒否される', () => {
  assert.throws(() => validateSlug('foo--bar', 20), CliError);
});

test('validateSlug: 大文字を含む場合は拒否される', () => {
  assert.throws(() => validateSlug('Foo', 20), CliError);
});

test('validateSlug: 空白や記号を含む場合は拒否される', () => {
  assert.throws(() => validateSlug('foo bar', 20), CliError);
  assert.throws(() => validateSlug('foo_bar', 20), CliError);
});

test('validateSlug: 空文字列は拒否される', () => {
  assert.throws(() => validateSlug('', 20), CliError);
});

test('validateSlug: 最大長を超えるslugは拒否される', () => {
  assert.throws(() => validateSlug('abcdef', 5), CliError);
  assert.throws(() => validateSlug('abcdef', 5), /5 文字以内/);
});

test('validateSlug: 最大長と同じ長さのslugは許容される', () => {
  assert.doesNotThrow(() => validateSlug('abcde', 5));
});

// --- validateType ---

test('validateType: 許可リストに含まれる値は例外を投げない', () => {
  assert.doesNotThrow(() => validateType('feature', ['feature', 'bugfix', 'chore']));
});

test('validateType: 許可リストに含まれない値は CliError（許可リストをメッセージに含む）', () => {
  assert.throws(() => validateType('unknown', ['feature', 'bugfix']), CliError);
  assert.throws(() => validateType('unknown', ['feature', 'bugfix']), /feature\|bugfix/);
});

test('validateType: 空の許可リストでは常に拒否される', () => {
  assert.throws(() => validateType('anything', []), CliError);
});

// --- validateSegment ---

test('validateSegment: SEGMENTS に含まれる値は例外を投げない', () => {
  for (const seg of SEGMENTS) {
    assert.doesNotThrow(() => validateSegment(seg));
  }
});

test('validateSegment: SEGMENTS に含まれない値は CliError', () => {
  assert.throws(() => validateSegment('phase'), CliError);
  assert.throws(() => validateSegment('review'), CliError);
  assert.throws(() => validateSegment(''), CliError);
});

test('validateSegment: エラーメッセージに許容セグメント一覧を含む', () => {
  assert.throws(() => validateSegment('invalid'), /spec\|design\|implementation\|validation/);
});

// --- SEGMENTS ---

test('SEGMENTS: 4区分がこの順で定義されている', () => {
  assert.deepEqual(SEGMENTS, ['spec', 'design', 'implementation', 'validation']);
});
