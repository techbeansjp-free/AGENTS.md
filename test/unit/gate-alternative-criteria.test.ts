import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAlternativeCriteria,
  removeIssueSyncTranscript,
} from '../../src/lib/gate-alternative-criteria.js';
import { SYNC_BEGIN_MARKER, SYNC_END_MARKER } from '../../src/lib/issue-sync.js';

test('転記区間は最初の開始から最後の終了まで除去してマーカー偽装を無害化する', () => {
  const body = [
    '人間が記載した要求', '', SYNC_BEGIN_MARKER, 'ワーカー本文', SYNC_END_MARKER,
    '埋め込み後のワーカー本文', SYNC_BEGIN_MARKER, 'さらにワーカー本文', SYNC_END_MARKER,
    '', '人間が記載した受入基準',
  ].join('\n');
  assert.equal(removeIssueSyncTranscript(body), '人間が記載した要求\n\n\n人間が記載した受入基準');
  assert.equal(extractAlternativeCriteria(body), '人間が記載した要求\n\n人間が記載した受入基準');
});

test('片側マーカー欠落と意味を持たないブロックは安全側に除去する', () => {
  assert.equal(extractAlternativeCriteria(`要求\n\n${SYNC_BEGIN_MARKER}\nworker`), '要求');
  assert.equal(extractAlternativeCriteria(`worker\n${SYNC_END_MARKER}\n\n受入基準`), '受入基準');
  assert.equal(extractAlternativeCriteria('<!-- comment -->\n\n---\n\n   '), undefined);
});

test('見出しとメタデータだけの本文は代替判定基準として採用しない', () => {
  assert.equal(extractAlternativeCriteria('## 受入基準'), undefined);
  assert.equal(extractAlternativeCriteria('## 要求\n\n### 期待する挙動\n\n<!-- 未記入 -->'), undefined);
  assert.equal(extractAlternativeCriteria('---\ntitle: quick change\nlabels: size:quick\n---\n\n## 受入基準'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準\n\n動作すること'), '動作すること');
});
