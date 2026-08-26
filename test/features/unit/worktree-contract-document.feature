@unit
Feature: worktree作成契約の配布文書を正本から生成する

  Scenario: SCN-UNIT-WTDOC-001 現行の配布文書は正本と一致する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-001"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-002 生成区画が古い文書を拒否する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-002"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-003 生成markerが無い文書を拒否する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-003"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-004 文書が欠落している場合に拒否する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-004"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-005 正本が述べる書式をruntimeが受理する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-005"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-006 生成を適用すると文書が最新になる
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-006"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる

  Scenario: SCN-UNIT-WTDOC-007 生成本文は正本の定数を反映する
    Given worktree契約文書検査の準備がある
    When "SCN-UNIT-WTDOC-007"のworktree契約文書検査を実行する
    Then worktree契約文書検査は期待結果になる
