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

  Scenario: SCN-UNIT-TRACE-004 test layerはproject choiceから解決する
    Given projectがcomponentとjourneyのtest layerを選択する
    When configured layerでGherkin traceを検証する
    Then generic traceはfixed 3 layerを要求しない

  Scenario: SCN-UNIT-TRACE-005 legacy policyにtest layerがなくても例外で停止しない
    Given testLayersを持たないlegacy project policyとGherkinがある
    When trace CLIでlegacy policyを検証する
    Then project choice不足をstructured invalidとして返す

  Scenario Outline: SCN-UNIT-TRACE-006 dependency graphはcycle、self-loop、unknown nodeを拒否する
    Given <反例>を持つdependency graphがある
    When dependency graphを検証する
    Then dependency graphはcycle diagnostic付きでinvalidである

    Examples:
      | 反例 |
      | cycle |
      | self-loop |
      | unknown-node |

  Scenario: SCN-UNIT-TRACE-007 repository固有import graphを汎用validatorでdogfoodする
    Given repository sourceのimport graphと循環反例がある
    When project hookのdependency graphを検証する
    Then source graphは非循環で循環反例だけを拒否する

  Scenario: SCN-UNIT-TRACE-008 project adapterは選択された日本語keywordをcanonical roleへ変換する
    Given 日本語keywordのGherkin scenarioがある
    When 日本語方言でGherkin構造を解析する
    Then canonical Given When Thenへ変換される

  Scenario: SCN-UNIT-TRACE-009 current policyのtestLayersは1件以上を必須にする
    Given 空のtestLayersを持つcurrent project policyがある
    When current project policyを検証する
    Then runtimeとschemaは空のtestLayersを拒否する

  Scenario: SCN-UNIT-TRACE-010 空のforbiddenTestFileSuffixesを方針不採用として受理する
    Given 空のforbiddenTestFileSuffixesを持つcurrent project policyがある
    When 空の禁止接尾辞を持つcurrent project policyを検証する
    Then runtimeとschemaは空のforbiddenTestFileSuffixesを受理する
