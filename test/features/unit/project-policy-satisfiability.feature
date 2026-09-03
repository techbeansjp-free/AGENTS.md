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

  Scenario: SCN-UNIT-SAT-021 未登録check-refの診断が導出規則と登録済みcheckIdを示す
    Given 未登録check-refと登録済みruleを持つbindingがある
    When project ruleを与えてapplicability bindingを検証する
    Then check-ref診断は導出規則と登録済みcheckIdを示す

  Scenario: SCN-UNIT-SAT-022 rule 0件のときも診断が導出規則を示す
    Given 未登録check-refとruleを1件も持たないbindingがある
    When project ruleを与えてapplicability bindingを検証する
    Then check-ref診断は導出規則と登録済みcheckIdを示す

  Scenario Outline: SCN-UNIT-SAT-023 登録済みcheckIdは上限ちょうどで全件、上限超で打ち切る
    Given 未登録check-refと<件数>件のruleを持つbindingがある
    When project ruleを与えてapplicability bindingを検証する
    Then check-ref診断は導出規則と登録済みcheckIdを示す

    Examples:
      | 件数 |
      | 20 |
      | 21 |

  Scenario: SCN-UNIT-SAT-024 2経路の未登録check-ref診断が文字列として一致する
    Given 未登録check-refと登録済みruleを持つbindingがある
    When project ruleを与えてapplicability bindingを検証する
    And repository conformanceを新しいenforcement pointで検証する
    Then check-ref診断は2経路で文字列として一致する

  Scenario: SCN-UNIT-SAT-025 導出できないruleIdを上限件数まで安全な形で示す
    Given 未登録check-refと導出できないruleIdを持つbindingがある
    When project ruleを与えてapplicability bindingを検証する
    Then check-ref診断は導出できないruleIdの件数と例を示す

  Scenario: SCN-UNIT-SAT-026 binding schemaのcheckIdが導出規則の正本を参照する
    Given 配布するconformance binding schemaがある
    When project ruleを与えてapplicability bindingを検証する
    Then checkIdのdescriptionは導出規則の正本を参照する

  # executableSourceが正規表現literalを認識しないと、引用符の偶奇が反転してliteralの中身が
  # codeとして漏れ出す。実在しないexportを実在と誤認し、enforcementの存在確認を迂回できる。
  #
  # verdictは3値である。valid（exportが実在する）、invalid（実在しない）、
  # unparsable（sourceを解析できず実在を判定できない）。**invalidとunparsableを
  # 同じ値へ潰さない。** 利用者が次に採る操作が異なる（Issue #1134）。
  # いずれの場合もerrorを積むため、判定不能を合格へ倒す経路は無い。
  Scenario Outline: SCN-UNIT-SAT-014 enforcement exportの走査が正規表現literalに壊されない
    Given "<fixture>"のenforcement exportを参照するbindingがある
    When repository conformanceを新しいenforcement pointで検証する
    Then enforcement exportの判定は"<verdict>"になる

    Examples:
      | fixture | verdict |
      | odd-quote-regex | valid |
      | ghost-in-comment | invalid |
      | division | valid |
      | unterminated-string | unparsable |
      | keyword-regex | invalid |
      | division-assign | valid |
      | decimal-divide | unparsable |
      | string-divide | unparsable |
      | postfix-divide | unparsable |
      | regex-divide | unparsable |
      | nested-template | invalid |
      | eof-line-comment | valid |

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

  Scenario: SCN-UNIT-SAT-015 project choice縮小の拒否理由が縮小提案の登録手順を示す
    Given testLayersを縮小したcandidate policyがある
    When trusted policyから縮小差分を比較する
    Then 縮小の拒否理由は縮小提案の登録手順を示す
