@integration
Feature: ワークフローStepの記録と正本一致を統合検証する

  Scenario: SCN-INT-WFSTEP-001 workflow recordがjournalへ追記し書き込み後読み取りdigestを確認する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-001"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-002 workflow recordが順序違反の追記を拒否する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-002"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-003 workflow verifyが欠落stepを日本語で報告し非0終了する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-003"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-004 doctorがjournal欠落を検出する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-004"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-005 doctorがモード判定成果物の欠落を検出する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-005"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-006 check scriptが規範文書と定義の一致を確認する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-006"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-007 規範文書のstep表を改変するとcheck scriptが非0終了する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-007"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-008 モード節のstep列を改変するとcheck scriptが非0終了する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-008"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-009 conformance gateが規範文書とStep正本の不一致を拒否する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-009"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-010 同じIssueとStep履歴を保持してquickからfullへ永続昇格する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-010"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-011 PoCの停止または昇格判定から明示commandでfull昇格を選ぶ
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-011"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-012 full昇格はstaging外を指すsymlink成果物を変更前に拒否する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-012"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-013 full昇格は記録digestと一致しない成果物を変更前に拒否する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-013"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-014 full昇格はprocess停止後の永続transactionを復旧して再実行する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-014"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-015 full昇格の再実行は永続Evidence一致時だけ同じ結果へ収束する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-015"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-016 generic workflow recordは初期化専用Step 0とdelivery専用Step 11を記録できない
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-016"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-017 delivery開始後のstagingをfull昇格しない
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-017"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる

  Scenario: SCN-INT-WFSTEP-018 journal symlinkはリンク先へ追記する前に拒否する
    Given ワークフローStep統合検査の隔離環境がある
    When "SCN-INT-WFSTEP-018"の統合検査を実行する
    Then ワークフローStep統合検査は期待結果になる
