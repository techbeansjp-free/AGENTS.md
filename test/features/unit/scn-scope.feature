@unit
Feature: SCN配置検査の走査範囲を規範側だけに限る

  Scenario: SCN-UNIT-SCNSCOPE-001 除外領域内のSCN定義を違反にしない
    Given Issue一時ステージング内にSCN定義を含むMarkdownがある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告しない

  Scenario: SCN-UNIT-SCNSCOPE-002 除外領域外のSCN定義は違反にする
    Given 除外領域外にSCN定義を含むMarkdownがある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告する

  Scenario: SCN-UNIT-SCNSCOPE-003 所定locationのfeatureは違反にしない
    Given test配下のfeatureにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告しない

  Scenario: SCN-UNIT-SCNSCOPE-004 正規化と親参照拒否を判定関数へ直接入力して確かめる
    Given 除外判定へ渡す生のpath一覧がある
    When 除外判定を1件ずつ適用する
    Then 区切りを正規化し親参照と現在参照を含むpathは除外しない

  Scenario: SCN-UNIT-SCNSCOPE-005 境界区切りまで一致しないpathを除外しない
    Given 除外領域に前方一致するだけの近似pathにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告する

  Scenario: SCN-UNIT-SCNSCOPE-006 role-logとmetricsは除外しない
    Given role-logとmetricsにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を2件報告する

  Scenario: SCN-UNIT-SCNSCOPE-007 git追跡状態を判定条件にしない
    Given git管理下にないrepositoryの除外領域外にSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告する

  Scenario: SCN-UNIT-SCNSCOPE-008 除外領域内のsymlinkで領域外を隠せない
    Given 除外領域内から領域外のSCN定義へsymlinkを張る
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告する

  Scenario: SCN-UNIT-SCNSCOPE-009 walkerはsymlinkを列挙しない
    Given 除外領域外にSCN定義fileとそのsymlinkがある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を1件だけ報告する
