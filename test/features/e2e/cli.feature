@e2e
Feature: 利用者がCLIだけでpreview、apply、validateを再現する

  Scenario: SCN-E2E-001 CLIでbootstrap dry-run、apply、spec validateを順に実行する
    Given 空のCLI project directoryがある
    When project bootstrapをdry-runする
    Then docs directoryは存在しない
    When project bootstrapをapplyする
    And spec validate commandを実行する
    Then すべてのCLI終了codeは0である

  Scenario: SCN-E2E-002 PR create dry-runはghを呼ばずpreviewを表示する
    Given pass済みreview、tests、specのPR引数がある
    When pr create commandをdry-runする
    Then CLI終了codeは0である
    And stdoutに"preview"が含まれる

  Scenario: SCN-E2E-003 PR create applyは明示authorizationなしで拒否する
    Given pass済みreview、tests、specのPR引数がある
    When authorizationなしでpr create commandをapplyする
    Then CLI終了codeは非0である
    And ghは呼ばれない
