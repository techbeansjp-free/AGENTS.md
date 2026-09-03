@unit
Feature: 外部command実行の境界で失敗原因を保存する

  Scenario: SCN-UNIT-PROC-001 既定の1MiBを超える出力でも全量を返す
    Given 1MiBを超える出力を返すcommandがある
    When process境界でその出力を取得する
    Then 出力は切り詰められず全量が返る

  Scenario: SCN-UNIT-PROC-002 出力上限の超過を終了値へ丸めず原因を返す
    Given 1MiBを超える出力を返すcommandがある
    When 出力上限を絞ってprocess境界で実行する
    Then 失敗理由にENOBUFSが残る

  Scenario: SCN-UNIT-PROC-003 allowFailureでも失敗原因をstderrへ残す
    Given 実在しないcommandがある
    When allowFailureでprocess境界で実行する
    Then 終了値は1でstderrに実行できなかった原因が残る

  Scenario: SCN-UNIT-PROC-004 明示したenvだけを実processへ渡す
    Given process境界へ渡す明示envがある
    When 明示envでprocess境界を実行する
    Then 実processは明示envの値を受け取る

  Scenario: SCN-UNIT-PROC-005 session出力上限の超過を終了値へ丸めず原因を残す
    Given 1MiBを超える出力を返すsessionがある
    When session境界で上限を超える出力を受け取る
    Then session失敗理由に出力上限の超過が残る

  Scenario: SCN-UNIT-PROC-006 session timeoutを終了値へ丸めず原因を残す
    Given 応答しないsessionがある
    When session境界でtimeoutまで待つ
    Then session失敗理由にtimeoutが残る

  Scenario: SCN-UNIT-PROC-007 session起動失敗を終了値へ丸めず原因を残す
    Given 実在しないcommandがある
    When session境界で実在しないcommandを起動する
    Then session失敗理由に起動できなかった原因が残る
