@integration
Feature: 隔離repositoryで安全にworktreeを作成する

  Scenario: SCN-INT-WTPLACE-001 隔離repositoryで規定名のworktreeを作成する
    Given remote default branchを固定した隔離repositoryがある
    When 規定名のworktreeを作成する
    Then 規定root直下に指定branchのworktreeが作成される

  Scenario: SCN-INT-WTPLACE-002 baseが検証済みremote default branch SHAと一致しなければ作成しない
    Given remote default branchを固定した隔離repositoryがある
    When 異なるremote default branch SHAでworktree作成を試みる
    Then worktree作成は副作用前に拒否される

  Scenario: SCN-INT-WTPLACE-003 rootがdirtyでも作成前後で状態が同一である
    Given dirty状態とremote default branchを持つ隔離repositoryがある
    When 規定名のworktreeを作成する
    Then 作成元のdirty状態は作成前後で同一である

  Scenario: SCN-INT-WTPLACE-004 symlink脱出とGit内部領域への作成を拒否する
    Given worktree rootがrepository外とGit内部を指す隔離repository群がある
    When symlink経由で規定名のworktree作成を試みる
    Then 全てのsymlink経由作成が副作用前に拒否される
