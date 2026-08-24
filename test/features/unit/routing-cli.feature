@unit @provider-routing
Feature: routing CLI診断
  停止理由から次の操作までを色や表示幅に依存しない構造で返す。

  Scenario: SCN-UNIT-ROUTING-010 診断は必須7項目を持つ
    Given routing解決が拒否された
    When routing診断を整形する
    Then 診断はrule IDと目的とリスクと根拠と次の操作と必要authorityとrollbackを持つ
    And routing診断の必須項目はいずれも空でない
