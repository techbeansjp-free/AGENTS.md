@e2e @rootupd
Feature: CLIはroot更新拒否をfail-closedで報告する

  Scenario: SCN-E2E-ROOTUPD-001 CLIは拒否時にroot状態を変更しない
    Given finalize対象とdirtyなrootを持つ隔離CLI repositoryがある
    When update-root付きfinalize CLIをdry-runする
    Then CLIは非0でroot HEADと作業内容と全worktreeを保持する
