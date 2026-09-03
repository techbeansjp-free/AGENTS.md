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

  Scenario: SCN-UNIT-BASEBRANCH-001 既定branchは宣言の有無によらずbaseとして受理する
    Given merge.branchesが空のpolicyがある
    When 既定branch"master"をそのままbaseとして受理判定する
    Then baseは受理される

  Scenario: SCN-UNIT-BASEBRANCH-002 完全一致で宣言した長命branchをbaseとして受理する
    Given "develop"と"master"を長命branchとするpolicyがある
    When 既定branch"master"のもとで"develop"をbaseとして受理判定する
    Then baseは受理される

  Scenario: SCN-UNIT-BASEBRANCH-003 宣言していないbranchをbaseとして拒否する
    Given "develop"と"master"を長命branchとするpolicyがある
    When 既定branch"master"のもとで"staging"をbaseとして受理判定する
    Then baseは拒否され受理集合を示す診断が返る

  Scenario: SCN-UNIT-BASEBRANCH-004 wildcardを含む宣言はbaseにしない
    Given "feature/*"だけを宣言したpolicyがある
    When 既定branch"master"のもとで"feature/*"をbaseとして受理判定する
    Then baseは拒否されwildcardを理由に示す診断が返る

  Scenario: SCN-UNIT-BASEBRANCH-005 wildcard宣言は受理集合へ入らない
    Given "feature/*"だけを宣言したpolicyがある
    When 既定branch"master"の受理集合を読む
    Then 受理集合は"master"だけである

  Scenario Outline: SCN-UNIT-BASEBRANCH-006 revision syntaxをbase候補にしない
    Given "<declared>"だけを宣言したpolicyがある
    When 既定branch"master"のもとで"<declared>"をbaseとして受理判定する
    Then baseは拒否される

    Examples:
      | declared |
      | main~1   |
      | main^    |
      | a..b     |
      | x@{1}    |
      | -bad     |
      | HEAD     |
      | refs/heads/main |

  Scenario Outline: SCN-UNIT-BASEBRANCH-007 正当なbranch名は受理する
    Given "<declared>"だけを宣言したpolicyがある
    When 既定branch"master"のもとで"<declared>"をbaseとして受理判定する
    Then baseは受理される

    Examples:
      | declared    |
      | develop     |
      | release/1.0 |
      | feat.x      |
      | ok/nested   |
