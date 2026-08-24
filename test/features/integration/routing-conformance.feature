@integration @provider-routing
Feature: provider routingの所有境界conformance
  project固有のmodel slugが汎用package資産の必須値にならないことをconformanceで検証する。

  Scenario: SCN-INT-ROUTING-005 汎用packageとproject mappingの所有境界を検証する
    Given provider routingのconformance bindingを読み込む
    When model slug所有境界のbindingを検査する
    Then 所有境界bindingは汎用packageのmodel slug検査を持つ
    And 汎用packageのmodel slug所有境界違反は0件である
    And 所有境界bindingはroutingの反例シナリオを持つ
