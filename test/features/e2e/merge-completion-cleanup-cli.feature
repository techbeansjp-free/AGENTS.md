@e2e @wtclean
Feature: CLIはmerge後のroot更新と対象worktree cleanupを安全に完了する

  Scenario: SCN-E2E-WTCLEAN-001 マージ後のmain更新に続いて対象worktreeを安全に削除する
    Given merge済みmainとsafeな対象worktreeを持つ隔離CLI repositoryがある
    When cleanup previewを承認してmerge完了CLIをapplyする
    Then main更新と対象cleanupだけがcompletedになる

  Scenario: SCN-E2E-WTCLEAN-003 cleanup authorityがない場合はmain更新済み・cleanup pendingを返す
    Given merge済みmainとsafeな対象worktreeを持つ隔離CLI repositoryがある
    When cleanup authorityなしでmerge完了CLIをapplyする
    Then mainは更新されcleanup pendingで対象は保持される

  Scenario: SCN-E2E-WTCLEAN-006 cleanup失敗をpartially-completedとし同じ入力の再実行で安全に収束する
    Given cleanup失敗後のroot currentな完了phaseがある
    When 同じ完了結果を事後確認し直す
    Then 初回はpartially-completedで再確認後はcompletedになる

  Scenario: SCN-E2E-WTCLEAN-007 remote branch削除後もapply経路でcleanupが完了する
    Given remote branchを削除したmerge済みCLI repositoryがある
    When cleanup previewを承認してmerge完了CLIをapplyする
    Then main更新と対象cleanupだけがcompletedになる

