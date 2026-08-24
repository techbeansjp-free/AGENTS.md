@integration @provider-routing
Feature: provider routingのcatalog解決
  catalog fixtureとtrusted mappingの差し替えだけで最高位coding tierへ解決できることを具体例で示す。

  Scenario: SCN-INT-ROUTING-001 起票時点のcatalog fixtureはgpt-5.6-solへ解決する
    Given 起票時点のcatalog fixtureとtrusted mappingを読み込む
    When 最高位coding tierを解決する
    Then 解決済みmodelはgpt-5.6-solである
    And mapping versionを記録する

  Scenario: SCN-INT-ROUTING-002 上位modelを足したfixtureはsource変更なしで新modelへ解決する
    Given catalog fixtureとtrusted mappingへ最上位のmodelを1件追加する
    When sourceを変更せずに最高位coding tierを解決する
    Then 解決済みmodelは追加したmodelである
