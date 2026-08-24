@e2e
Feature: CLIからworkspace衛生をpreviewして明示承認で適用する

  Scenario: SCN-E2E-HYGIENE-001 CLIのpreviewは書き込まず候補一覧を出力する
    Given CLI preview対象の隔離repositoryがある
    When worktree hygiene CLIをapplyなしで実行する
    Then CLI previewは終了code 0で候補一覧をJSON出力する
    And CLI previewは候補を削除しない

  Scenario: SCN-E2E-HYGIENE-002 CLIのapplyはhash不一致を非0で拒否する
    Given CLI apply対象の隔離repositoryとpreview hashがある
    When 異なるapproved hashでworktree hygiene CLIをapplyする
    Then CLI applyは非0でhash不一致を報告する
    And CLI applyは対象を一件も削除しない
