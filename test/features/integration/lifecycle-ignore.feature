@integration @lifecycle-ignore
Feature: 一時ライフサイクル領域の3箇所整合
  分類正本、無視設定、配布物検査の除外一覧が分岐していないことを検証する。

  Scenario: SCN-INT-LIFEIGNORE-001 製品repositoryで全領域が領域全体として無視される
    Given 製品repositoryがある
    When 一時ライフサイクル領域の整合を検査する
    Then 整合検査は合格する

  Scenario: SCN-INT-LIFEIGNORE-002 全領域を無視した隔離repositoryは合格する
    Given 全領域を無視した隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は合格する

  Scenario: SCN-INT-LIFEIGNORE-003 1領域が無視対象から欠けていると失敗する
    Given role-logだけを無視対象から外した隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は無視対象でない領域を示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-004 領域配下のfileが追跡されていると失敗する
    Given metrics配下のfileを追跡した隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は追跡中のpathを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-009 領域内の1つのpathだけを無視すると失敗する
    Given role-log配下の1つのpathだけを無視した隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は無視patternが領域全体を指していないことを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-010 否定patternで領域内を再許可すると失敗する
    Given role-log配下を否定patternで再許可した隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は失敗する

  Scenario: SCN-INT-LIFEIGNORE-011 無視設定をrepository外のexclude fileへ置くと失敗する
    Given 無視設定をrepository外のexclude fileへ置いた隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査は一致元がgitignoreでないことを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-012 gitignoreが追跡されていないと失敗する
    Given gitignoreを追跡していない隔離repository
    When 隔離repositoryの一時ライフサイクル領域の整合を検査する
    Then 整合検査はgitignoreが追跡されていないことを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-014 別repositoryを指す環境変数があっても指定rootを検査する
    Given role-logだけを無視対象から外した隔離repositoryと、全領域を無視した別repositoryがある
    When 別repositoryを指す環境変数を設定して整合を検査する
    Then 整合検査は無視対象でない領域を示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-015 代替indexを指す環境変数があっても指定rootの追跡状態で判定する
    Given metrics配下のfileを追跡した隔離repositoryと、空の代替indexがある
    When 代替indexを指す環境変数を設定して整合を検査する
    Then 整合検査は追跡中のpathを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-016 追跡fileの列挙が失敗すると拒否する
    Given 全領域を無視した隔離repository
    When 追跡fileの列挙だけが失敗する状態で整合を検査する
    Then 整合検査は追跡fileを列挙できないことを示して失敗する

  Scenario: SCN-INT-LIFEIGNORE-017 設定注入で無視設定を足しても無視漏れとして扱う
    Given role-logだけを無視対象から外した隔離repository
    When 設定注入で外部の無視設定を足して整合を検査する
    Then 整合検査は無視対象でないことを理由に失敗する
