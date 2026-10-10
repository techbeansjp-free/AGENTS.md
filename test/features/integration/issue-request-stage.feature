@integration
Feature: full要求工程の成果物だけでStep 1を記録する

  Scenario: SCN-INT-ISSUEGHK-001 fullのStep 1はStep 2の実行可能な受け入れ例を要求しない
    Given Gherkinを含まない完成済みfull要求だけがある
    When full要求を正規のworkflow advanceで記録する
    Then Step 1だけが記録され後工程は未完了のままである
