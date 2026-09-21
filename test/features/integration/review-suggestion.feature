@integration
Feature: 修正提案を隔離検証した後にfindingへ添える

  Scenario Outline: SCN-INT-SUGGESTION-001 検証済み提案だけをfindingに添える
    Given "committable提案" の修正前後を持つ隔離Git repositoryがある
    When 初回reviewerが "<patch>" の修正提案を返す
    Then 補助レビューは "<expected>" の提案だけを表示し第二passへ生patchを渡さない

    Examples:
      | patch | expected |
      | valid | verified |
      | invalid | omitted |
