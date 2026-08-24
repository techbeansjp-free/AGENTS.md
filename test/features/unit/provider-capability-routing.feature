@unit @provider-routing
Feature: provider capability mappingの所有境界
  provider能力と公式推奨選択元だけをproject層が所有し、固定model slugを持たないことを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-002 汎用package資産はmodel slugを必須値として持たない
    Given project固有のprovider capability mappingを読み込む
    When project mappingと汎用packageで固定model slugを検索する
    Then 必須値としてのmodel slug該当件数は0件である
    And 未知fieldと型不正と不正な選択元のmappingを拒否する
