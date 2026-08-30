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

  Scenario: SCN-E2E-WFSTEP-004 HumanOverrideでPRを作成してもautomaticはmerge待ちとしStep 11を完了しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-004"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-005 PoC stagingからのpr mergeをGitHub操作前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-005"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-006 PR作成後にrepository・Issue・PR・HEADをdelivery stateへ固定する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-006"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-007 merge要求後の再実行はproviderへ再送せずread-backとEvidence再検証だけを行う
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-007"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-008 merge-requestedではStep 11へ進まずmerged再観測後に完了する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-008"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-009 固定済みPR・project・closing契約の変更をmerge前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-009"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-010 local policyの由来がremote baseと異なるPR作成をprovider副作用前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-010"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-011 providerに対象PRがないcreate intentを同じidentityで安全に再試行する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-011"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-012 providerにmerge要求がないmerge intentを同じidentityで安全に再試行する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-012"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-013 step11-recordedの再実行は実journalと保存digestの欠落・改変を拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-013"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-014 GitHubの秒精度RFC3339 mergedAtをcanonical UTC時刻として保存する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-014"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-015 merge queue entryを要求済みEvidenceとして永続化しmergeを再送しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-015"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-016 auto-merge methodが固定intentと異なれば再送せず照合要求にする
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-016"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-017 stop-at-PRをdurable Step 11終端として一度だけ記録する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-017"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-018 PR終端journal保存後の停止からprovider再送なしでstateを復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-018"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-019 providerの既定branchが指定baseと違えばPR intent前に拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-019"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-020 merge直前のprovider authorityが変化したら外部mergeを拒否する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-020"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-021 merged終端の再実行はproviderを呼ばず同じEvidenceを返す
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-021"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-022 merged終端journal保存後の停止からprovider再送なしでstateを復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-022"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-023 PR create dispatch claim後の停止はprovider未反映でも再送しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-023"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-024 merge dispatch claim後の停止はprovider未反映でも再送しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-024"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-025 固定identityに一致するclosed PRがあれば重複PRを作成しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-025"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-026 PR作成後binding前にbaseが前進しても既存PRをread-only復旧する
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-026"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-027 PR終端journal後の復旧は成果物改変を追認しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-027"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる

  Scenario: SCN-E2E-WFSTEP-028 merge終端journal後の復旧は成果物改変を追認しない
    Given ワークフローStep公開CLIの隔離環境がある
    When "SCN-E2E-WFSTEP-028"のE2E検査を実行する
    Then ワークフローStep公開CLI検査は期待結果になる
