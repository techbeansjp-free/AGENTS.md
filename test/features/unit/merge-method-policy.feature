@unit @merge-method-policy
Feature: branch関係に応じて安全なmerge方式を解決する

  Scenario: SCN-UNIT-MERGEMETHOD-001 branch単位のmethodsがbase branchで解決される
    Given base branch "develop"へsquashだけを許可するbranch単位policyがある
    When "feature/topic"から"develop"へ"squash"方式を解決する
    Then merge方式は許可されresolved methodsは"squash"である

  Scenario: SCN-UNIT-MERGEMETHOD-002 複数entryが一致する場合は積集合を使い空なら拒否する
    Given base branch "develop"へ互いに共通しない複数のbranch単位policyがある
    When "feature/topic"から"develop"へ"merge"方式を解決する
    Then merge方式は拒否されresolved methodsは空である

  Scenario: SCN-UNIT-MERGEMETHOD-003 branch単位指定でglobalな許可を拡大できない
    Given globalにない方式をbranch単位policyが許可している
    When merge policyをruntime検証する
    Then branch単位policyはglobalな許可の拡大として拒否される

  Scenario: SCN-UNIT-MERGEMETHOD-004 長命branch同士のsquashを拒否する
    Given "develop"と"master"を長命branchとするpolicyがある
    When "develop"から"master"へ"squash"方式を解決する
    Then merge方式は拒否される

  Scenario: SCN-UNIT-MERGEMETHOD-005 長命branch同士のrebaseを拒否する
    Given "develop"と"master"を長命branchとするpolicyがある
    When "develop"から"master"へ"rebase"方式を解決する
    Then merge方式は拒否される

  Scenario: SCN-UNIT-MERGEMETHOD-006 短命branchから長命branchへのsquashを許可する
    Given "develop"と"master"を長命branchとするpolicyがある
    When "feature/topic"から"develop"へ"squash"方式を解決する
    Then merge方式は許可される

  Scenario: SCN-UNIT-MERGEMETHOD-007 拒否診断が根拠・次の操作・必要authority・rollbackを日本語で返す
    Given "develop"と"master"を長命branchとするpolicyがある
    When "develop"から"master"へ"squash"方式を解決する
    Then 拒否診断はrule ID、全面衝突の根拠、mergeでの次の操作、必要authority、rollbackを日本語で返す

  Scenario: SCN-UNIT-MERGEMETHOD-008 branchMethods未指定の既存policyが従来どおり動作する
    Given branchMethodsを持たずsquashを許可する既存policyがある
    When "feature/topic"から"develop"へ"squash"方式を解決する
    Then merge方式は許可されresolved methodsは"squash"である


  Scenario: SCN-UNIT-MERGEMETHOD-010 配布するpolicy雛形がsquashを許可しない
    Given 配布するpolicy雛形がある
    When policy雛形のmerge方式を読む
    Then policy雛形のmerge方式は"merge"だけである
