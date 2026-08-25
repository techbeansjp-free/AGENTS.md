@integration
Feature: trace gateで製品仕様を自己検証する

  Scenario: SCN-INT-SPECNORM-001 製品自身のrepositoryでvalidateSpecsがvalidを返す
    Given 製品自身のrepositoryがある
    When 製品仕様のtrace gateを実行する
    Then validateSpecsはvalid trueを返す

  Scenario: SCN-INT-SPECNORM-002 trace checkが要件ID重複を検出する
    Given trace gate用の隔離fixtureがある
    And 隔離fixtureに重複要件IDがある
    When 隔離fixtureのtrace gateを実行する
    Then trace gateは要件ID重複で失敗する

  Scenario: SCN-INT-SPECNORM-003 trace checkが未解決参照を検出する
    Given trace gate用の隔離fixtureがある
    And 隔離fixtureの追跡表に未解決参照がある
    When 隔離fixtureのtrace gateを実行する
    Then trace gateは未解決参照で失敗する

  Scenario: SCN-INT-SPECNORM-004 trace checkが孤立要件と孤立SCNを検出する
    Given trace gate用の隔離fixtureがある
    And 隔離fixtureの追跡行が欠落している
    When 隔離fixtureのtrace gateを実行する
    Then trace gateは孤立要件と孤立SCNで失敗する

  Scenario: SCN-INT-SPECNORM-005 必須仕様欠落時にtrace checkが失敗する
    Given trace gate用の隔離fixtureがある
    And 隔離fixtureの必須仕様が欠落している
    When 隔離fixtureのtrace gateを実行する
    Then trace gateは必須仕様欠落で失敗する
