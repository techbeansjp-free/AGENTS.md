@unit
Feature: 登録済みtrusted proposalの記述fieldだけを更新可能にする

  Scenario: SCN-UNIT-PROPFIELD-001 rollbackの更新を受理する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-001"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-002 rationaleの更新を受理する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-002"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-003 ownerの更新を受理する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-003"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-004 記述fieldの空文字列化を拒否する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-004"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-005 記述fieldの削除を拒否する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-005"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-006 targetsの変更を拒否する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-006"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-007 契約versionの変更を拒否する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-007"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる

  Scenario: SCN-UNIT-PROPFIELD-008 登録済みproposalの削除を拒否する
    Given proposal記述field単体検査の準備がある
    When "SCN-UNIT-PROPFIELD-008"のproposal記述field単体検査を実行する
    Then proposal記述field単体検査は期待結果になる
