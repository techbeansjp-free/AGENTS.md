@integration @release
Feature: release workflowの安全契約
  実workflowと危険な反例を同じ静的validatorで検証する。

  Scenario: SCN-INT-RELEASE-001 実release workflowがtrigger・権限・dry-run既定・gateを満たす
    Given 実release workflowのYAML本文を読み込む
    When release workflow契約を検証する
    Then workflow検証は有効で必須checkをすべて記録する

  Scenario: SCN-INT-RELEASE-002 通常push triggerと秘密値出力を含むworkflowを拒否する
    Given 通常push triggerと秘密値出力を含むworkflow本文がある
    When release workflow契約を検証する
    Then workflow検証はtriggerと秘密値出力を根拠に拒否する
