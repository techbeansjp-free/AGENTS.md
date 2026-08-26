@unit
Feature: 独立reviewが成立しない場合の例外を正本で管理する

  Scenario: SCN-UNIT-RVX-001 現行の例外正本は検査に合格する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-001"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-002 必須fieldの欠落を拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-002"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-003 未知fieldを拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-003"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-004 失効した例外を拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-004"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-005 無期限を示すnullは未記入と区別して受理する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-005"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-006 失効日時のkey省略を拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-006"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-007 一時的な失敗を例外として宣言できない
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-007"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-008 許可外の種別を拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-008"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-009 識別子の重複を拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-009"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-010 現在時刻が不正なら判定せず拒否する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-010"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-011 有効な例外を活性として返す
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-011"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-012 不可逆な配布を含む例外に無期限を認めない
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-012"のreview例外検査を実行する
    Then review例外検査は期待結果になる

  Scenario: SCN-UNIT-RVX-013 不可逆な配布を含む例外は期限付きなら受理する
    Given review例外検査の準備がある
    When "SCN-UNIT-RVX-013"のreview例外検査を実行する
    Then review例外検査は期待結果になる
