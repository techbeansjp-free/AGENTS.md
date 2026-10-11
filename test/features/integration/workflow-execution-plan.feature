@integration
Feature: 保存済み状態から次のexecutionPlanだけを副作用なく返す

  Scenario: SCN-INT-EXECPLAN-001 planはfresh worker契約を返しGitとstagingを書き換えない
    Given executionPlan用の隔離full stagingがある
    When workflow advanceのplanを2回観測する
    Then 同じHEAD境界のfresh契約だけが返り保存内容は不変である

  Scenario Outline: SCN-INT-EXECPLAN-002 planに変更権限や自己申告を混ぜられない
    Given executionPlan用の隔離full stagingがある
    When planに禁止option「<option>」を指定する
    Then planは拒否され保存内容は不変である

    Examples:
      | option             |
      | --apply            |
      | --prepare-next     |
      | --evidence=claimed |
      | --artifact=fake.md |
      | --repo=owner/name  |
      | --plan=__present__ |
      | --prepare-next=__present__ |

  Scenario: SCN-INT-EXECPLAN-003 壊れた正式記録からworkerを起動しない
    Given executionPlan用の隔離full stagingがある
    When journalを破損させてexecutionPlanを観測する
    Then executorはnoneでdispatchがなくblocked理由を返す

  Scenario: SCN-INT-EXECPLAN-004 reviewer代替はcorrectionの書込契約を引き継がない
    Given executionPlan用の隔離full stagingがある
    When correction handoffのreviewer代替を導出する
    Then reviewerには別workUnitIdと独立read契約だけがある

  Scenario: SCN-INT-EXECPLAN-005 失効と判定不能を区別し既存gateに委ねる
    Given executionPlan用の隔離full stagingがある
    When 後続HEADと失敗検証記録を投影する
    Then 失敗検証だけが失効し後続HEADは判定不能になる
