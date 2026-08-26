@unit
Feature: 正しさと速さの命題を規範的正本が保持する

  Scenario: SCN-UNIT-PROP-001 目的と成立条件の節が両立を定める
    Given 規範的正本の運用ポリシーがある
    When 目的と成立条件の節を読む
    Then 正しさと速さの双方が成立条件であると読める

  Scenario: SCN-UNIT-PROP-002 速さの観測基準を持つ
    Given 規範的正本の運用ポリシーがある
    When 目的と成立条件の節を読む
    Then 支援層の所要時間が成果物構築の所要時間を上回らないことを含む

  Scenario: SCN-UNIT-PROP-003 手段の追加より縮小を先に評価すると定める
    Given 規範的正本の運用ポリシーがある
    When 目的と成立条件の節を読む
    Then 既存手段の縮小を先に評価すると読める

  Scenario: SCN-UNIT-PROP-004 索引が新節を指す
    Given 利用案内がある
    When 索引の参照を解決する
    Then 目的と成立条件の節へ到達できる

  Scenario: SCN-UNIT-PROP-005 開発ワークフローから新節を参照できる
    Given 規範的正本の開発ワークフローがある
    When 薄い支援層の記述から参照を解決する
    Then 目的と成立条件の節へ到達できる

  Scenario: SCN-UNIT-PROP-006 既存節を改変しない
    Given 規範的正本の運用ポリシーがある
    When 既存の節構成を読む
    Then 権限と所有権とrole分離とfail-closedとconformanceとrisk比例型ruleの各節が残っている
