@integration @provider-routing
Feature: workflow資産のrouting入力契約
  role分離の判断を各stepで再現できるようにskillとtemplateの対応欄を検証する。

  Scenario: SCN-INT-ROUTING-007 skillとtemplateの追加欄が対応検査で検証される
    Given routing入力契約を持つべきskillとtemplateがある
    When routing入力契約の欄を検査する
    Then role欄とprovider欄とmodel設定欄とfallback欄と独立性証拠欄の対応漏れは0件である
