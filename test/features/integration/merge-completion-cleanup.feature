@integration @wtclean
Feature: 隔離repositoryでmerge完了cleanupの安全条件を検証する

  Scenario: SCN-INT-WTCLEAN-002 dirty・未追跡・未push・未merge・復旧不能・所有資産あり・unknownで削除0件になる
    Given unsafeとunknownのcleanup観測がある
    When unsafeなworktree cleanupを適用候補として判定する
    Then 全観測で削除呼出は0件になる

  Scenario: SCN-INT-WTCLEAN-004 apply直前の状態変化とdigest不一致で削除を拒否し新しいpreviewを要求する
    Given safe finalize reportと適用直前に変化した状態がある
    When stale digestと変化後の状態でcleanup applyを試みる
    Then cleanup applyは削除せず新しいpreviewを要求する

  Scenario: SCN-INT-WTCLEAN-007 対象削除後のcontainerが空の場合だけ除去し非空なら保持する
    Given 空と非空のworktree containerを持つ隔離repositoryがある
    When completed worktree containerだけをhygieneで適用する
    Then 空containerだけが除去され非空containerは保持される
