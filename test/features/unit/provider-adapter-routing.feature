@unit @provider-routing
Feature: provider実行入口のread-only観測
  外部観測を上限内で安全側へ倒し、標準エラーの秘密を転記しないことを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-009 実装開始前の外部観測は2回以内である
    Given provider実行入口のread-only観測関数を注入した
    When provider availabilityを観測する
    Then 外部観測の呼び出し回数は2回以内である
    And 正常と起動不能と解釈不能は型付き観測結果を返す

  Scenario: SCN-UNIT-ROUTING-012 標準エラーの内容をどこへも転記しない
    Given 秘密を含む標準エラーを返すprovider実行関数を注入した
    When availabilityを観測する
    Then 観測結果はunknownである
    And ログと診断と例外messageとevidenceのいずれにも標準エラーの内容が現れない
