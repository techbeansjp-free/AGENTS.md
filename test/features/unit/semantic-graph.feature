@unit @semantic-graph
Feature: 意味グラフを決定論的かつ有界に探索し投影の鮮度を証明する

  Scenario: SCN-UNIT-SEMGRAPH-001 挿入順とsource identityに依存しないcanonical content hashを生成する
    Given 同じ意味内容を異なる順序とsource identityで持つ2つの意味グラフがある
    When 意味グラフのcanonical content hashを計算する
    Then 2つのcontent hashは一致し元のsnapshotは変更されない

  Scenario: SCN-UNIT-SEMGRAPH-020 canonical化はlocaleに依存せずbinary順を使う
    Given locale順とbinary順が異なるproperty keyを持つ2つの意味グラフがある
    When 意味グラフのcanonical content hashを計算する
    Then property keyはbinary順になり2つのcontent hashは一致する

  Scenario: SCN-UNIT-SEMGRAPH-002 bounded BFSは入力順に依存せず確定edgeだけを辞書順で探索する
    Given 入力順が異なり推論edgeを含む同値な2つの意味グラフがある
    When 確定edgeだけを対象にoutgoing bounded BFSを実行する
    Then 2つのBFS結果は同一の辞書順になり推論edgeを含まない

  Scenario: SCN-UNIT-SEMGRAPH-003 bounded BFSは全hard budgetを超過せず部分結果を返す
    Given 4 nodeの線形な意味グラフがある
    When BFSの各hard budgetを個別に最小化して探索する
    Then 各BFSはbudget exceededになり観測値と部分結果が指定上限以内である

  Scenario: SCN-UNIT-SEMGRAPH-015 max depthで未探索edgeが残る場合は完全探索と報告しない
    Given 3 nodeの線形な意味グラフがある
    When max depth 1でoutgoing BFSを実行する
    Then BFSは2 nodeの有界部分結果を返しbudget exceededになる

  Scenario: SCN-UNIT-SEMGRAPH-016 複数start自体がresult上限を超える場合もhard boundを守る
    Given 独立した2つのstart nodeがある
    When result budget 1で複数startのBFSを実行する
    Then BFSは初期result上限を超えずbudget exceededになる

  Scenario: SCN-UNIT-SEMGRAPH-004 iterative Tarjanは入力順に依存しないcanonical SCCを返す
    Given 入力順が異なるcycleとself loopと孤立nodeの意味グラフがある
    When 2つの意味グラフでSCCを計算する
    Then SCCは同一かつcomponent内外とも辞書順である

  Scenario: SCN-UNIT-SEMGRAPH-018 iterative Tarjanはnodeとedgeとoperationとresultのbudgetを守る
    Given SCC budgetごとの反例となる意味グラフがある
    When 各hard budget付きでSCCを計算する
    Then 各SCC探索はbudget exceededとなり部分結果を上限内に保つ

  Scenario: SCN-UNIT-SEMGRAPH-005 Kahnは複数のready nodeを辞書順で決定論的に処理する
    Given 複数のready nodeと合流点を持つDAGがある
    When Kahnによるtopological orderを計算する
    Then topological orderは依存関係を守る辞書順で完了する

  Scenario: SCN-UNIT-SEMGRAPH-006 Kahnはself loopを正確なEvidenceとして報告しgate不適合と分離する
    Given self loopを持つ意味グラフがある
    When Kahnによるtopological orderを計算する
    Then cycle判定はself loopのSCCを欠落させずEvidence完了かつgate不適合になる

  Scenario: SCN-UNIT-SEMGRAPH-007 Kahnは初期indegree計算を含めoperation budgetを超過しない
    Given 1 edgeのDAGとoperation budget 1がある
    When operation budget付きKahnを実行する
    Then Kahnはbudget exceededになりoperation数が指定上限以内である

  Scenario: SCN-UNIT-SEMGRAPH-019 KahnはDAGでもedge budgetを超過しない
    Given 2 edgeのDAGとedge budget 1がある
    When edge budget付きKahnを実行する
    Then Kahnはedge budget exceededとなり完全順序を返さない

  Scenario: SCN-UNIT-SEMGRAPH-008 shortest pathは同距離の候補を決定論的に選び重み有無を区別する
    Given 入力順が異なる同距離経路を持つ無重みと重み付きの意味グラフがある
    When 各意味グラフでshortest pathを計算する
    Then 無重みはBFSで重み付きはDijkstraとなり辞書順の同一路を返す

  Scenario: SCN-UNIT-SEMGRAPH-009 shortest pathは全hard budgetを超過しない
    Given 3 nodeの最短経路を持つ意味グラフがある
    When shortest pathの各hard budgetを個別に最小化して探索する
    Then 各shortest pathはbudget exceededになり観測値が指定上限以内である

  Scenario: SCN-UNIT-SEMGRAPH-021 depth制約付きDijkstraはnodeとdepthの組を探索状態にする
    Given 深い安価経路と浅い高価経路が同じ中継nodeへ合流する重み付きグラフがある
    When max depth 2でDijkstra shortest pathを計算する
    Then 浅い状態を失わずdepth内の最短経路を完全に返す

  Scenario: SCN-UNIT-SEMGRAPH-022 Dijkstraは累積weightの非有限化と安全上限超過をfail closedにする
    Given 累積weightが非有限化または安全上限を超える重み付きグラフがある
    When overflowする各グラフでDijkstra shortest pathを計算する
    Then 各shortest pathはinvalidとなり有限distanceを捏造しない

  Scenario: SCN-UNIT-SEMGRAPH-010 malformed nodeとedgeを例外ではなくinvalid Evidenceにする
    Given 重複nodeと未解決endpointと負のweightを持つmalformed snapshotがある
    When malformed snapshotを検証してBFSへ渡す
    Then validatorとBFSは決定論的なinvalid理由を返す

  Scenario: SCN-UNIT-SEMGRAPH-023 provenance pathはcanonicalなrepository relative pathだけを許可する
    Given redundant segmentを含むnon-canonical provenance pathがある
    When non-canonical provenance pathを持つsnapshotを検証する
    Then provenance不正としてfail closedで拒否する

  Scenario: SCN-UNIT-SEMGRAPH-011 malformed source identityをfail closedで拒否する
    Given dirtyがbooleanでないmalformed source identityがある
    When malformed source identityを持つsnapshotを検証する
    Then source identity不正として拒否する

  Scenario: SCN-UNIT-SEMGRAPH-012 manifestと実投影hashが一致するときだけexact Evidenceを許可する
    Given sourceとextensionと実投影hashが完全一致するmanifestがある
    When graph freshnessを評価する
    Then graphはfreshでexact Evidenceが許可されrecoveryは不要である

  Scenario: SCN-UNIT-SEMGRAPH-017 実投影hashを未観測ならmanifest一致だけでexact Evidenceを許可しない
    Given sourceとextensionが一致し実投影hashを未観測のmanifestがある
    When graph freshnessを評価する
    Then graphはprojection unverifiedとしてexact Evidenceを許可せずrebuildを要求する

  Scenario: SCN-UNIT-SEMGRAPH-024 実投影countを未観測ならhash一致だけでexact Evidenceを許可しない
    Given sourceとextensionと実投影hashが一致しcountを未観測のmanifestがある
    When graph freshnessを評価する
    Then graphはprojection unverifiedとしてexact Evidenceを許可せずrebuildを要求する

  Scenario: SCN-UNIT-SEMGRAPH-025 calendar上存在しないbuiltAtをcorruptとして拒否する
    Given calendar上存在しないISO形式builtAtを持つmanifestがある
    When graph freshnessを評価する
    Then graphはcorruptとしてexact Evidenceを許可せずrebuildを要求する

  Scenario: SCN-UNIT-SEMGRAPH-013 複数drift理由を決定論的な順序で全件報告する
    Given incompleteとversionとworktreeとsourceとprojectionのdriftを持つmanifestがある
    When graph freshnessを評価する
    Then 全drift理由が安定順で返りrebuildが要求される

  Scenario Outline: SCN-UNIT-SEMGRAPH-014 missingまたはcorruptな投影をexact Evidenceに使わない
    Given graph storeのread結果が<状態>である
    When graph freshnessを評価する
    Then <理由>を理由にstaleとなりrebuildが要求される

    Examples:
      | 状態    | 理由    |
      | missing | missing |
      | corrupt | corrupt |
