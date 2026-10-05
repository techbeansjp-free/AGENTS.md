@integration
Feature: Agent Lifecycleを手設定なしで導入する
  ASC所有entryだけを更新し、利用者設定と既存runtime境界を保持する。

  Scenario: SCN-INT-ZEROCONFIG-001 空projectへ正式CLIから導入する
    Given zero-config検証用の隔離filesystemを準備する
    When 空projectのinstallは設定とtrusted runtimeを自動構成する
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-002 旧設定を移行し利用者設定を保持する
    Given zero-config検証用の隔離filesystemを準備する
    When 旧lifecycle設定のupdateとdeleteは利用者設定を保持する
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-003 shared設定の失敗と競合を拒否する
    Given zero-config検証用の隔離filesystemを準備する
    When shared設定の公開失敗と競合は利用者のbytesを保持する
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-004 runtimeの改変を診断する
    Given zero-config検証用の隔離filesystemを準備する
    When runtimeの改変と更新中はhealthyにならない
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-005 workflow previewを維持しhookによる再検証を廃止する
    Given zero-config検証用の隔離filesystemを準備する
    When envなしのworkflow dispatchはmanaged runtimeを使いhook観測に依存しない
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-006 配布元を失っても更新できる
    Given zero-config検証用の隔離filesystemを準備する
    When version更新は古いCLI pathなしでruntimeを更新する
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-008 deleteは共有設定の変更を予告して参照も除去する
    Given zero-config検証用の隔離filesystemを準備する
    When deleteのpreviewとapplyはcustomized ASC登録だけを除去する
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-009 廃止runtimeの信頼を取り消す
    Given zero-config検証用の隔離filesystemを準備する
    When updateは廃止runtimeを整理し変更済み残存fileを信頼しない
    Then zero-configの受入条件を満たす

  Scenario: SCN-INT-ZEROCONFIG-010 旧CLIのpath構文を区別する
    Given zero-config検証用の隔離filesystemを準備する
    When 旧CLIの移行はPOSIXとWindowsの絶対pathだけを認識する
    Then zero-configの受入条件を満たす
