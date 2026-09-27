@e2e
Feature: Shadow評価CLIの表示と権限境界
  Scenario: SCN-E2E-SHADOW-EVAL-001 公開入口の安全境界
    Given 隔離repositoryにshadow評価journalを用意する
    When 公開CLIで正常と不正のshadow評価を要求する
    Then 安全なJSONと終了値を返し秘密も入力変更も生じない
