@integration
Feature: shard実行scriptの合成経路

  Scenario: SCN-INT-SHARD-001 成功だけのfeature集合を並列実行すると0で終わる
    Given 成功するscenario4件を持つfixture設定がある
    When shard数2でshard実行scriptを実行する
    Then 終了値は0で全体の実行件数は4件になる

  Scenario: SCN-INT-SHARD-002 失敗を含むfeature集合を並列実行すると非0で終わる
    Given 成功3件と失敗1件を持つfixture設定がある
    When shard数2でshard実行scriptを実行する
    Then 終了値は非0で要約は失敗したshardを名指しする
