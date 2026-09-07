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

  Scenario: SCN-UNIT-SCNSCOPE-006 role-logとmetricsを除外する
    Given role-logとmetricsにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告しない

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

  Scenario: SCN-UNIT-SCNSCOPE-010 一時ライフサイクル領域4件のSCN定義を違反にしない
    Given 一時ライフサイクル領域4件すべてにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を報告しない

  Scenario: SCN-UNIT-SCNSCOPE-011 4領域の近似pathと所定locationを取り違えない
    Given 4領域それぞれの近似pathと所定locationと領域外にSCN定義がある
    When SCN配置検査を実行する
    Then 検査は固定の期待集合どおりに配置違反を報告する

  Scenario: SCN-UNIT-SCNSCOPE-012 新しい判定経路が生のpath入力の契約を満たす
    Given 新しい除外判定へ渡す生のpath一覧がある
    When 新しい除外判定を1件ずつ適用する
    Then 区切りを正規化し親参照と現在参照と空segmentを含むpathは除外しない

  Scenario: SCN-UNIT-SCNSCOPE-013 要件本文が陳腐化した除外理由を持たない
    Given 仕様・品質管理要件の正本がある
    When REQ-SQ-017の除外範囲の記述を表示本文で検査する
    Then 陳腐化した記述が存在せず新しい除外範囲と理由が存在する

  Scenario: SCN-UNIT-SCNSCOPE-014 一時領域の追跡混入拒否が維持される
    Given 区切り文字を名前に含む合法な一時領域pathがある
    When 追跡混入検査が使う領域判定を適用する
    Then すべて領域内と判定される

  Scenario: SCN-UNIT-SCNSCOPE-015 区切り文字をfile名に含む領域外の定義を除外しない
    Given 領域名の直後に区切り文字を含む領域外pathにSCN定義がある
    When SCN配置検査を実行する
    Then 検査はSCN配置違反を4件報告する
