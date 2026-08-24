@integration
Feature: 隔離ディレクトリでpackage lifecycleの所有権境界を検証する

  Scenario: SCN-INT-LIFECYCLE-001 隔離ディレクトリでsetup・update・deleteを順に実行する
    Given lifecycle検証用の隔離directoryがある
    When 隔離先でsetupとupdateとdeleteを順に適用する
    Then package管理資産だけが追加更新削除される

  Scenario: SCN-INT-LIFECYCLE-002 agent-skill-chain以外のskill・文書・設定をdelete後も保持する
    Given lifecycle隔離先に他skillと利用者文書と他ツール設定がある
    When lifecycle隔離先で導入後にdeleteを適用する
    Then 他skillと利用者文書と他ツール設定は同一内容で残る

  Scenario: SCN-INT-LIFECYCLE-003 consumer所有のdocs・project policy・staging・dirty資産を保持する
    Given dirtyな隔離Git repositoryにconsumer所有資産がある
    When dirty状態のままsetupとupdateとdeleteを適用する
    Then consumer所有資産とdirty状態は保持される

  Scenario: SCN-INT-LIFECYCLE-004 改ざんrecordとhash不一致では削除しない
    Given 導入済み隔離先と改ざんrecordの反例がある
    When hash不一致と不正recordでdeleteを試みる
    Then hash不一致資産を保持し不正recordは削除前に拒否する

  Scenario: SCN-INT-LIFECYCLE-005 path traversalとsymlink脱出を削除前に拒否する
    Given 導入済み隔離先と境界外の一時資産がある
    When traversal recordとsymlink脱出でdeleteを試みる
    Then 境界内外の資産を削除せず拒否する

  Scenario: SCN-INT-LIFECYCLE-006 TOCTOUでは削除せず停止する
    Given delete preview済みの隔離先がある
    When preview後に削除対象の内容を変更してapplyする
    Then 変更された削除対象はretainedとして残る

  Scenario: SCN-INT-LIFECYCLE-007 部分失敗を未処理対象と復旧方法つきで報告する
    Given 削除の一部だけが失敗する導入済み隔離先がある
    When 部分失敗を起こすdeleteを適用する
    Then 削除済みと未処理と復旧方法を報告してrecordを保持する

  Scenario: SCN-INT-LIFECYCLE-008 再実行と旧versionからの移行が安全である
    Given 旧version recordとconsumer資産を持つ隔離先がある
    When updateを2回適用してdeleteも再実行する
    Then consumer資産を保持して2回目のdeleteは安全に停止する

  Scenario: SCN-INT-LIFECYCLE-009 Unicode pathと読み取り専用資産を安全に扱う
    Given Unicode pathと読み取り専用資産が共存する隔離先がある
    When setupとupdateとdeleteを適用する
    Then Unicode pathと読み取り専用資産は同一内容で残る
