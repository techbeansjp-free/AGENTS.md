@integration
Feature: 隔離疑似projectでsemantic graphを即時観測する
  経過日数ではなく再現可能な疑似projectとscenarioをEvidenceにするため、
  repository projectorと決定論的graph algorithmを隔離repositoryで実行する。

  Scenario: SCN-INT-SEMGRAPH-001 Full modeを独立した契約として即時観測する
    Given Full modeの隔離疑似projectがある
    When mode別semantic graphを構築する
    Then Full modeのscenarioから実装fileへのdirect traceが得られる

  Scenario: SCN-INT-SEMGRAPH-002 Quick modeを独立した契約として即時観測する
    Given Quick modeの隔離疑似projectがある
    When mode別semantic graphを構築する
    Then Quick modeのscenarioから実装fileへのdirect traceが得られる

  Scenario: SCN-INT-SEMGRAPH-003 PoC modeを独立した契約として即時観測する
    Given PoC modeの隔離疑似projectがある
    When mode別semantic graphを構築する
    Then PoC modeのscenarioから実装fileへのdirect traceが得られる

  Scenario: SCN-INT-SEMGRAPH-004 同一sourceの投影は時刻に依存せず決定的である
    Given 決定性観測用の隔離疑似projectがある
    When 同一sourceからsemantic graphを2回構築する
    Then 2つのsnapshotとcontent hashは完全に一致する

  Scenario: SCN-INT-SEMGRAPH-005 dirty変更とrenameとdeleteをsource driftへ反映する
    Given source mutation観測用の隔離疑似projectがある
    When tracked sourceを変更してrenameしtracked featureをdeleteする
    Then 各mutationのcontent digestとfile状態が直ちに変化する

  Scenario: SCN-INT-SEMGRAPH-006 2 worktreeの投影を混同しない
    Given 同一commitをcheckoutした2つの隔離worktreeがある
    When 両worktreeでsemantic graphを構築する
    Then source内容は一致するがworktree identityは分離される

  Scenario: SCN-INT-SEMGRAPH-007 DAGの同順位候補と最短経路を辞書順で確定する
    Given 同順位の2経路を持つDAG疑似projectがある
    When import graphをtopological sortして最短経路を探索する
    Then DAG順序と同距離pathは入力順に依存せず辞書順で確定する

  Scenario: SCN-INT-SEMGRAPH-008 self-loopと複数node cycleをSCCとして報告する
    Given self-loopと2 node cycleを持つ疑似projectがある
    When import graphのSCCとtopological sortを実行する
    Then self-loopと2 node cycleをそれぞれcycle Evidenceとして返す

  Scenario: SCN-INT-SEMGRAPH-009 疑似project探索でもhard budgetを超過しない
    Given 多数の投影edgeを持つbudget観測用疑似projectがある
    When result上限2でrepositoryからbounded BFSを実行する
    Then budget exceededを返し結果数と観測値はhard limit以内である

  Scenario: SCN-INT-SEMGRAPH-010 missing投影をexact Evidenceにしない
    Given GraphQLite固定assetと現在source identityがある
    When graph projectionがmissingとしてfreshnessを評価する
    Then missingを理由にexact Evidenceを拒否してrebuildを要求する

  Scenario: SCN-INT-SEMGRAPH-011 corrupt投影をexact Evidenceにしない
    Given GraphQLite固定assetと現在source identityがある
    When graph projectionがcorruptとしてfreshnessを評価する
    Then corruptを理由にexact Evidenceを拒否してrebuildを要求する

  Scenario: SCN-INT-SEMGRAPH-012 stale投影をexact Evidenceにしない
    Given GraphQLite固定assetと現在source identityがある
    When 過去sourceのmanifestを現在sourceに対して評価する
    Then source aheadを理由にexact Evidenceを拒否してrebuildを要求する

  Scenario: SCN-INT-SEMGRAPH-013 extension導入previewはnetworkもworkspaceも変更しない
    Given Graph CLI観測用の隔離疑似projectがある
    When graph installをdry-runで実行する
    Then 固定asset計画だけを返しGraph runtimeを作らない

  Scenario: SCN-INT-SEMGRAPH-014 完全再構築previewはsourceを読み書込み計画だけを返す
    Given Graph CLI観測用の隔離疑似projectがある
    When graph rebuildをdry-runで実行する
    Then source identityと件数とhashを返しGraph runtimeを作らない

  Scenario: SCN-INT-SEMGRAPH-015 missing投影のstatusは暗黙復旧しない
    Given Graph CLI観測用の隔離疑似projectがある
    When missing Graphでgraph statusを実行する
    Then 非0と明示的rebuild案内を返しGraph runtimeを作らない

  Scenario: SCN-INT-SEMGRAPH-016 複数要件のtrace rowを暗黙直積にしない
    Given 複数要件と受け入れ条件を持つtrace rowがある
    When trace rowをsemantic graphへ投影する
    Then IDが一致する要件と受け入れ条件だけを結び曖昧なscenario辺を作らない

  Scenario: SCN-INT-SEMGRAPH-017 ECMAScript依存をcompiler AST境界内で投影する
    Given relative importと複数行宣言とbinding shadowと字句decoyを持つ疑似projectがある
    When source variantをsemantic graphへ投影する
    Then 各relative importとexportは決定論的edgeになり構文と資源境界を越えない

  Scenario: SCN-INT-SEMGRAPH-018 credential付きremoteをsource identityへ保存しない
    Given credential付きoriginを持つ隔離疑似projectがある
    When repository identityをsemantic graphへ投影する
    Then credentialとremote URLはhash化されたidentityから復元できない

  Scenario: SCN-INT-SEMGRAPH-019 Node 20で非graph CLIを維持する
    Given Graph CLI観測用の隔離疑似projectがある
    When Node 20 runtime seamでworkflow stepsを実行する
    Then 非graph CLIは成功しGraph runtimeをloadしない

  Scenario: SCN-INT-SEMGRAPH-020 Node 22.13未満のgraph CLIを副作用前に拒否する
    Given Graph CLI観測用の隔離疑似projectがある
    When Node 22.12 runtime seamでgraph installを実行する
    Then Node下限の理由を返しGraph runtimeを作らない

  Scenario: SCN-INT-SEMGRAPH-021 schema語彙とprojectorの実投影能力を混同しない
    Given Full modeの隔離疑似projectがある
    When mode別semantic graphを構築する
    Then 固定projector capabilityはsnapshotで実際に生成可能なkindだけを宣言する

  Scenario: SCN-INT-SEMGRAPH-022 要求から実装とfeatureへのtraceをbounded traversalで立証する
    Given Full modeの隔離疑似projectがある
    When Full要件からtrace edge限定のbounded traversalを実行する
    Then Requirement AC Scenario feature implementationへ上限内で到達する

  Scenario: SCN-INT-SEMGRAPH-023 trace endpoint不足を黙って捨てない
    Given 存在しない実装pathを含むtrace rowがある
    When endpoint不足のsemantic graphを構築する
    Then stableなtrace endpoint診断でfail closedになる

  Scenario: SCN-INT-SEMGRAPH-024 Graph Evidenceとignored stagingはmode authorityにならない
    Given ignored stagingにFull modeを持つQuick疑似projectがある
    When mode別semantic graphを構築する
    Then Graph Evidenceのauthorityはnoneでmergeとmodeの許可を持たない
    And ignored stagingのmodeはsnapshotへ投影されない

  Scenario: SCN-INT-SEMGRAPH-025 Quickは存在しないFull成果物を捏造しない
    Given Quick modeの隔離疑似projectがある
    When mode別semantic graphを構築する
    Then Quick traceは成立しFull専用成果物nodeは存在しない

  Scenario: SCN-INT-SEMGRAPH-026 freshなPoC Graphでもmergeを許可しない
    Given fresh Graphを持つPoC疑似projectがある
    When automatic merge条件とGraph Evidenceを既存delivery gateへ合成する
    Then PoCはGraph freshnessに関係なくstop-at-prになる

  Scenario: SCN-INT-SEMGRAPH-027 PoC昇格は補完正本から完全再構築する
    Given PoCでFull昇格が必要な実装中発見がある
    When Full成果物を補完してrepository graphを完全再構築する
    Then 旧PoC投影はstaleであり新Full投影として再利用されない

  Scenario: SCN-INT-SEMGRAPH-028 trackedでも削除済みのtrace endpointを実在扱いしない
    Given trackedなFeatureとImplementationをworking treeから削除したtrace rowがある
    When endpoint不足のsemantic graphを構築する
    Then 削除済みtrace endpointのstableな診断でfail closedになる

  Scenario: SCN-INT-SEMGRAPH-029 trackedな.astroのtrace endpointを実在扱いする
    Given trackedな.astroを実装列へ持つtrace rowがある
    When trace endpoint観測用のsemantic graphを構築する
    Then .astroのtrace endpointは実在と判定され投影が成立する

  Scenario: SCN-INT-SEMGRAPH-030 意味source集合に無い拡張子のtrace endpointは実在扱いしない
    Given trackedな.astro.bakを実装列へ持つtrace rowがある
    When trace endpoint観測用のsemantic graphを構築する
    Then .astro.bakのtrace endpointはstableな診断でfail closedになる

  Scenario: SCN-INT-SEMGRAPH-031 path以外のinline codeをtrace endpoint候補にしない
    Given path以外のinline codeをFeature列・実装列へ持つtrace rowがある
    When trace endpoint観測用のsemantic graphを構築する
    Then path以外のinline codeは実在検査の対象にならず投影が成立する

  Scenario: SCN-INT-SEMGRAPH-032 実在しないpathは判別規則の両側で引き続き拒否する
    Given 実在しないpathをFeature列・実装列へ持つtrace rowがある
    When trace endpoint観測用のsemantic graphを構築する
    Then 実在しないpathは既存の診断文言でfail closedになる
