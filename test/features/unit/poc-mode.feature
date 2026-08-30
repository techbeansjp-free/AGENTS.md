@unit
Feature: PoCモードをfail-closedで判定する

  Background:
    Given 完全でhigh riskのないPoC宣言がある

  Scenario: SCN-UNIT-POC-001 poc宣言が完全なときだけpocモードになる
    Given PoC宣言の全必須欄が記入済みである
    When pocを明示してモード判定する
    Then PoC判定結果はpocである
    And PoC判定理由は0件である

  Scenario: SCN-UNIT-POC-002 必須欄の欠落と不明はfullへ単調昇格する
    Given PoC宣言の目的が欠落している
    And personal-dataのhigh risk確認が不明である
    When pocを明示してモード判定する
    Then PoC判定結果はfullである
    And PoC判定理由に目的とpersonal-dataが含まれる

  Scenario: SCN-UNIT-POC-003 high risk条件があるpocはfullへ昇格または停止する
    Given external-exposureのhigh risk条件が存在する
    When pocを明示してモード判定する
    Then PoC判定結果はfullである
    And PoC判定理由にexternal-exposureとfull昇格が含まれる
    When fullからpocへの途中降格を要求する
    Then PoC判定結果はfullである

  Scenario: SCN-UNIT-POC-004 変更fileのquick失格条件はpocでも昇格を起こす
    Given PoCの変更fileに"src/public-api/client.ts"がある
    When 変更fileを含めてpocを明示判定する
    Then PoC判定結果はfullである
    And PoC判定理由にpublic-apiが含まれる

  Scenario: SCN-UNIT-POC-005 第2引数なしの既存呼び出しは従来どおりquickとfullを返す
    Given 従来判定用のQ-01〜Q-08回答がある
    When 第2引数なしで従来の完全回答と不明回答を判定する
    Then 従来判定はquickとfullである

  Scenario: SCN-UNIT-POC-006 隔離fixtureとBDD観測契約が不完全ならfullへ倒す
    Given PoC宣言のfixtureとscenarioとobservableが不完全である
    When pocを明示してモード判定する
    Then PoC判定結果はfullである
    And PoC判定理由に隔離fixtureとBDD scenarioとobservableが含まれる

  Scenario: SCN-UNIT-POC-007 宣言とexact HEADに完全一致する即時観測Evidenceを受理する
    Given 完全なPoC即時観測Evidenceがある
    When PoC即時観測Evidenceを宣言とHEADへ完全照合する
    Then PoC即時観測Evidenceは有効である

  Scenario: SCN-UNIT-POC-008 fixtureやHEADやfieldを改変した観測Evidenceを拒否する
    Given 完全なPoC即時観測Evidenceがある
    When PoC即時観測Evidenceのfixture digestとHEADとfieldを改変する
    Then PoC即時観測Evidenceはstrictに拒否される

  Scenario: SCN-UNIT-POC-009 fixtureのsymlink・hardlink・FIFO・巨大fileを拒否する
    Given fixture file境界を検査する隔離directoryがある
    When 不正なfixture file種別とbyte上限を検査する
    Then PoC fixture境界はすべてfail-closedになる

  Scenario: SCN-UNIT-POC-010 exit-codeだけで振る舞いを判定しない
    Given PoC宣言にexit-code observableしかない
    When pocを明示してモード判定する
    Then PoC判定結果はfullである
    And PoC判定理由にbehavior observableが含まれる
