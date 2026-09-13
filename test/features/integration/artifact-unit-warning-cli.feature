@integration
Feature: issue validateの成果物単位warning

  Scenario: SCN-INT-ARTUNIT-008 warningはvalid Issueの成功終了を変えない
    Given 成果物markerを2件持つvalidなfull Issue fixtureがある
    When 実CLIで成果物単位を検証する
    Then 終了値0のまま成果物単位warningを返す

  Scenario: SCN-INT-ARTUNIT-009 warningはinvalid Issueの失敗終了を変えない
    Given 成果物markerを2件持つinvalidなfull Issue fixtureがある
    When 実CLIで成果物単位を検証する
    Then 終了値1のままerrorと成果物単位warningを返す
