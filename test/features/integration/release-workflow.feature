@integration @release
Feature: release workflowの安全契約
  実workflowと危険な反例を同じ静的validatorで検証する。

  Scenario: SCN-INT-RELEASE-001 実release workflowが自動・手動triggerと安全gateを満たす
    Given 実release workflowのYAML本文を読み込む
    When release workflow契約を検証する
    Then workflow検証は有効で必須checkをすべて記録する

  Scenario: SCN-INT-RELEASE-002 無条件pushと自動npm公開と秘密値出力を含むworkflowを拒否する
    Given 無条件pushと自動npm公開と秘密値出力を含むworkflow本文がある
    When release workflow契約を検証する
    Then workflow検証はpush条件とnpm条件と秘密値出力を根拠に拒否する

  Scenario: SCN-INT-RELID-007 Immutable Releasesの状態報告stepがjobを失敗させない
    Given 実release workflowのYAML本文を読み込む
    When release workflow契約を検証する
    Then Immutable Releases状態報告stepの存在とjob非停止を確認する

  Scenario: SCN-INT-RELID-008 固定version文字列が対象4fileに存在しない
    Given 固定version文字列検査の対象4fileを読み込む
    When 対象4fileのrelease version形文字列を検査する
    Then release version形の文字列は0件である

  Scenario: SCN-INT-RELID-009 正式取得元がasset URLとnpx github経路で区別される
    Given README.mdと利用案内の正式取得元記述を読み込む
    When 正式取得元の記述を検査する
    Then asset URLとnpx github経路が区別して記載される
