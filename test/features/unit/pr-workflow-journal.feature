@unit
Feature: PR作成後のworkflow journal記録を復旧可能にする

  Scenario: SCN-UNIT-PRJRNL-001 PR作成後の記録失敗でもPR URLが出力される
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-001"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-002 記録失敗時にdelivery専用の復旧方法が診断へ含まれる
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

  Scenario: SCN-UNIT-PRJRNL-005 merge要求後の記録失敗は外部merge再送を禁止する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-005"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-006 明示stagingが別repositoryまたはIssueならPR作成前に拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-006"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる

  Scenario: SCN-UNIT-PRJRNL-007 別projectまたはsymlink祖先の明示stagingをPR作成前に拒否する
    Given ワークフローStep単体検査の準備がある
    When "SCN-UNIT-PRJRNL-007"の単体検査を実行する
    Then ワークフローStep単体検査は期待結果になる
