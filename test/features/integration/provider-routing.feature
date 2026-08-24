@integration @provider-routing
Feature: provider routingのproject choice互換性
  構造化設定を有効にしても未設定projectの既存動作を維持できることを具体例で示す。

  Scenario: SCN-INT-ROUTING-006 modelMapping未設定の既存projectは動作が変わらない
    Given modelMapping設定済みと未設定のproject choice fixtureがある
    When 両方のproject choice fixtureを読み込む
    Then 両方のproject choice fixtureは読み込みに成功する
    And 設定済みfixtureのevidence store rootはproject choiceが所有する
    And 未設定fixtureのmodelMappingはundefinedである
