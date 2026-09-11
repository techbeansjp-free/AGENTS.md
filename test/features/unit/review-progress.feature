@unit
Feature: 判定入力から分離したparallel progress evidence

  Scenario: SCN-INT-PROGRESS-001 固定H_implへ進捗を追記する
    Given parallel progressの純粋fixtureがある
    When "append" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-002 digest chainで改変を検出する
    Given parallel progressの純粋fixtureがある
    When "digest-chain" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-003 review bindingを固定する
    Given parallel progressの純粋fixtureがある
    When "binding" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-004 journalを決定論的に投影する
    Given parallel progressの純粋fixtureがある
    When "projection" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-005 prefix改変を拒否する
    Given parallel progressの純粋fixtureがある
    When "prefix" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-006 suffix改変を拒否する
    Given parallel progressの純粋fixtureがある
    When "suffix" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-007 projectionの1 byte差を拒否する
    Given parallel progressの純粋fixtureがある
    When "one-byte" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-008 file mode変更を拒否する
    Given parallel progressの純粋fixtureがある
    When "mode" のparallel progress反例を評価する
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

  Scenario: SCN-UNIT-PROGRESS-015 progressから判定結果を導出しない
    Given parallel progressの純粋fixtureがある
    When "no-verdict" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-016 progressからdelivery authorityを導出しない
    Given parallel progressの純粋fixtureがある
    When "no-delivery" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-017 dependency cycleを持たない
    Given parallel progressの純粋fixtureがある
    When "acyclic" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-E2E-PROGRESS-018 marker無しは直列経路へ戻る
    Given parallel progressの純粋fixtureがある
    When "absent" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-E2E-PROGRESS-019 journal無しの既存anchorを読める
    Given parallel progressの純粋fixtureがある
    When "legacy" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-E2E-PROGRESS-020 公開CLI契約にprogress操作がある
    Given parallel progressの純粋fixtureがある
    When "cli" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-021 並行critical pathは直列時間を超えない
    Given parallel progressの純粋fixtureがある
    When "critical-path" のparallel progress反例を評価する
    Then parallel progress契約を満たす
