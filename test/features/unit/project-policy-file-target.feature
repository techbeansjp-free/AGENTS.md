@unit @project-policy-file-target
Feature: policy検証が利用者の指定したmanifestを実際に検証する

  Scenario: SCN-UNIT-POLICYFILE-001 契約に反するmanifestを渡すと不合格になる
    Given 実project policy setのrootと"契約違反"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補manifestの検証結果は"不合格"である

  Scenario: SCN-UNIT-POLICYFILE-002 不合格の診断が不正なfieldを名指しする
    Given 実project policy setのrootと"契約違反"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補manifestの診断は"manifest.policy.merge.modeが不正です"を含む

  Scenario: SCN-UNIT-POLICYFILE-003 実manifestと同一内容の候補は合格する
    Given 実project policy setのrootと"同一内容"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補manifestの検証結果は"合格"である

  Scenario: SCN-UNIT-POLICYFILE-004 内容の異なる有効な候補は異なるhashになる
    Given 実project policy setのrootと"有効な3件"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補setのhashは"3件とも互いに異なる"

  Scenario: SCN-UNIT-POLICYFILE-005 実manifestのhashは作業treeのsetと一致する
    Given 実project policy setのrootと"同一内容"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補setのhashは"作業treeのsetと一致する"

  Scenario: SCN-UNIT-POLICYFILE-006 宣言inventoryが実directoryと一致しないと不合格になり作業treeのhashを返さない
    Given 実project policy setのrootと"inventory不一致"の候補manifestがある
    When 候補manifestを与えてproject policy setを検証する
    Then 候補manifestの検証結果は"不合格"である
    And 候補setのhashは"作業treeのsetと一致しない"
