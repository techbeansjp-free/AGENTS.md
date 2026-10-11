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

  Scenario Outline: SCN-UNIT-EXECPLAN-002 同じStep10でも正式検証Evidenceで実行担当を選ぶ
    Given Step10の候補role「<role>」とgate「<gate>」と責務「<obligation>」と最新失敗「<failed>」がある
    When Evidenceから次のWork Unitを選ぶ
    Then 検証先行の選択は「<selected>」で正式reviewの記録を先行しない

    Examples:
      | role        | gate     | obligation | failed | selected |
      | reviewer    | required | unsatisfied | false  | true     |
      | reviewer    | required | invalidated | false  | true     |
      | reviewer    | required | unknown     | false  | false    |
      | reviewer    | required | satisfied   | false  | false    |
      | reviewer    | observed | satisfied   | false  | false    |
      | reviewer    | blocked  | invalidated | false  | false    |
      | reviewer    | required | invalidated | true   | false    |
      | reviewer    | none     | unsatisfied | false  | false    |
      | correction  | required | unsatisfied | false  | false    |
      | coordinator | required | unsatisfied | false  | false    |
