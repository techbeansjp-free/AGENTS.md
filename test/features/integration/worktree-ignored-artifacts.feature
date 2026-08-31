@integration @worktree-ignored-artifacts
Feature: worktree survey CLIが非ASCII名の無視対象で種別不明を返さない

  Scenario: SCN-INT-WTIGN-001 survey CLIが非ASCII名で種別不明を返さない
    Given "非ASCII名"の無視対象を持つ隔離worktreeがある
    When 隔離repositoryへworktree survey CLIを実行する
    Then survey CLIの出力は"種別不明の理由を含まない"である
