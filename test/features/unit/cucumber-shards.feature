@unit
Feature: 全Cucumberのscenario単位shard分配と集約

  Scenario: SCN-UNIT-SHARD-001 全scenario位置を重複なく分配し合併が全集合と一致する
    Given scenario位置が5件ある
    When shard数3で分配する
    Then 3つのshardの合併は5件の全集合と一致し重複が無い

  Scenario: SCN-UNIT-SHARD-002 shard数がscenario数を超えると空shardを作らない
    Given scenario位置が2件ある
    When shard数4で分配する
    Then shardは2つだけ作られ各1件を持つ

  Scenario: SCN-UNIT-SHARD-003 重複した位置または空の全集合を実行前に拒否する
    Given 同じscenario位置が2回現れる
    When shard数2で分配する
    Then 分配は重複位置を名指しする診断で拒否される
    And 空の全集合の分配は0件を名指しする診断で拒否される

  Scenario: SCN-UNIT-SHARD-004 不正なshard数を実行前に拒否する
    Given 環境変数ASC_TEST_SHARDSが"0"である
    When shard数を解決する
    Then 正の整数を要求する診断で拒否される

  Scenario: SCN-UNIT-SHARD-005 全shardが成功し実行集合が割当と一致すれば成功とする
    Given 2つのshardがともに終了値0で割当どおりのscenarioを実行した
    When 結果を集約する
    Then 全体は成功で終了値0になる

  Scenario: SCN-UNIT-SHARD-006 signalで終了したshardがあれば失敗とする
    Given 1つのshardがSIGKILLで終了した
    When 結果を集約する
    Then 全体は失敗で要約はそのshardとsignalを名指しする

  Scenario: SCN-UNIT-SHARD-007 実行記録を読めないshardは失敗とする
    Given 1つのshardのmessage記録が存在しない
    When 結果を集約する
    Then 全体は失敗で要約はそのshardの記録欠落を名指しする

  Scenario: SCN-UNIT-SHARD-008 終了値0でも実行集合が割当と異なれば失敗とする
    Given 1つのshardが終了値0で割当3件のうち2件だけを実行した
    When 結果を集約する
    Then 全体は失敗で要約は未実行の位置を名指しする
