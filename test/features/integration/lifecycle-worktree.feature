@integration
Feature: Packageとworktree lifecycleでconsumer dataを保護する

  Scenario: SCN-INT-LIFECYCLEBASE-001 installはdry-runとatomic applyを分離する
    Given 空のconsumer directoryがある
    When install domainをdry-runしてからapplyする
    Then dry-run時はassetが存在しない
    And apply後はmanaged asset recordが存在する
    And managed asset recordのversionはpackage.jsonと一致する

  Scenario: SCN-INT-LIFECYCLEBASE-002 install conflictはpartial writeを発生させない
    Given consumerの運用ポリシー文書が既に存在する
    When install domainのapplyを試みる
    Then installは失敗する
    And AGENTS.mdは作成されない

  Scenario: SCN-INT-LIFECYCLEBASE-003 updateはmodified assetとconsumer spec/policyを保持する
    Given packageをinstall済みのconsumerがある
    And consumerが品質基準、project policy、docs specsを変更している
    When update domainをapplyする
    Then consumer変更はすべて保持される

  Scenario: SCN-INT-LIFECYCLEBASE-004 deleteはmodified assetとtransient stagingを保持する
    Given packageをinstall済みのconsumerがある
    And consumerが品質基準とtransient stagingを持つ
    When delete domainをapplyする
    Then modified品質基準とtransient stagingは保持される

  Scenario: SCN-INT-LIFECYCLEBASE-005 doctorはlegacy harnessを診断するだけで実行しない
    Given packageをinstall済みでlegacy .agentsと.workflowを持つconsumerがある
    When doctorを実行する
    Then legacy directoryを2件報告する
    And legacy runtime enabledはfalseである

  Scenario: SCN-INT-LIFECYCLEBASE-006 改ざんされたasset recordでconsumer外のfileを削除しない
    Given packageをinstall済みのconsumerがある
    And managed asset recordへconsumer外の一致hash fileを混入する
    When delete domainをapplyして失敗を確認する
    Then deleteは失敗する
    And consumer外のfileは保持される

  Scenario: SCN-INT-LIFECYCLEBASE-007 updateは新規package pathにあるconsumer fileを上書きしない
    Given 旧version導入後にconsumerが同名の利用案内を作成している
    When update domainをapplyする
    Then consumerの同名利用案内は保持される

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

  Scenario: SCN-INT-WORKTREE-005 symlink祖先でGit内部領域を偽装できない
    Given Git common dirを指すsymlink祖先のworktree pathがある
    When symlink祖先配下へworktreeを作成する
    Then worktree createは失敗する
    And 専用pathは存在しない

  Scenario: SCN-INT-WORKTREE-010 宣言済み長命branchを基点にworktreeを作れる
    Given "develop"を長命branchとして宣言したtrusted policyと一時Git repositoryがある
    When "develop"を基点にworktreeを作成する
    Then 宣言済みbaseのworktreeが作られる

  Scenario: SCN-INT-WORKTREE-011 宣言していないbranchを基点にできない
    Given "develop"を長命branchとして宣言したtrusted policyと一時Git repositoryがある
    When "staging"を基点にworktreeを作成する
    Then worktree createは失敗する
    And errorに受理するbaseの一覧が含まれる

  Scenario: SCN-INT-WORKTREE-012 trusted policyを観測せず既定branch以外を基点にできない
    Given trusted policyなしで"develop"を持つ一時Git repositoryがある
    When trusted policyを渡さず"develop"を基点にworktreeを作成する
    Then worktree createは失敗する
    And errorにtrusted policyの観測が必要である旨が含まれる

  Scenario: SCN-INT-WORKTREE-013 base branchのtipが取得済みSHAと異なれば作らない
    Given "develop"を長命branchとして宣言したtrusted policyと一時Git repositoryがある
    When 誤ったbase SHAで"develop"を基点にworktreeを作成する
    Then worktree createは失敗する
    And errorにbase branchのtip不一致が含まれる

  Scenario: SCN-INT-WORKTREE-014 基点commitがbase branchのtipと異なれば作らない
    Given "develop"を長命branchとして宣言したtrusted policyと一時Git repositoryがある
    When base branchのtipでない基点で"develop"を基点にworktreeを作成する
    Then worktree createは失敗する
    And errorに基点とbase branch commitの不一致が含まれる

  Scenario: SCN-INT-WORKTREE-015 既定branchを明示しても別SHAを基点にできない
    Given "develop"を長命branchとして宣言したtrusted policyと一時Git repositoryがある
    When 既定branchを明示し別SHAを指定してworktreeを作成する
    Then worktree createは失敗する
    And errorに既定branch SHAの不一致が含まれる
