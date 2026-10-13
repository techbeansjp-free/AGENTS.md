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

  Scenario: SCN-INT-EXECPLAN-006 readinessと実装後reviewを別責務にする
    Given executionPlan用の隔離full stagingがある
    When 要件readinessと最終reviewの責務を投影する
    Then readinessだけをStep3に割り当て最終reviewを混同しない

  Scenario: SCN-INT-EXECPLAN-007 同じStep10でも有効Evidenceに応じ必要作業が減る
    Given executionPlan用の隔離full stagingがある
    When 同じStep10で検証とreviewの有効性を変えて投影する
    Then 有効な検証だけ選択から外しreview exportは残す

  Scenario: SCN-INT-EXECPLAN-008 正式EvidenceからCLI検証を選び実行後に独立reviewへ戻る
    Given 正式検証未実施のStep10 reviewer候補が隔離repositoryにある
    When 実CLIのplanから必要検証を実行して再planする
    Then CLIだけが検証を一度実行しStep10未記録で独立reviewerへ復帰する

  Scenario: SCN-INT-EXECPLAN-009 通常previewも検証先行時に矛盾したreviewerをdispatchしない
    Given 正式検証未実施のStep10 reviewer候補が隔離repositoryにある
    When 通常advanceとplanを同じ状態で観測する
    Then どちらもCLI検証を選びreviewer dispatchを提示しない

  Scenario: SCN-INT-EXECPLAN-010 compatible文脈の通常previewはdispatchなしで成功する
    Given executionPlan用の隔離full stagingがある
    When compatible文脈で通常advanceを観測する
    Then 互換previewは成功しdispatchを持たない

  Scenario: SCN-INT-EXECPLAN-011 selectionが停止した通常previewは理由を返す
    Given 正式検証未実施のStep10 reviewer候補が隔離repositoryにある
    When review sessionを破損させ通常advanceを観測する
    Then 停止状態と修復可能な理由を返す
