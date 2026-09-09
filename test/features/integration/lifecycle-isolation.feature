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

  Scenario: SCN-INT-LIFECYCLE-019 record不在の拒否理由は最小診断だけを返す
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When record不在の隔離先へinstallとdeleteを試みる
    Then 拒否理由は最小診断だけを返す

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

  Scenario: SCN-INT-LIFECYCLE-022 dangling symlinkのrecordを不在と誤認せず保持する
    Given 導入後にrecordを境界外を指すdangling symlinkへ置き換えた隔離先がある
    When record不在の隔離先へupdateを試みる
    Then updateは書き込まず拒否しrecordのsymlinkは保持される

  Scenario: SCN-INT-LIFECYCLE-023 壊れたrecordを空recordへ降格させない
    Given 導入後にrecordをJSONとして壊した隔離先がある
    When record不在の隔離先へupdateを試みる
    Then updateは書き込まず拒否しrecordの内容は変わらない

  Scenario: SCN-INT-LIFECYCLE-024 preview後に内容が変わった資産を上書きせず保持する
    Given 導入後にrecordを失い正本一致資産だけを持つ隔離先がある
    When apply中に展開先の内容を変えてupdateを適用する
    Then 変更された展開先はretainedとして残りrecordへ登録されない

  Scenario: SCN-INT-LIFECYCLE-025 copy直後に変わった展開先の実測digestをrecordへ登録する
    Given 導入後にrecordと展開済み資産1件を失った隔離先がある
    When copy直後に配置先へ追記してupdateを適用する
    Then recordの登録digestは追記後の展開先の実測値と一致する

  Scenario: SCN-INT-LIFECYCLE-026 成功しない手段を復旧手段として案内しない
    Given 導入後にrecordを失い展開済み資産が境界外symlinkの隔離先がある
    When deleteを試みてから同じ状態でupdateも試みる
    Then deleteの拒否理由はupdateを手段として案内せず解消すべき原因を名指しする

  Scenario: SCN-INT-LIFECYCLE-027 未導入directoryのupdateをinstallと同じ書き込みへ倒さない
    Given ASCを一度も導入していない隔離directoryがある
    When record不在の隔離先へupdateを試みる
    Then updateは1 fileも書かず明示指定を要求して拒否し名指しされたinstallは成功する

  Scenario: SCN-INT-LIFECYCLE-028 record不正の各分類を空recordへ降格させない
    Given 導入後にrecordを不正な各分類へ壊した隔離先の一覧がある
    When 各不正recordの隔離先へupdateを試みる
    Then いずれも書き込まず拒否しrecordと管理資産は不変である

  Scenario: SCN-INT-LIFECYCLE-029 明示指定なしでは利用者所有の同名fileへ書き込まない
    Given 未導入directoryに利用者所有のAGENTS.mdだけがある隔離先がある
    When record不在の隔離先へupdateを試みる
    Then updateは1 fileも書かず明示指定を要求して拒否し利用者のfileは不変である

  Scenario: SCN-INT-LIFECYCLE-030 正本とbyte一致する同名fileがあっても明示指定を要求する
    Given 未導入directoryに正本とbyte一致するAGENTS.mdだけがある隔離先がある
    When record不在の隔離先へupdateを試みる
    Then updateは1 fileも書かず明示指定を要求して拒否する

  Scenario: SCN-INT-LIFECYCLE-031 公開直前に現れたsymlinkのrecord公開先を置換しない
    Given 導入後にrecordと展開済み資産1件を失った隔離先がある
    When 資産のcopy直後にrecord公開先へsymlinkを挿入してupdateを試みる
    Then updateは公開を中止しrecord公開先のsymlinkは保持される

  Scenario: SCN-INT-LIFECYCLE-032 導入済みでもrecord復旧には明示指定を要求する
    Given 導入後にmanaged asset recordだけを失った隔離先がある
    When 明示指定なしでrecord不在の隔離先へupdateを試みる
    Then 明示指定の要求だけを返しrecordを再生成しない

  Scenario: SCN-INT-LIFECYCLE-033 record既存の再固定でも公開直前に現れたsymlinkを置換しない
    Given 導入済みで展開済み資産1件を失った隔離先がある
    When 資産のcopy直後に既存recordをsymlinkへ差し替えてupdateを試みる
    Then updateは公開を中止し既存recordのsymlinkは保持される

  Scenario: SCN-INT-LIFECYCLE-034 配布CLIでも明示指定なしのrecord復旧を拒否する
    Given 導入後にmanaged asset recordだけを失った隔離先がある
    When 配布CLIで明示指定なしのupdateとapplyを順に試みる
    Then CLIは非0で終了し明示指定を名指しし1 fileも書かない

  Scenario: SCN-INT-LIFECYCLE-035 installの公開直前に現れたsymlinkのrecord公開先を置換しない
    Given lifecycle検証用の隔離directoryがある
    When installの資産copy直後にrecord公開先へsymlinkを挿入して適用する
    Then installは公開を中止しrecord公開先のsymlinkは保持される

  Scenario: SCN-INT-LIFECYCLE-036 配布CLIで明示指定つきのrecord復旧が成功する
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When 配布CLIで明示指定つきのupdateを適用する
    Then CLIは0で終了しrecordを再固定し相違資産をretainedとして報告する

  Scenario: SCN-INT-LIFECYCLE-037 復旧中に現れたrecordで利用者資産を上書きしない
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When 分類の前に有効なrecordが現れる状況でupdateを適用する
    Then 相違資産は上書きされずrecordの観測は1回に保たれる

  Scenario: SCN-INT-LIFECYCLE-038 配布CLIで明示指定つきのpreviewが到達できる
    Given 導入後にrecordを失い展開済み資産が正本と異なる隔離先がある
    When 配布CLIで明示指定つきのdry-runと既定previewを試みる
    Then いずれも0で終了し書き込まずretainedを報告する

  Scenario: SCN-INT-LIFECYCLE-039 未導入directoryのdeleteも最小診断だけを返す
    Given ASCを一度も導入していない隔離directoryがある
    When 未導入の隔離先へdeleteを試みる
    Then 拒否理由は最小診断だけを返しinstallを名指ししない

  Scenario: SCN-INT-LIFECYCLE-040 資産1件の未導入directoryでも診断は同じ形である
    Given 未導入directoryに利用者所有のAGENTS.mdだけがある隔離先がある
    When 未導入の隔離先へdeleteを試みる
    Then 拒否理由は最小診断だけを返しinstallを名指ししない

  Scenario: SCN-INT-LIFECYCLE-041 明示指定なしのupdateの拒否もpreviewで裏付ける
    Given 導入後にrecordを失い展開済み資産が境界外symlinkの隔離先がある
    When 明示指定なしでrecord不在の隔離先へupdateを試みる
    Then 拒否理由は明示指定を成功する手段として案内せず原因を名指しする
