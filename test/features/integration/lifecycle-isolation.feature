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

  Scenario: SCN-INT-LIFECYCLE-010 installはhook正本と2つのhost展開先を配置する
    Given lifecycle検証用の隔離directoryがある
    When setupを適用する
    Then hook正本と2つのhost展開先が同じ内容で存在する

  Scenario: SCN-INT-LIFECYCLE-011 展開したhookは実行できる
    Given lifecycle検証用の隔離directoryがある
    When setupを適用する
    Then 展開したhookに実行bitが立っている

  Scenario: SCN-INT-LIFECYCLE-012 updateは消えたhook展開先を正本から復元する
    Given lifecycle検証用の隔離directoryがある
    When setupを適用してからhook展開先を消してupdateを適用する
    Then 展開先のhookは正本と同じ内容へ戻る

  Scenario: SCN-INT-LIFECYCLE-013 deleteは利用者が変更したhookを残す
    Given lifecycle検証用の隔離directoryがある
    When setupを適用してからhook展開先を書き換えてdeleteを適用する
    Then 書き換えたhookは残る

  Scenario: SCN-INT-LIFECYCLE-014 installは利用者とhostの設定fileへ書き込まない
    Given hook登録済みのhost設定を持つ隔離directoryがある
    When setupを適用する
    Then host設定fileは1 byteも変わらない

  Scenario: SCN-INT-LIFECYCLE-015 hookの登録の有無はdoctorのhealthyを変えない
    Given lifecycle検証用の隔離directoryがある
    When setupを適用してhook未登録と登録済みの両方でdoctorを実行する
    Then 2つのhealthyは等しく登録状態だけが違う

  Scenario: SCN-INT-LIFECYCLE-016 hook設定の解決に失敗してもdoctorは他の診断を返す
    Given lifecycle検証用の隔離directoryがある
    When setupを適用してからhost設定pathを境界外のsymlinkへ差し替えてdoctorを実行する
    Then doctorは中断せず未登録として報告する

  Scenario: SCN-INT-LIFECYCLE-017 record喪失後のupdateが正本一致資産を採用してrecordを再固定する
    Given 導入後にmanaged asset recordだけを失った隔離先がある
    When record不在の隔離先へupdateを適用する
    Then 正本一致資産はadoptedとして採用され実測digestのrecordが再生成される

  Scenario: SCN-INT-LIFECYCLE-018 record喪失後のupdateが正本と異なる資産を上書きせず保持する
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When record不在の隔離先へupdateを適用する
    Then 相違資産はretainedとして報告され内容は1 byteも変わらない

  Scenario: SCN-INT-LIFECYCLE-019 record不在の拒否理由が同じ状態で成功する手段を名指しする
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When record不在の隔離先へinstallとdeleteを試みる
    Then 拒否理由はupdateを名指しし名指しされたupdateは成功する

  Scenario: SCN-INT-LIFECYCLE-020 record喪失後の復旧でhost設定fileが変わらない
    Given 導入後にrecordを失いhook登録済みhost設定を持つ隔離先がある
    When record不在の隔離先へupdateを適用する
    Then host設定fileは1 byteも変わらない

  Scenario: SCN-INT-LIFECYCLE-021 record不在でも非通常fileと境界外symlinkの展開先へ書き込まない
    Given 導入後にrecordを失い展開先がdirectoryの隔離先がある
    When record不在の隔離先へupdateを適用する
    Then directoryの展開先はretainedとして残る
    When 展開先を境界外symlinkへ差し替えてupdateを試みる
    Then updateは境界外移動を拒否し境界外のfileへ書き込まない
