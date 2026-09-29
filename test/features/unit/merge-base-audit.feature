@unit @merge-base-audit @issue-1495
Feature: 実際のmerge-baseを一意に解決する

  Scenario: SCN-MERGE-BASE-AUDIT-007 resolveUniqueMergeBaseはmerge-baseの件数に応じて一意性を判定する
    Given 一意なmerge-baseを持つ2 commitがある
    When 実際のmerge-baseを解決する
    Then 解決したmerge-baseはgit merge-baseの実測値と一致する
    Given 無関係な履歴を持つ2 commitがある
    When 実際のmerge-baseを解決する
    Then 一意性を理由に拒否される
    Given criss-cross mergeで複数のmerge-baseを持つ2 commitがある
    When 実際のmerge-baseを解決する
    Then 一意性を理由に拒否される
