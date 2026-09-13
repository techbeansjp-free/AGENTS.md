@integration
Feature: 旧PR終端のdelivery decisionを耐久状態として保持する

  Scenario: SCN-INT-DELIVERY-REOPEN-001 旧終端と新decisionを同時に再読取できる
    Given delivery state単体検査の準備がある
    When "SCN-INT-DELIVERY-REOPEN-001"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる

  Scenario: SCN-INT-DELIVERY-REOPEN-002 再開後もmerge dispatch claimを一度だけ消費する
    Given delivery state単体検査の準備がある
    When "SCN-INT-DELIVERY-REOPEN-002"のdelivery state単体検査を実行する
    Then delivery state単体検査は期待結果になる
