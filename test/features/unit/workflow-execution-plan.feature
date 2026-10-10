@unit
Feature: 正式gateを維持する機械可読Work Unit契約

  Scenario Outline: SCN-UNIT-EXECPLAN-001 意味判断と決定論的操作を担当境界に分ける
    Given execution契約のStep「<step>」とrole「<role>」がある
    When execution契約を導出する
    Then executorは「<executor>」で最大1遷移と正式gate完了条件を持つ

    Examples:
      | step | role               | executor     |
      | 1    | request            | fresh-worker |
      | 2    | requirements       | fresh-worker |
      | 3    | readiness-reviewer | fresh-worker |
      | 4    | coordinator        | cli          |
      | 5    | design             | fresh-worker |
      | 6    | planning           | fresh-worker |
      | 7    | readiness-reviewer | fresh-worker |
      | 8    | coordinator        | cli          |
      | 9    | implementation     | fresh-worker |
      | 10   | reviewer           | fresh-worker |
      | 10   | correction         | fresh-worker |
      | 10   | coordinator        | cli          |
      | 11   | coordinator        | cli          |
      | 99   | coordinator        | none         |
