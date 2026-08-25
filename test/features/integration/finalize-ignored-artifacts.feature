@integration
Feature: CLIがignore対象を分類してworktree finalizeを判定する

  Scenario: SCN-INT-FINALIGN-001 fixture repositoryでdistだけを持つmerge済みworktreeをfinalizeできる
    Given distだけを持つmerge済みfinalize fixtureがある
    When fixture worktreeをfinalize dry-runする
    Then finalize dry-runは対象を受理する

  Scenario: SCN-INT-FINALIGN-002 .envを持つworktreeは拒否され理由にpathが含まれる
    Given ignore済み.envを持つmerge済みfinalize fixtureがある
    When fixture worktreeをfinalize dry-runする
    Then finalize dry-runは.envのpathを示して拒否する

  Scenario: SCN-INT-FINALIGN-003 surveyがcleanup-readyと報告した対象をfinalizeが受理する
    Given distだけを持つmerge済みfinalize fixtureがある
    When fixture worktreeをsurveyしてfinalize dry-runする
    Then cleanup-readyの対象をfinalize dry-runが受理する

  Scenario: SCN-INT-FINALIGN-004 surveyがretainと報告した対象をfinalizeが拒否する
    Given ignore済み.envを持つmerge済みfinalize fixtureがある
    When fixture worktreeをsurveyしてfinalize dry-runする
    Then retainの対象をfinalize dry-runが拒否する

  Scenario: SCN-INT-FINALIGN-005 未追跡の追跡対象fileがあるworktreeは削除されない
    Given 未追跡fileを持つmerge済みfinalize fixtureがある
    When fixture worktreeをfinalize dry-runする
    Then finalize dry-runは拒否しfixture worktreeを保持する
