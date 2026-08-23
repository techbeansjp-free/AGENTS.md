@unit
Feature: Gherkinを全test layerの正本にする

  Scenario: SCN-UNIT-TRACE-001 unit、integration、E2Eの全scenarioを実行可能Gherkinとして追跡する
    Given repositoryの全feature fileとCucumber実行結果がある
    When Gherkin traceを検証する
    Then 全scenarioに一意なSCN IDとGiven、When、Thenがある
    And unit、integration、E2Eの各layerにscenarioがある
    And JavaScriptのNode test起票は0件である

  Scenario: SCN-UNIT-TRACE-002 Given、When、Thenの不足を拒否する
    Given Whenが欠けたGherkin scenarioがある
    When Gherkin構造を解析する
    Then When不足を検出する

  Scenario: SCN-UNIT-TRACE-003 重複SCN IDを拒否する
    Given 同じSCN IDを持つ2つのGherkin scenarioがある
    When Gherkin traceを検証する
    Then 重複errorを検出する
