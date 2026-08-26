@unit
Feature: 配布準備工程と配布前品質検証を分離しgate集合を保持する

  Scenario: SCN-UNIT-DISTSCRIPT-001 現行の配布準備形を受理する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-001"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-002 新しい配布準備形を受理する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-002"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-003 配布前品質検証への早期終了の注入を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-003"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-004 配布前品質検証のgate順序の入れ替えを拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-004"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-005 配布前品質検証からのgate除去を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-005"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-006 新しい形でinstall時準備工程の欠落を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-006"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-007 現行の形でinstall時準備工程の自己緩和を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-007"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-008 配布準備工程の任意command化を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-008"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTSCRIPT-009 配布前品質検証への任意commandの追加を拒否する
    Given 配布script単体検査の準備がある
    When "SCN-UNIT-DISTSCRIPT-009"の配布script単体検査を実行する
    Then 配布script単体検査は期待結果になる
