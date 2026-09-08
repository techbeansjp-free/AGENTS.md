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

  Scenario: SCN-UNIT-CIDEL-008 merge後の固定run照合は各fieldの不一致と他PRの混入を拒否する
    Given 固定merge identityと固定run観測の組がある
    When merge後の固定run照合を評価する
    Then 全field一致だけが成立し各不一致と他PR混入は名指しで拒否される

  Scenario: SCN-UNIT-CIDEL-009 merge前の選別は空の関連PRを拒否し続ける
    Given 関連PRが空のrunと対象PRのrunがある
    When CI配送状態を判定する
    Then 空の関連PRは該当0件になり対象PRのrunだけが該当する

  Scenario: SCN-UNIT-CIDEL-010 run未生成とrun有りの未関連付けを別の診断で報告する
    Given 該当CI runが無く経過が猶予時間を超えた観測がある
    When CI配送状態を判定する
    Then 診断は "CI runが未生成です" を含む
    And head SHA一致run件数は0件である
    Given 別PRと別headと別eventのCI runだけがある観測がある
    When CI配送状態を判定する
    Then 診断は "対象PRへ関連付いていません" を含む
    And head SHA一致run件数は2件である
    And 配送状態は "undelivered" で人間へ上げるよう指示する
