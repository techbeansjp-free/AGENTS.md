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
