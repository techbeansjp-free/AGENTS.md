@e2e
Feature: CLIから一時ステージングを安全に整理する

  Scenario: SCN-E2E-STAGING-001 CLIのpreviewは書き込まず候補と理由を出力する
    Given CLI staging preview対象の隔離repositoryがある
    When issue staging CLIをapplyなしで実行する
    Then staging CLI previewは終了code 0で候補と理由をJSON出力する
    And staging CLI previewは対象を書き換えない

  Scenario: SCN-E2E-STAGING-002 CLIのapplyはhash不一致を非0で拒否する
    Given CLI staging apply対象の隔離repositoryがある
    When 異なるapproved hashでissue staging CLIをapplyする
    Then staging CLI applyは構造化診断を返して非0になる
    And staging CLI applyは対象を一件も削除しない

