@integration @provider-routing
Feature: provider routingのcatalog解決
  公式catalog fixtureのrecommended default差し替えだけで最新の推奨coding modelへ解決できることを具体例で示す。

  Scenario: SCN-INT-ROUTING-001 起票時点のcatalog fixtureはgpt-5.6-solへ解決する
    Given 起票時点のcatalog fixtureとtrusted mappingを読み込む
    When 最高位coding tierを解決する
    Then 解決済みmodelはgpt-5.6-solである
    And mapping versionを記録する

  Scenario: SCN-INT-ROUTING-002 公式推奨が変わったfixtureはsource変更なしで新modelへ解決する
    Given catalog fixtureの公式recommended defaultを新modelへ変更する
    When sourceを変更せずに最高位coding tierを解決する
    Then 解決済みmodelは追加したmodelである
