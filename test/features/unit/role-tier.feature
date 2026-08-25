@unit @role-tier
Feature: role分離とmodel tierを安全側に検証する
  role、能力tier、provider上限をauthorityとは独立して検証する。

  Scenario: SCN-UNIT-ROLE-001 coordinatorはproduct実装操作を許可されない
    Given coordinatorのproduct実装操作がある
    When role操作契約を検証する
    Then role操作はproduct実装禁止として拒否される

  Scenario: SCN-UNIT-ROLE-002 implementerと最終reviewerの同一identityを拒否する
    Given implementerとreviewerへ同一identityを割り当てる
    When role割当契約を検証する
    Then role割当はidentity違反として拒否される

  Scenario: SCN-UNIT-ROLE-003 同一scopeで同一contextの兼務を拒否する
    Given implementerとreviewerへ同一contextを割り当てる
    When role割当契約を検証する
    Then role割当はcontext違反として拒否される

  Scenario: SCN-UNIT-ROLE-004 roleごとの許可path・操作・必要証拠を検証する
    Given implementerの許可path外と必要証拠不足の操作がある
    When role操作契約を検証する
    Then role操作はpathと証拠の違反として拒否される

  Scenario: SCN-UNIT-TIER-001 risk・mode・scopeから最低tierが単調に決まる
    Given 強度が増加するriskとscopeがある
    When 最低model tierを順に決定する
    Then model tierは単調に増加する

  Scenario: SCN-UNIT-TIER-002 根拠なしのtier降格を拒否する
    Given advancedが必要なscopeでstandardを選択する
    When model tier選択を検証する
    Then tier降格は拒否される

  Scenario: SCN-UNIT-TIER-003 mapping未定義modelへのsilent fallbackを拒否する
    Given mappingに存在しないmodelを選択する
    When model tier選択を検証する
    Then silent fallbackは拒否される

  Scenario: SCN-UNIT-TIER-004 model tierはauthorityを付与しない
    Given critical tierとauthority違反の操作がある
    When tierと操作authorityを別々に検証する
    Then tierは合格しても操作authorityは拒否される

  Scenario: SCN-UNIT-CEILING-001 上限内の選択はoverrideなしで許可する
    Given Codex highとClaude Opusをoverrideなしで選択する
    When provider自律選択上限を検証する
    Then 上限内のprovider選択は許可される

  Scenario: SCN-UNIT-CEILING-002 上限超過は対象scopeの人間override証拠がある場合だけ許可する
    Given 対象scopeに一致する人間overrideでCodex xhighとClaude Fableを選択する
    When provider自律選択上限を検証する
    Then 上限超過のprovider選択は許可される

  Scenario: SCN-UNIT-CEILING-003 別Issue・別scope・失効済みoverrideを拒否する
    Given 別Issueと別scopeと失効済みのoverrideがある
    When provider自律選択上限を検証する
    Then すべての再利用overrideは拒否される

  Scenario: SCN-UNIT-CEILING-004 AI自己発行のoverrideを拒否する
    Given coordinatorが自己発行したoverrideがある
    When provider自律選択上限を検証する
    Then AI自己発行overrideは拒否される

  Scenario: SCN-UNIT-CEILING-005 alias・自動routingによる上限回避を拒否する
    Given provider aliasと自動routing選択がある
    When provider自律選択上限を検証する
    Then aliasと自動routingは拒否される
