Feature: shard実行scriptのfixture（失敗を含む）

  Scenario: 成功する1件目
    Given shard fixtureの成功step

  Scenario: 成功する2件目
    Given shard fixtureの成功step

  Scenario: 成功する3件目
    Given shard fixtureの成功step

  Scenario: 失敗する1件
    Given shard fixtureの失敗step
