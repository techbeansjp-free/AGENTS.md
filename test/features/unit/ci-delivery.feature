@unit
Feature: CI runの配送状態を観測値から判定する

  Scenario: SCN-UNIT-CIDEL-001 該当runがあれば成否を問わずdeliveredにする
    Given 失敗した該当CI runだけがある観測がある
    When CI配送状態を判定する
    Then 配送状態は "delivered" で人間を呼ばないよう指示する

  Scenario: SCN-UNIT-CIDEL-002 猶予時間内の未生成はpendingにする
    Given 該当CI runが無く経過が猶予時間内の観測がある
    When CI配送状態を判定する
    Then 配送状態は "pending" で人間を呼ばないよう指示する

  Scenario: SCN-UNIT-CIDEL-003 猶予時間を超えた未生成はundeliveredにする
    Given 該当CI runが無く経過が猶予時間を超えた観測がある
    When CI配送状態を判定する
    Then 配送状態は "undelivered" で人間へ上げるよう指示する

  Scenario: SCN-UNIT-CIDEL-004 猶予時間ちょうどはpendingにする
    Given 該当CI runが無く経過が猶予時間ちょうどの観測がある
    When CI配送状態を判定する
    Then 配送状態は "pending" で人間を呼ばないよう指示する

  Scenario: SCN-UNIT-CIDEL-005 別PR・別head・別eventのrunを該当にしない
    Given 別PRと別headと別eventのCI runだけがある観測がある
    When CI配送状態を判定する
    Then 配送状態は "undelivered" で人間へ上げるよう指示する
    And 該当run件数は0件である

  Scenario: SCN-UNIT-CIDEL-006 22分の遅延実測をpendingへ分類する
    Given Issue969の実測どおり22分経過して該当CI runが無い観測がある
    When CI配送状態を判定する
    Then 配送状態は "pending" で人間を呼ばないよう指示する

  Scenario: SCN-UNIT-CIDEL-007 観測時刻がイベント時刻より前なら拒否する
    Given 観測時刻がイベント時刻より前の観測がある
    When CI配送状態を判定する
    Then CI配送判定はerrorになる
