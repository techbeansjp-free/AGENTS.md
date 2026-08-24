@unit @provider-routing
Feature: provider routingのproject choice
  role別のmodel設定をprojectが所有し、model tierと実行設定を独立に扱えることを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-003 model tierの選択はreasoning effortと速度を変えない
    Given 構造化したmodelMappingを持つproject choiceを読み込む
    When implementerのmodel設定を確認する
    Then project choiceのreasoning effortはhighである
    And 処理速度はstandardである
    And Codex利用不能時のfallbackはClaude coordinatorのproject defaultである
