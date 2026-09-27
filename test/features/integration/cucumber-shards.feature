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

  Scenario: SCN-INT-SHARD-003 構文errorのfeatureを列挙から落とさず実行前に失敗する
    Given 構文errorのfeatureを含むfixture設定がある
    When shard数2でshard実行scriptを実行する
    Then 終了値は非0で診断は構文errorのfeatureを名指しする

  Scenario: SCN-INT-SHARD-004 停止signalを子processへ転送し途中の出力を残して失敗で終える
    Given 1件がすぐ終わり1件が中断されるまで終わらないfixture設定がある
    When shard数2でshard実行scriptを起動し実行中にSIGTERMを送る
    Then 終了値は非0で実行中のshardの中断だけが出力され一時directoryが残らない
