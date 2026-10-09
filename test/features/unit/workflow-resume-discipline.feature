@unit
Feature: 再開状態を起点にする読取規律
  進行の正本を会話ではなく保存記録に置き、再開時に読む範囲を正本とadapterで定める。
  fullとquickのworkerには必要な正式成果物pointerだけを渡し、計画本文をpreviewで読まない。

  Scenario: SCN-UNIT-RESUME-001 読取規律が正本とadapterに在る
    Given 配布する正本・asc-step adapter・Step 1/2 skillがある
    When 本文を検査する
    Then context境界・再開順・拡大条件があり、adapterは全文読みを指示しない
    And advanceのpreviewは計画本文を読まずapplyはlock前後の変更を拒否する
