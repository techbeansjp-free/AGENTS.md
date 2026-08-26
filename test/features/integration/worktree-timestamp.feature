@integration
Feature: CLIでworktreeの作成時刻とpath構成を保証する

  Scenario: SCN-INT-WTTS-001 fixture repositoryで未来日付のpathが拒否される
    Given CLI用trusted policyとremote default branchを持つ隔離repositoryがある
    When 基準時刻より未来のpathを指定してworktree create CLIを実行する
    Then CLIは未来日付を拒否してworktreeを作成しない

  Scenario: SCN-INT-WTTS-002 path省略時に実時刻でworktreeが作成される
    Given CLI用trusted policyとremote default branchを持つ隔離repositoryがある
    When pathを省略して基準時刻でworktree create CLIを実行する
    Then CLI基準時刻から構成したpathへworktreeが作成される
