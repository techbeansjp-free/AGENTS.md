@unit
Feature: Shadow評価の比較と欠測を区別する
  Scenario: SCN-UNIT-SHADOW-EVAL-001 指定記録の決定的集計
    Given 二十件の参照値付きshadow評価記録を用意する
    When shadow記録の評価を生成する
    Then 別stagingの同じ判断IDを混同せずshadow評価を再現する
  Scenario: SCN-UNIT-SHADOW-EVAL-002 不正照合を証拠から除く
    Given 二十件の参照値付きshadow評価記録を用意する
    When shadow記録の評価を生成する
    Then 重複と孤立と不整合を除外し汚染stagingを分離する
  Scenario: SCN-UNIT-SHADOW-EVAL-003 reference比較と十分性
    Given 二十件の参照値付きshadow評価記録を用意する
    When shadow記録の評価を生成する
    Then referenceを正解として十九件と二十件の精度と分母ゼロを区別する
  Scenario: SCN-UNIT-SHADOW-EVAL-004 観測値と欠測の区別
    Given 二十件の参照値付きshadow評価記録を用意する
    When shadow記録の評価を生成する
    Then shadow失敗tokenとconfidence校正の欠測を区別する
