@e2e
Feature: project固有rule台帳のdogfooding

  Scenario: SCN-E2E-LEDGER-001 実repositoryをproject policyと固定文書命名で検証する
    Given 実repositoryのproject rule台帳と固定Markdownがある
    When dogfooding境界を一括検証する
    Then project ruleと固定Markdownの全境界が合格する
