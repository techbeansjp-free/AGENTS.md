Feature: shard実行scriptのfixture（成功だけ）

  Scenario: 成功する1件目
    Given shard fixtureの成功step

  Scenario: 成功する2件目
    Given shard fixtureの成功step

  Scenario Outline: 成功する例<番号>
    Given shard fixtureの成功step

    Examples:
      | 番号 |
      | 1    |
      | 2    |
