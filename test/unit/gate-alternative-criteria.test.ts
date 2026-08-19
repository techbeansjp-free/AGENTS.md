import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAlternativeCriteria,
  removeIssueSyncTranscript,
} from '../../src/lib/gate-alternative-criteria.js';
import { SYNC_BEGIN_MARKER, SYNC_END_MARKER } from '../../src/lib/issue-sync.js';

test('ISSUE-733 AC-17: 転記区間は最初の開始から最後の終了まで除去してマーカー偽装を無害化する', () => {
  const body = [
    '## 要求', '人間が記載した要求', '', SYNC_BEGIN_MARKER, '## 要求', 'ワーカー本文', SYNC_END_MARKER,
    '埋め込み後のワーカー本文', SYNC_BEGIN_MARKER, 'さらにワーカー本文', SYNC_END_MARKER,
    '', '## 受入基準', '人間が記載した受入基準',
  ].join('\n');
  assert.equal(
    extractAlternativeCriteria(body),
    '人間が記載した要求\n\n人間が記載した受入基準',
  );
});

test('ISSUE-733 AC-17: 片側マーカー欠落は転記内容を採用範囲から除去する', () => {
  assert.equal(extractAlternativeCriteria(`## 要求\n要求\n\n${SYNC_BEGIN_MARKER}\n## 要求\nworker`), '要求');
  assert.equal(extractAlternativeCriteria(`worker\n${SYNC_END_MARKER}\n\n## 受入基準\n受入基準`), '受入基準');
  assert.equal(removeIssueSyncTranscript(`${SYNC_BEGIN_MARKER}\nworker`), '');
});

