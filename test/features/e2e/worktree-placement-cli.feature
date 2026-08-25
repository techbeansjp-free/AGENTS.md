@e2e
Feature: CLIからpolicy準拠のworktreeを作成する

  Scenario: SCN-E2E-WTPLACE-001 必須入力とtrusted policyで規定worktreeを作成する
    Given CLI用trusted policyとremote default branchを持つ隔離repositoryがある
    When worktree create CLIを必須入力付きで実行する
    Then CLIは規定worktreeを作成して成功JSONを返す
