@e2e
Feature: ASC Laya学習境界

  Scenario: SCN-E2E-LAYA-004 秘密を含むteacher packetを拒否する
    Given secret canaryを含むLaya caseがある
    When teacher viewを作る
    Then Laya操作は拒否される

  Scenario: SCN-E2E-LAYA-007 private repositoryを抽出前に拒否する
    Given 隔離したprivate Laya fixture repositoryがある
    When Laya snapshotを抽出する
    Then Laya操作は拒否される

  Scenario: SCN-E2E-LAYA-011 optional trainer失敗時にcheckpointを作らない
    Given 有効な固定済みLaya training manifestがある
    When 隔離Laya runnerが失敗を返す
    Then Laya checkpointは受理されない

  Scenario: SCN-E2E-LAYA-014 未使用Laya moduleがreview authorityを変えない
    Given Laya runtime統合が有効ではない
    When 既存review authorityを確認する
    Then Layaはformal approvalを付与しない

  Scenario: SCN-E2E-LAYA-017 holdout labelへの学習目的accessを拒否する
    Given seal済みのLaya splitがある
    When 学習用teacher assessmentをholdoutへ指定する
    Then Laya操作は拒否される

  Scenario: SCN-E2E-LAYA-018 private training manifestをspawn前に拒否する
    Given private sourceのLaya training manifestがある
    When Laya runner preflightを実行する
    Then Laya processは起動されない

  Scenario: SCN-E2E-LAYA-020 改竄されたDecision Bundleをmodel利用前に拒否する
    Given digestと互換版を固定したDecision Bundleがある
    When 異なるweight digestでDecision Bundleを検証する
    Then Decision Bundleはmodel利用前に拒否される

  Scenario: SCN-E2E-LAYA-023 owner許可済みprivate履歴を共通学習用に匿名化する
    Given owner許可済みprivate sourceのdecision candidateがある
    When private candidateを共通学習形式へ匿名化する
    Then repository名とraw pathは匿名化済みである

  Scenario: SCN-E2E-LAYA-027 private corpusをGit repository内へ書かない
    Given 隔離したprivate Laya fixture repositoryがある
    When repository内をprivate corpus storeに指定する
    Then private candidateは学習前に拒否される