test('ISSUE-733 AC-5/AC-6: 要求記述節だけを採用し、前文・管理節・見出しだけは採用しない', () => {
  const body = [
    '前文の管理情報',
    '## 初期自走範囲', 'full',
    '## 要求', '要求本文',
    '### 詳細', '詳細本文',
    '## リスク分類', 'normal',
    '## 受入基準', '受入本文',
  ].join('\n');
  assert.equal(extractAlternativeCriteria(body), '要求本文\n### 詳細\n詳細本文\n\n受入本文');
  assert.equal(extractAlternativeCriteria('前文だけ\n\n## 初期自走範囲\nfull'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準'), undefined);
});

test('ISSUE-733 AC-5/AC-6: 要求記述節の見出しは固定ラベルへ正規化後完全一致する', () => {
  assert.equal(extractAlternativeCriteria('## **受入条件：**\n終了コードを 0 にする。'), '終了コードを 0 にする。');
  assert.equal(extractAlternativeCriteria('## ＲＥＱＵＩＲＥＭＥＮＴＳ：\nwork'), 'work');
  assert.equal(extractAlternativeCriteria('## 受入基準 ##\n動作すること'), '動作すること');
  assert.equal(extractAlternativeCriteria('## Requirements ###   \nwork'), 'work');
  assert.equal(extractAlternativeCriteria('## 受入基準#\nwork'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準 # 注記\nwork'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準（案）\nwork'), undefined);
});

test('ISSUE-733 AC-5/AC-6: fenced code block・HTMLコメント内の偽見出しは要求記述節として扱わない', () => {
  const fenced = ['```md', '## 要求', '偽の要求', '```'].join('\n');
  const commented = ['<!--', '## 受入基準', '偽の基準', '-->'].join('\n');
  assert.equal(extractAlternativeCriteria(fenced), undefined);
  assert.equal(extractAlternativeCriteria(commented), undefined);
  assert.equal(extractAlternativeCriteria(`${fenced}\n\n## 要求\n真正の要求`), '真正の要求');
  assert.equal(extractAlternativeCriteria('~~~md\n## 要求\n未閉鎖'), undefined);
  assert.equal(extractAlternativeCriteria('<!--\n## 要求\n未閉鎖'), undefined);
});

test('ISSUE-733 AC-5/AC-6: 固定placeholderはリスト記号と末尾句読点を正規化して除外する', () => {
  for (const placeholder of ['TBD', '- TBD', '* 未定', '+ なし。', '1. なし', '2) N/A.', '- - TBD']) {
    assert.equal(extractAlternativeCriteria(`## 受入基準\n${placeholder}`), undefined, placeholder);
  }
  assert.equal(
    extractAlternativeCriteria('## 受入基準\n- TBD\n\n終了コードを 0 にする。'),
    '終了コードを 0 にする。',
  );
});

test('ISSUE-733 AC-6: task-list markerだけ、または固定placeholderだけの項目は展開不能にする', () => {
  for (const placeholder of ['- [ ]', '- [x]', '* [X]', '1. [ ]', '- [ ] TBD', '- [x] 未定。']) {
    assert.equal(extractAlternativeCriteria(`## 受入基準\n${placeholder}`), undefined, placeholder);
  }
  assert.equal(
    extractAlternativeCriteria('## 受入基準\n- [ ] 終了コードを 0 にする。'),
    '- [ ] 終了コードを 0 にする。',
  );
});

test('ISSUE-733 AC-6: blockquote内のtask-list placeholderも展開不能にする', () => {
  for (const placeholder of ['> - [ ]', '> - [ ] TBD', '> > - [x] 未定。']) {
    assert.equal(extractAlternativeCriteria(`## 受入基準\n${placeholder}`), undefined, placeholder);
  }
});

test('ISSUE-733 AC-6: Markdown装飾された固定placeholderも展開不能にする', () => {
  for (const placeholder of [
    '**TBD**', '__未定__', '*なし*', '_none_', '~~N/A~~', '`TBD`', '`` 未定 ``',
    '- [ ] **TBD**', '> - [x] `未定`', '**TBD。**', '**`TBD`**',
  ]) {
    assert.equal(extractAlternativeCriteria(`## 受入基準\n${placeholder}`), undefined, placeholder);
  }
});

test('ISSUE-733 AC-5: 一般Markdown本文と部分装飾は固定placeholderとして除外しない', () => {
  for (const criterion of [
    '**終了コードを 0 にする。**', '`TBD` を出力しない', '[TBD](https://example.com)を解消する', '*TBD',
  ]) {
    assert.equal(extractAlternativeCriteria(`## 受入基準\n${criterion}`), criterion);
  }
});

test('ISSUE-733 AC-5: 文字数・意味を推定せず、固定placeholder以外の短い記述も採用する', () => {
  assert.equal(extractAlternativeCriteria('## 受入基準\n終了コードを 0 にする。'), '終了コードを 0 にする。');
  assert.equal(extractAlternativeCriteria('## 要求\n動く'), '動く');
  assert.equal(
    extractAlternativeCriteria('## 要求\n担当者は未定です。詳細は関係者との調整後に別途追記します。'),
    '担当者は未定です。詳細は関係者との調整後に別途追記します。',
  );
});

test('ISSUE-733 AC-6: 空白・コメント・水平線だけの要求記述節は展開不能にする', () => {
  assert.equal(extractAlternativeCriteria('## 要求\n<!-- comment -->\n\n---\n\n   '), undefined);
  assert.equal(extractAlternativeCriteria('---\ntitle: quick change\n---\n\n## 受入基準'), undefined);
});

test('ISSUE-733 AC-6: 本文を伴わない下位見出しだけの要求記述節は展開不能にする', () => {
  assert.equal(extractAlternativeCriteria('## 受入基準\n### 詳細'), undefined);
  assert.equal(extractAlternativeCriteria('## 要求\n### 条件\n#### 例外'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準\n### 詳細\n<!-- 未記入 -->'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準\n### 詳細\nTBD'), undefined);
  assert.equal(extractAlternativeCriteria('## 受入基準\n### 詳細\n終了コードを 0 にする。'), '### 詳細\n終了コードを 0 にする。');
});
