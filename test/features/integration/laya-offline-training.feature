@integration
Feature: ASC公開履歴のLaya artifact

  Scenario: SCN-INT-LAYA-001 固定した公開snapshotを同じ内容へ再生成する
    Given 隔離した公開ASC fixture repositoryがある
    When Laya snapshotを2回抽出する
    Then 2つのLaya dataset digestが一致する

  Scenario: SCN-INT-LAYA-008 学習入力の外部revisionを全て固定する
    Given 有効な固定済みLaya training manifestがある
    When training manifestを検証する
    Then Laya操作は成功する

  Scenario: SCN-INT-LAYA-009 評価に全必須metricを記録する
    Given noncriticalで正しいLaya予測がある
    When Laya評価を計算する
    Then Laya reportに必須metricがある

  Scenario: SCN-INT-LAYA-012 生成artifactを不変かつ追跡可能にする
    Given 空のLaya artifact directoryがある
    When 同じLaya artifact pathへ2回公開する
    Then 2回目のLaya公開は拒否される

  Scenario: SCN-INT-LAYA-015 後続の作業tree変更で固定snapshotを変えない
    Given 隔離した公開ASC fixture repositoryがある
    When Laya snapshot抽出後に未commitのreview変更を加える
    Then 固定Laya dataset digestは変わらない

  Scenario: SCN-INT-LAYA-019 sourceだけ成功した古い配布物を検出する
    Given sourceだけ更新されdistとschemaが古い配布fixtureがある
    When 配布物専用判定を行う
    Then 配布物のdriftとして検出される

  Scenario: SCN-INT-LAYA-022 低confidenceのLaya判断を採用しない
    Given loopbackのLaya Decision Providerがある
    When 低confidenceの判断を要求する
    Then Decision Providerはdegradedへ退避する

  Scenario: SCN-INT-LAYA-024 識別可能情報を含むprivate dataを拒否する
    Given 識別可能情報を含むprivate source candidateがある
    When private candidateの匿名化を検証する
    Then private candidateは学習前に拒否される

  Scenario: SCN-INT-LAYA-026 owner未承認のauthorization fileを拒否する
    Given Git管理外のprivate authorization fileがある
    When 異なるowner承認digestでauthorizationを読む
    Then private candidateは学習前に拒否される

  Scenario: SCN-INT-LAYA-028 candidate内で追加したauthorization pinを信頼しない
    Given trusted refには空のauthorization pinがある
    When candidateだけでauthorization pinを追加する
    Then candidate追加pinは信頼されない
