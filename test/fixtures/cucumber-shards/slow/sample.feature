Feature: shard実行scriptのfixture（中断用の待機）

  Scenario: すぐ終わる1件
    Given shard fixtureの成功step

  Scenario: 中断されるまで待機する1件
    Given shard fixtureの待機step
