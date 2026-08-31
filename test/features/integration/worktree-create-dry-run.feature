@integration @worktree-create-dry-run
Feature: worktree createが承認されたときだけworktreeを作成する

  Scenario: SCN-INT-WTDRY-001 dry-runでworktreeもbranchも作成されない
    Given worktree create dry-run検証用の隔離repositoryがある
    When "--dry-run"でworktree create CLIを実行する
    Then repositoryの状態は"変わらない"である

  Scenario: SCN-INT-WTDRY-002 dry-runの出力がpreview計画を返す
    Given worktree create dry-run検証用の隔離repositoryがある
    When "--dry-run"でworktree create CLIを実行する
    Then worktree create CLIの結果は"preview計画"である

  Scenario: SCN-INT-WTDRY-003 applyではworktreeが作成される
    Given worktree create dry-run検証用の隔離repositoryがある
    When "--apply"でworktree create CLIを実行する
    Then worktree create CLIの結果は"作成成功"である

  Scenario: SCN-INT-WTDRY-004 flagなしの呼び出しを拒否する
    Given worktree create dry-run検証用の隔離repositoryがある
    When "flagなし"でworktree create CLIを実行する
    Then worktree create CLIの結果は"拒否"である
    And repositoryの状態は"変わらない"である

  Scenario: SCN-INT-WTDRY-005 両flag同時指定を拒否する
    Given worktree create dry-run検証用の隔離repositoryがある
    When "--apply --dry-run"でworktree create CLIを実行する
    Then worktree create CLIの結果は"拒否"である
    And repositoryの状態は"変わらない"である

  Scenario: SCN-INT-WTDRY-006 dry-runでも配置検証が働く
    Given worktree create dry-run検証用の隔離repositoryがある
    When "--dry-run"で未来timestampのpathを指定してworktree create CLIを実行する
    Then worktree create CLIの結果は"配置拒否"である
    And repositoryの状態は"変わらない"である
