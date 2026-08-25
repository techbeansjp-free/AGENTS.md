@integration @auto-release
Feature: 自動release workflow契約
  実workflowと危険な反例を同じ静的validatorで検証する。

  Scenario: SCN-INT-AUTORELEASE-001 実workflowが自動triggerと再帰防止と冪等条件と経路別gateを満たす
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then 自動release workflow検証は有効になる

  Scenario: SCN-INT-AUTORELEASE-002 無条件のmain pushトリガと自動npm公開を含むworkflowを拒否する
    Given 無条件main pushと自動npm公開を含むworkflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はpathsとnpm条件を根拠に拒否する

  Scenario: SCN-INT-AUTORELEASE-003 bump経路が必要なgateをすべて含む
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then bump経路はaudit:check以外のrelease gateをすべて含む
