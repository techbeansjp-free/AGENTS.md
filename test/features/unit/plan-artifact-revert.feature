@unit
Feature: 封印後に更新できない進捗表と本repositoryのstaging宣言を持たない
  計画封印後に編集できない欄を配布templateに置かず、本repository自身は既定のstaging配置を使う。

  Scenario: SCN-UNIT-PLANPROGRESS-001 配布する03 templateは進捗表とprogress markerを持たない
    Given 配布する03_実装計画.md templateを読む
    When 進捗表の有無を確認する
    Then progress markerと進捗節が無く進捗の正本をGitとstep journalと示す

  Scenario: SCN-UNIT-STAGINGREVERT-001 本repositoryのproject policyはstaging節を宣言しない
    Given 本repositoryのproject policy manifestを読む
    When staging節の有無を確認する
    Then staging節が存在しない

  Scenario: SCN-UNIT-STAGINGREVERT-002 REQ-WF-037は本repositoryの宣言を主張せず変更履歴に取り消しがある
    Given REQ-WF-037と仕様変更履歴を読む
    When 本repositoryのstaging宣言の記述を確認する
    Then docs/issuesを宣言する一文が無く既定配置を使う旨と取り消しのentryがある
