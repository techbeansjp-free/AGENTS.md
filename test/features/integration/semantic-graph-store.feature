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

  Scenario: SCN-INT-SEMSTORE-011 repository内のsubdirectoryをruntime rootとして受理しない
    Given GraphQLite installにrepository内のsubdirectoryを指定した隔離projectがある
    When subdirectory rootからGraphQLite install previewを実行する
    Then canonical worktree root違反を副作用前に拒否する

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-012 readback後にsource driftしたcandidateを公開しない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When actual storeのreadback後observerで正本sourceを変更する
    Then source driftを型付きで拒否しpointer bytesとgeneration集合を維持する

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-013 privateなmalformed current pointerから正本を完全再構築できる
    Given 固定digestのGraphQLite native assetが明示注入されている
    When privateなcurrent pointerをmalformed JSONにして完全再構築する
    Then generation directoryの最大値から次世代を公開してreadbackできる

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-014 corrupt current databaseから正本を完全再構築できる
    Given 固定digestのGraphQLite native assetが明示注入されている
    When current databaseを破損させて正本から完全再構築する
    Then corrupt databaseを参照せず次世代を公開してreadbackできる

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-015 current pointer symlinkをrebuildでもfail closedにする
    Given 固定digestのGraphQLite native assetが明示注入されている
    When current pointerをsymlinkへ置換して完全再構築する
    Then unsafe current pointerを拒否しgeneration candidateを作らない

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-016 group writableなcurrent pointerをrebuildでもfail closedにする
    Given 固定digestのGraphQLite native assetが明示注入されている
    When current pointerをgroup writableにして完全再構築する
    Then unsafe permissionを拒否しgeneration candidateを作らない

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-017 pointer公開前後のfaultはcurrent generationの参照整合性を壊さない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When actual storeのgeneration公開直後・耐久化後とcurrent pointer公開直後・耐久化後にfaultを注入する
    Then 通常faultは公開前状態へ戻りhard crash残存世代をcurrentにせずpointer公開後も有効な参照を維持する

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-018 manifestのextension自己申告を固定catalogの代わりに信頼しない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When current pointerのextension versionを未知versionへ改変して読む
    Then extension mismatchを型付きdrift reasonとして返す

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-019 missing current pointerを未知I/Oと混同しない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When extensionだけinstallしたstoreからcurrent generationを読む
    Then missingを型付きdrift reasonとして返す

  @actual-graphqlite
  Scenario: SCN-INT-SEMSTORE-020 storeもrepository内subdirectoryをruntime rootとして受理しない
    Given 固定digestのGraphQLite native assetが明示注入されている
    When install後にsubdirectory rootからactual storeを構築する
    Then storeはcanonical worktree root違反を副作用前に拒否する
