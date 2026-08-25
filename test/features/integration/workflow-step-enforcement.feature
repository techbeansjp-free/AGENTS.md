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
