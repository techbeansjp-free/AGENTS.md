@e2e
Feature: 公開CLIでワークフローStepを強制する

  Scenario: SCN-E2E-WFSTEP-001 quickでstep 4を飛ばしたpr createを具体的な診断で拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-001"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-002 step 4と10を記録済みのpr createが従来どおり成功する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-002"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-003 workflow stepsのquick出力が機械可読な省略対象を返す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-003"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-004 HumanOverrideを伴う場合だけ欠落stepでのPR作成を許可し承認者と理由を残す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる
