@e2e
Feature: CLIからpolicy準拠のworktreeを作成する

  Scenario: SCN-E2E-WTPLACE-001 path省略とtrusted policyで規定worktreeを作成する
    Given CLI用trusted policyとremote default branchを持つ隔離repositoryがある
    When pathを省略してworktree create CLIを実行する
    Then CLIは規定worktreeを作成して成功JSONを返す
