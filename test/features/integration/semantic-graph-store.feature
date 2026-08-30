@integration @semantic-graph-store
Feature: 固定GraphQLite assetと派生投影を隔離環境で検証する
  公式assetのidentityとGraph storeの原子的な境界を、実repositoryや既存runtimeへ依存せず観測する。
  native互換性scenarioは明示注入された固定digest assetだけを一時directoryへinstallして実行する。

  Scenario: SCN-INT-SEMSTORE-001 install previewは固定assetを示しtransportもruntimeも変更しない
    Given GraphQLite install preview用の隔離projectがある
    When transportを失敗させる設定でinstall previewを実行する
    Then 固定versionとdigestの計画だけを返しtransportもruntimeも使用しない

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-002 注入transportから検証済みassetだけを原子的にinstallする
    Given 固定digestのGraphQLite native assetが明示注入されている
    When 注入transportからGraphQLite install applyを実行する
    Then 固定URLを1回だけ取得し検証済み通常fileだけを公開する

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-003 actual storeは完全再構築してreadbackとpath queryを一致させる
    Given 固定digestのGraphQLite native assetが明示注入されている
    When repository graphをactual storeへ完全再構築してpath queryする
    Then actual databaseのreadbackとqueryは正本snapshotに一致する

  Scenario: SCN-INT-SEMSTORE-004 digest不一致assetを公開せずfail closedにする
    Given digest不一致のGraphQLite transportを持つ隔離projectがある
    When digest不一致assetでGraphQLite install applyを実行する
    Then digest不一致を理由にextensionもpending fileも公開しない

  Scenario: SCN-INT-SEMSTORE-005 extension symlinkをdatabase open前に拒否する
    Given GraphQLite extension配置先がsymlinkである隔離projectがある
    When symlink配置済みprojectでGraphQLite installを検証する
    Then symlinkを理由にextensionを信頼しない

  Scenario: SCN-INT-SEMSTORE-006 unsafe permissionのextensionを所有権境界で拒否する
    Given GraphQLite extension配置先がgroup writableである隔離projectがある
    When unsafe permission配置済みprojectでGraphQLite installを検証する
    Then private runtime permission違反としてextensionを信頼しない

  Scenario: SCN-INT-SEMSTORE-010 owner不一致のextensionを現在userのassetとして信頼しない
    Given GraphQLite extensionのownerが現在userと異なる検証seamがある
    When owner不一致としてGraphQLite installを検証する
    Then 現在userの所有でないextensionを拒否する

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-007 corrupt generationをcurrent pointerの正当な投影として読まない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When complete generationを破損させてactual storeから読む
    Then corrupt generationを拒否しcurrent pointerと正本を変更しない

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-008 stale generationのstatusは暗黙再構築しない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When complete generationの後で正本sourceを変更してstatusを読む
    Then stale statusはexact Evidenceを拒否しruntimeを変更しない

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-009 Cypher断片を含むIDとpropertyをbound parameterとして往復する
    Given 固定digestのGraphQLite native assetが明示注入されている
    When injection文字列を含むsnapshotをactual storeでreplaceしてreadする
    Then injection文字列はdataのまま保持されGraph構造を変更しない
