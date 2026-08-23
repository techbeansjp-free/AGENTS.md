@integration
Feature: Packageとworktree lifecycleでconsumer dataを保護する

  Scenario: SCN-INT-LIFECYCLE-001 initはdry-runとatomic applyを分離する
    Given 空のconsumer directoryがある
    When initをdry-runしてからapplyする
    Then dry-run時はassetが存在しない
    And apply後はmanaged asset recordが存在する

  Scenario: SCN-INT-LIFECYCLE-002 init conflictはpartial writeを発生させない
    Given consumerの運用ポリシー文書が既に存在する
    When init applyを試みる
    Then initは失敗する
    And AGENTS.mdは作成されない

  Scenario: SCN-INT-LIFECYCLE-003 upgradeはmodified assetとconsumer spec/policyを保持する
    Given packageをinstall済みのconsumerがある
    And consumerが品質基準、project policy、docs specsを変更している
    When upgradeをapplyする
    Then consumer変更はすべて保持される

  Scenario: SCN-INT-LIFECYCLE-004 uninstallはmodified assetとtransient stagingを保持する
    Given packageをinstall済みのconsumerがある
    And consumerが品質基準とtransient stagingを持つ
    When uninstallをapplyする
    Then modified品質基準とtransient stagingは保持される

  Scenario: SCN-INT-LIFECYCLE-005 doctorはlegacy harnessを診断するだけで実行しない
    Given packageをinstall済みでlegacy .agentsと.workflowを持つconsumerがある
    When doctorを実行する
    Then legacy directoryを2件報告する
    And legacy runtime enabledはfalseである

  Scenario: SCN-INT-LIFECYCLE-006 改ざんされたasset recordでconsumer外のfileを削除しない
    Given packageをinstall済みのconsumerがある
    And managed asset recordへconsumer外の一致hash fileを混入する
    When uninstallをapplyして失敗を確認する
    Then uninstallは失敗する
    And consumer外のfileは保持される

  Scenario: SCN-INT-WORKTREE-001 sourceがdirtyでもその状態を変更せず専用worktreeを作る
    Given dirty fileを持つ一時Git repositoryがある
    When 新しいbranchと専用pathでworktreeを作成する
    Then source dirty statusは作成前後で同一である
    And 専用worktreeに指定branchがある

  Scenario: SCN-INT-WORKTREE-002 origin repositoryを誤認したらworktreeを作らない
    Given 異なるorigin URLを持つ一時Git repositoryがある
    When 期待repositoryを指定してworktreeを作成する
    Then worktree createは失敗する
    And 専用pathは存在しない

  Scenario: SCN-INT-WORKTREE-003 origin URLの部分一致をrepository一致と誤認しない
    Given 期待repository文字列を一部に含む別originの一時Git repositoryがある
    When 期待repositoryを指定してworktreeを作成する
    Then worktree createは失敗する
    And 専用pathは存在しない

  Scenario: SCN-INT-WORKTREE-004 push済み上流branchをfinalizeのrecovery参照にする
    Given remoteへpush済みのcleanな専用worktreeがある
    When finalize stateをread-onlyで検査する
    Then recovery参照は上流branchで到達可能である
