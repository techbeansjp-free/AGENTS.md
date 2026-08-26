@unit
Feature: test fixtureの実時計・実repository依存を機械的に拒否する

  Scenario: SCN-UNIT-TESTDET-001 Date.nowの直接使用を拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-001"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-002 引数なしのnew Dateを拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-002"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-003 Math.randomの直接使用を拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-003"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-004 引数ありのnew Dateは拒否しない
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-004"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-005 未宣言のrepository root package.json読み取りを拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-005"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-006 未宣言のproject設定読み取りを拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-006"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-007 path.joinで包んだ未宣言読み取りも拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-007"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-008 絶対pathと一時領域の読み取りは拒否しない
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-008"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-009 使われていない宣言を拒否する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-009"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-010 fixtureInstantは基準時刻からの相対値を返す
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-010"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-011 基準時刻は環境変数で注入できる
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-011"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる

  Scenario: SCN-UNIT-TESTDET-012 現行のtest/stepsは検査に合格する
    Given 決定性検査単体の準備がある
    When "SCN-UNIT-TESTDET-012"の決定性検査単体を実行する
    Then 決定性検査単体は期待結果になる
