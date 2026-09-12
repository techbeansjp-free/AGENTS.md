@integration
Feature: parallel progress evidenceのadapter境界

  Scenario: SCN-INT-PROGRESS-001 固定H_implへ実adapterで進捗を追記する
    Given parallel progressの実adapter fixtureがある
    When review入力を変えずcompleted進捗を実際にappendする
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-002 digest chainで改変を検出する
    Given parallel progressの純粋fixtureがある
    When "digest-chain" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-003 review bindingを固定する
    Given parallel progressの純粋fixtureがある
    When "binding" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-009 target path traversalを拒否する
    Given parallel progressの純粋fixtureがある
    When "traversal" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-010 Unicode制御taskを拒否する
    Given parallel progressの純粋fixtureがある
    When "unicode" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-011 stale digest競合を検出する
    Given parallel progressの純粋fixtureがある
    When "stale" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-012 途中JSONを拒否する
    Given parallel progressの純粋fixtureがある
    When "partial" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-013 seal後追記を拒否する
    Given parallel progressの純粋fixtureがある
    When "sealed" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-014 journal上限を拒否する
    Given parallel progressの純粋fixtureがある
    When "limit" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-021 並行critical pathは直列時間を超えない
    Given parallel progressの純粋fixtureがある
    When "critical-path" のparallel progress反例を評価する
    Then parallel progress契約を満たす
