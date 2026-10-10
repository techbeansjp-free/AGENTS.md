@integration
Feature: full要求工程の成果物だけでStep 1を記録する

  Scenario: SCN-INT-ISSUEGHK-001 fullのStep 1はStep 2の実行可能な受け入れ例を要求しない
    Given Gherkinを含まない完成済みfull要求だけがある
    When full要求を正規のworkflow advanceで記録する
    Then Step 1だけが記録され後工程は未完了のままである

  Scenario: SCN-INT-ISSUEGHK-002 適用後の次作業観測が失敗しても記録を繰り返さない
    Given Gherkinを含まない完成済みfull要求だけがある
    When full要求の記録後に次Work Unitの観測が失敗する
    Then 適用済みStepを保持し読取だけで同じ次Work Unitを回復する

  Scenario: SCN-INT-ISSUEGHK-003 検証と記録と次の作業契約を一度で返す
    Given Gherkinを含まない完成済みfull要求だけがある
    When full要求を記録して次Work Unitを返す
    Then Step 1だけが記録され後工程は未完了のままである
    And 次の知的作業を返し追加のStepを適用しない
