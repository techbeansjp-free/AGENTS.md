@unit
Feature: 配布文書のCLI案内を正本から生成する

  Scenario: SCN-UNIT-CLIDOC-001 現行の配布文書は正本と一致する
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-001"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる

  Scenario: SCN-UNIT-CLIDOC-002 生成区画が古い利用案内を拒否する
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-002"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる

  Scenario: SCN-UNIT-CLIDOC-003 生成markerが無い文書を拒否する
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-003"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる

  Scenario: SCN-UNIT-CLIDOC-004 文書が欠落している場合に拒否する
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-004"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる

  Scenario: SCN-UNIT-CLIDOC-005 生成を適用すると文書が最新になる
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-005"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる

  Scenario: SCN-UNIT-CLIDOC-006 生成本文はusage正本の必須flagを反映する
    Given CLI配布文書検査の準備がある
    When "SCN-UNIT-CLIDOC-006"のCLI配布文書検査を実行する
    Then CLI配布文書検査は期待結果になる
