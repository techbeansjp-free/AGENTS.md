@unit
Feature: 判定入力から分離したparallel progress evidenceの純粋契約

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

  Scenario: SCN-UNIT-PROGRESS-022 mode不一致を分類済みの不成立として返す
    Given parallel progressの純粋fixtureがある
    When "mode-mismatch" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-023 symlink対象ではchmodを案内しない
    Given parallel progressの純粋fixtureがある
    When "symlink-target" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-024 診断は相対pathとcommand名だけを出す
    Given parallel progressの純粋fixtureがある
    When "diagnostic-scope" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-UNIT-PROGRESS-025 marker不正とtask ID 0件を同じ分類で扱う
    Given parallel progressの純粋fixtureがある
    When "inventory-unbuildable" のparallel progress反例を評価する
    Then parallel progress契約を満たす
