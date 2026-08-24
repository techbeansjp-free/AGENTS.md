@unit @provider-routing
Feature: provider capability mappingの所有境界
  provider固有のmodel能力と順位をproject層だけが所有することを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-002 汎用package資産はmodel slugを必須値として持たない
    Given project固有のprovider capability mappingを読み込む
    When 汎用packageのschemaとtemplateとsourceでmodel slugを検索する
    Then 必須値としてのmodel slug該当件数は0件である
    And 未知fieldと型不正と非昇順rankのmappingを拒否する
