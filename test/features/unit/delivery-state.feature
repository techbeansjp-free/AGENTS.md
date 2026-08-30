@unit
Feature: PR作成からStep 11までのdelivery identityを永続状態で固定する

  Scenario: SCN-UNIT-DELSTATE-001 正規遷移を決定的に記録する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-001"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-002 未知fieldをrootと入れ子の両方で拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-002"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-003 PR bindingのIssueとHEADの差し替えを拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-003"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-004 順序を飛ばす状態遷移を拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-004"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-005 merge後read-backのPRとIssueとHEADを再照合する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-005"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-006 観測内容を改ざんするとdigest不一致で拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-006"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-007 createとmergeの不確実状態を照合後に再開する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-007"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-008 mergedのread-back前はStep 11を記録しない
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-008"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-009 不正な時刻とOIDとURLとrepositoryを拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-009"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-010 PR作成停止をStep 11終端として決定的に記録する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-010"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-011 Step 11のoutcomeと遷移元状態の不整合を拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-011"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-012 PR作成停止Evidenceのidentity改変を拒否する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-012"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-013 PR create dispatch claimを一度だけ消費する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-013"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-UNIT-DELSTATE-014 merge dispatch claimを一度だけ消費する
    Given delivery state単体検査の準備がある
    When "SCN-UNIT-DELSTATE-014"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる
