@e2e @project-policy-satisfiability
Feature: CLIはproject policyの未整備状態を可視化する
  install健全性を変えず、policy状態とbootstrapの責務境界を返す。

  Scenario: SCN-E2E-SAT-001 doctorはproject policyの状態をmissing・valid・invalidで報告する
    Given policyがmissingとvalidとinvalidの3つの隔離consumerがある
    When 各consumerでdoctor CLIを実行する
    Then doctorは3種類のproject policy状態を報告する

  Scenario: SCN-E2E-SAT-002 project bootstrapはproject policy未生成と次の安全な操作を明示する
    Given 既存themeの隔離directoryがある
    When theme project bootstrap CLIをapplyする
    Then bootstrapはdocs specsだけの生成とpolicy未検証と次の安全な操作を返す
