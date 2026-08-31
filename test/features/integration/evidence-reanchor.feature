@integration @evidence-reanchor
Feature: 証跡再固定がCLIと診断経路で機能する

  Scenario: SCN-INT-REANCHOR-001 再固定がprovider呼び出しを行わない
    Given 固定済みPR identityを持つstagingと等価なrebaseがある
    When 再固定をCLIから適用する
    Then provider呼び出しは0件になる

  Scenario: SCN-INT-REANCHOR-002 実git fixtureで到達性が報告される
    Given 実git fixtureのstagingがある
    When 到達性を観測する
    Then 到達性の三値が報告される

  Scenario: SCN-INT-REANCHOR-003 到達性観測は1 stagingにつき1回を超えない
    Given 実git fixtureのstagingがある
    When 到達性を観測する
    Then provider観測は1回になる

  Scenario: SCN-INT-REANCHOR-004 再固定後にpr createのbinding検査を通過する
    Given 収束済みreview sessionと等価なrebaseがある
    When review層の再固定のあとにpr createのbinding検査を通す
    Then binding検査は停止しない
