@e2e
Feature: 配布CLIでprogress marker付きIssueを検証する

  Scenario: SCN-E2E-ISSUECOMMENT-001 完全なprogress markerを保持したfull Issueが合格する
    Given 出荷03のprogress markerを保持した記入済みfull Issueがある
    When 配布CLI processでmarker付きIssueを検証する
    Then CLIのIssue検証は合格する
    And 同じ03のbytesからprogress inventoryを生成できる
