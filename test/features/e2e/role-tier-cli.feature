@e2e @role-tier
Feature: CLIからrole独立性を検証する
  兼務違反を非0と日本語の構造化診断で拒否する。

  Scenario: SCN-E2E-ROLE-001 CLIは兼務違反を非0と日本語診断で拒否する
    Given build済みCLIへ同一identityとcontextのrole割当を渡す
    When routing rolesを実行する
    Then CLIは非0と日本語の構造化診断を返す
