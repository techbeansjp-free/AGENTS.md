@unit @lifecycle-record-recovery
Feature: managed asset recordが無い状態の1資産分類
  recordの記録の有無と展開先の状態から、配置・上書き・採用・保持のどれになるかを1つの純関数で決める。

  Scenario: SCN-UNIT-LIFECYCLE-001 record不在を全件未管理として分類し上書きへ倒さない
    Given 1資産の分類が取り得る入力の全件表がある
    When 分類の純関数へ全件表の各行を渡す
    Then 各行は表が定める分類を返し記録の無い相違資産は保持になる
