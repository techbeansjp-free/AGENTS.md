@unit
Feature: 配布templateの要件ID体系を製品と一致させる

  Scenario: SCN-UNIT-REQID-001 現行の配布templateは規定体系に合格する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-001"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-002 旧体系のFR識別子を拒否する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-002"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-003 旧体系のNFR識別子を拒否する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-003"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-004 domainのない受け入れ条件IDを拒否する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-004"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-005 domainの決め方の記述欠落を拒否する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-005"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-006 templateが欠落している場合に拒否する
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-006"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる

  Scenario: SCN-UNIT-REQID-007 製品自身の要件IDが同じ体系である
    Given 要件ID体系検査の準備がある
    When "SCN-UNIT-REQID-007"の要件ID体系検査を実行する
    Then 要件ID体系検査は期待結果になる
