@integration
Feature: 実repositoryで正本複製が解消されている

  Scenario: SCN-INT-CANON-001 規範宣言locationに登録契約の複製が残っていない
    Given 実repositoryの契約正本registryがある
    When 規範宣言locationのMarkdownを走査する
    Then 登録契約の違反は0件である

  Scenario: SCN-INT-CANON-002 正本単一化ruleがorphanにならない
    Given 正本単一化ruleを含む実repositoryのrule台帳がある
    When rule coverageを算出する
    Then orphansに正本単一化ruleは含まれない

  Scenario: SCN-INT-CANON-003 既存ruleとorphan件数を維持する
    Given 正本単一化ruleを含む実repositoryのrule台帳がある
    When rule coverageを算出する
    Then ruleは21件でorphansは0件である

  Scenario: SCN-INT-CANON-004 実repositoryの走査対象が範囲外を含まない
    Given 実repositoryがある
    When 実repositoryの走査対象file集合を構築する
    Then 集合は証跡と一時ステージングのfileを含まない

  Scenario: SCN-INT-CANON-005 契約正本registryが無い場合は適合ではなく拒否する
    Given 契約正本registryを持たないdirectoryがある
    When conformance検査で正本複製を検査する
    Then 検査はregistry不在を診断として報告する

  Scenario: SCN-INT-CANON-006 ruleのscopeは実装の走査locationと一致する
    Given 正本単一化ruleの定義がある
    When rule scopeと走査locationを突合する
    Then 突合は差異0件で一致する
