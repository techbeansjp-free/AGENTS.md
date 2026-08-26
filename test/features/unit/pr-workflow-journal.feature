@unit
Feature: PR作成後のworkflow journal記録を復旧可能にする

  Scenario: SCN-UNIT-PRJRNL-001 PR作成後の記録失敗でもPR URLが出力される
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-002 記録失敗時に復旧方法が診断へ含まれる
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-002"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-003 記録失敗が成功として報告されない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-003"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-004 記録成功時の出力形式が変わらない
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-004"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる
