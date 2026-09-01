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

  Scenario: SCN-INT-FINALIGN-006 cleanup計画でも既定branch到達の免除が働く
    Given remote branchを失ったmerge済みfinalize fixtureがある
    When fixture worktreeをfinalize dry-runする
    Then cleanup計画はreadyである

  Scenario: SCN-INT-FINALIGN-007 --complete経路でも既定branch到達の免除が働く
    Given remote branchを失ったmerge済みfinalize fixtureがある
    When fixture worktreeを--completeでfinalize dry-runする
    Then cleanup preview phaseは拒否されない

  Scenario: SCN-INT-FINALIGN-008 apply経路でも既定branch到達の免除が働く
    Given remote branchを失ったmerge済みfinalize fixtureがある
    When fixture worktreeを--completeでfinalize applyする
    Then apply時のcleanup preview phaseも拒否されない

  Scenario: SCN-INT-FINALIGN-009 --complete無しのapply経路でも免除が働く
    Given remote branchを失ったmerge済みfinalize fixtureがある
    When fixture worktreeをfinalize applyする
    Then applyはworktreeを削除しbranchを保持する

  Scenario: SCN-INT-FINALIGN-010 既定branchから到達できなければ免除しない
    Given 既定branchから到達できないfinalize fixtureがある
    When fixture worktreeをfinalize dry-runする
    Then cleanup計画はupstream由来の理由で拒否される

  Scenario: SCN-INT-FINALIGN-011 --complete経路でも到達できなければ免除しない
    Given 既定branchから到達できないfinalize fixtureがある
    When fixture worktreeを--completeでfinalize dry-runする
    Then cleanup preview phaseはupstream由来の理由で拒否される

  Scenario: SCN-INT-FINALIGN-012 --complete applyでも到達できなければ免除しない
    Given 既定branchから到達できないfinalize fixtureがある
    When fixture worktreeを--completeでfinalize applyする
    Then applyは到達不能を理由に完了しない

  Scenario: SCN-INT-FINALIGN-013 --complete無しのapplyでも到達できなければ免除しない
    Given 既定branchから到達できないfinalize fixtureがある
    When fixture worktreeをfinalize applyする
    Then applyは到達不能を理由に完了しない

