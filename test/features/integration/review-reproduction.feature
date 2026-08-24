@integration @provider-routing
Feature: 外部指摘の再現確認
  現コードで再現していない指摘を対応済みまたは棄却として分類しない。

  Scenario: SCN-INT-ROUTING-008 再現確認のない指摘は分類できない
    Given 再現結果を持たないresolvedの外部レビュー指摘がある
    When 外部レビュー指摘を分類する
    Then 指摘分類を拒否する
    And 現コードでの再現手順と再現結果を要求する
