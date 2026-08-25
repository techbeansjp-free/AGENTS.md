@unit @project-policy-satisfiability
Feature: 一般利用projectが正直な適用可否でpolicyを充足する
  package固有契約をconsumer実装へ虚偽にbindingせず、弱化経路も作らない。

  Scenario: SCN-UNIT-SAT-001 conformanceScope未指定は現行のrepository-boundとして扱う
    Given conformanceScopeを省略したmanifestがある
    When project policy manifestを検証する
    Then conformance fileなしはrepository-boundとして拒否される

  Scenario: SCN-UNIT-SAT-002 package-attestedはconformance fileの空配列を許可する
    Given package-attestedでconformance fileが空のmanifestがある
    When project policy manifestを検証する
    Then package-attested manifestはvalidである

  Scenario: SCN-UNIT-SAT-003 not-applicable bindingは理由と証拠を必須にしsource・enforcement・SCNを禁止する
    Given not-applicableの正常例と理由欠落と形式的配列を持つbindingがある
    When applicability bindingを検証する
    Then 正常なnot-applicableだけが合格する

  Scenario: SCN-UNIT-SAT-004 applicable bindingは現行どおりsource・enforcement・SCNを必須にする
    Given applicableの正常例と必須field欠落を持つbindingがある
    When applicability bindingを検証する
    Then 正常なapplicableだけが合格する

  Scenario: SCN-UNIT-SAT-005 file-entrypointとcheck-refのenforcement pointを検証する
    Given 実在file-entrypointと登録済みcheck-refを持つbindingがある
    When repository conformanceを新しいenforcement pointで検証する
    Then file-entrypointとcheck-refはvalidである

  Scenario: SCN-UNIT-SAT-006 実在しないpath、symlink、未登録checkIdを拒否する
    Given 不存在file-entrypointとsymlinkと未登録check-refを持つbindingがある
    When repository conformanceを新しいenforcement pointで検証する
    Then 不正なenforcement pointをすべて拒否する

  Scenario: SCN-UNIT-SAT-007 qualityの型検査系をnot-applicableとして宣言できる
    Given quality検査項目を理由と証拠付きnot-applicableにしたchoiceがある
    When project choiceを検証する
    Then quality applicabilityはvalidである

  Scenario: SCN-UNIT-SAT-008 applicableを名乗って値を持たないquality構成を拒否する
    Given quality検査項目をapplicable objectにしたchoiceがある
    When project choiceを検証する
    Then 値を持たないapplicable qualityはinvalidである

  Scenario: SCN-UNIT-SAT-009 conformance宣言の弱化を拒否し強化を許可する
    Given conformance宣言の格下げと強化candidateがある
    When trusted policyからconformance差分を比較する
    Then conformance格下げは拒否され強化は許可される

  Scenario: SCN-UNIT-SAT-010 quality宣言の格下げを弱化として拒否する
    Given quality具体値の格下げとnot-applicableからの強化candidateがある
    When project choiceのquality差分を比較する
    Then quality格下げは拒否され強化は許可される
