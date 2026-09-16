@integration
Feature: parallel progress evidenceのadapter境界

  Scenario: SCN-INT-PROGRESS-001 固定H_implへ実adapterで進捗を追記する
    Given parallel progressの実adapter fixtureがある
    When review入力を変えずcompleted進捗を実際にappendする
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-002 digest chainで改変を検出する
    Given parallel progressの純粋fixtureがある
    When "digest-chain" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-003 review bindingを固定する
    Given parallel progressの純粋fixtureがある
    When "binding" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-009 target path traversalを拒否する
    Given parallel progressの純粋fixtureがある
    When "traversal" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-010 Unicode制御taskを拒否する
    Given parallel progressの純粋fixtureがある
    When "unicode" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-011 stale digest競合を検出する
    Given parallel progressの純粋fixtureがある
    When "stale" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-012 途中JSONを拒否する
    Given parallel progressの純粋fixtureがある
    When "partial" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-013 seal後追記を拒否する
    Given parallel progressの純粋fixtureがある
    When "sealed" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-014 journal上限を拒否する
    Given parallel progressの純粋fixtureがある
    When "limit" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-021 並行critical pathは直列時間を超えない
    Given parallel progressの純粋fixtureがある
    When "critical-path" のparallel progress反例を評価する
    Then parallel progress契約を満たす

  Scenario: SCN-INT-PROGRESS-026 mode不一致でもreview roundを開く
    Given mode 0664の03を持つreview前stagingがある
    When review round --initを実行する
    Then roundが開きanchorにprogress inventoryが無い

  Scenario: SCN-INT-PROGRESS-027 構築可否がroundと予算とdigestを変えない
    Given mode 0664の03を持つreview前stagingがある
    When review round --initを実行する
    Then round recordの差はprogress inventory keyの有無だけである

  Scenario: SCN-INT-PROGRESS-028 分類外の失敗は従来どおり伝播する
    Given progress inventoryの構築が分類外の失敗をするstagingがある
    When review round --initを実行する
    Then review round --initは従来どおり拒否する

  Scenario: SCN-INT-PROGRESS-029 inventory不成立sessionでは直列経路を案内する
    Given progress inventoryが不成立のreview sessionがある
    When review round --initを実行する
    Then review progressは従来の直列経路を案内して拒否する

  Scenario: SCN-INT-PROGRESS-030 成立時のfileModeは実測modeと一致し変化を拒否する
    Given mode 0644の03を持つreview前stagingがある
    When review round --initを実行する
    Then inventoryのfileModeが実測modeと一致しinit後のmode変化を拒否する

  Scenario: SCN-INT-PROGRESS-031 umask 0002でも生成03は0644になる
    Given umask 0002のissue create環境がある
    When full stagingを生成する
    Then 生成された03のmodeは0644である

  Scenario: SCN-INT-PROGRESS-032 umask 0077でも生成03は0644になる
    Given umask 0077のissue create環境がある
    When full stagingを生成する
    Then 生成された03のmodeは0644である

  Scenario: SCN-INT-PROGRESS-033 template mode 0664を生成物へ継がない
    Given on-disk modeが0664のissue templateがある
    When full stagingを生成する
    Then 生成された03のmodeは0644である

  Scenario: SCN-INT-PROGRESS-035 全分類で案内をnotesへ返す
    Given 分類の異なる不成立03を持つreview前stagingが揃っている
    When それぞれでreview round --initを実行する
    Then どの分類でも案内がnotesへ出る

  Scenario: SCN-INT-PROGRESS-036 読めないstagingは非停止化後も拒否する
    Given 親directoryが読めない03を持つstagingがある
    When lstatが不在以外の理由で失敗する
    Then 不在と区別して拒否する

  Scenario: SCN-INT-PROGRESS-037 通常fileでない03を分類して案内する
    Given 03が通常fileでないstagingがある
    When review round --initを実行する
    Then not-regular-fileとして案内する

  Scenario: SCN-INT-PROGRESS-038 片側markerを無言で落とさない
    Given markerが片側だけの03を持つstagingがある
    When review round --initを実行する
    Then marker不正として案内する

  Scenario: SCN-INT-PROGRESS-039 full昇格で生成する03も0644になる
    Given full昇格で03を生成するquick stagingがある
    When full昇格を適用する
    Then 昇格で生成された03のmodeは0644である

