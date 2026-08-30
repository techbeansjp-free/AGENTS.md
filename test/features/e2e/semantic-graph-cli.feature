@e2e @semantic-graph-cli-e2e
Feature: build済みCLIからsemantic graphを実processで操作する
  build成果物のcommand routing、process終了code、previewとapplyの副作用差、
  freshness gate、決定論的探索結果を外部networkなしで機械検証する。
  GraphQLite native extensionの取得・ABI・SQLite loadだけはfixture seamの対象外とし、
  固定assetを使う一回限りのactual verificationへ分離する。

  Background:
    Given build済みGraph CLIの隔離copyと自己完結DAG fixtureがある

  Scenario: SCN-E2E-SEMGRAPH-001 installのpreviewは無変更でapplyだけがruntimeを作る
    Given fixture Graph runtimeは未作成である
    When graph installを実processでpreviewする
    Then install previewは成功しruntimeを変更しない
    When fixture seamのgraph installを実processでapplyする
    Then install applyだけが固定extension markerを作る

  Scenario: SCN-E2E-SEMGRAPH-002 rebuild、status、impact、path、orderをbuild済みCLIで完走する
    Given fixture extensionを実processでinstall済みである
    When graph rebuildを実processでpreviewする
    Then rebuild previewは投影を書き込まない
    When graph rebuildを実processでapplyする
    Then rebuild applyはfreshな投影を公開する
    When graph statusを実processで実行する
    Then statusはfreshかつexact Evidence可能である
    When graph impact、path、orderを実processで実行する
    Then BFS影響範囲、最短path、topological orderはexact Evidenceになる

  Scenario: SCN-E2E-SEMGRAPH-003 missing投影は暗黙生成せずrebuildを要求する
    Given fixture Graph runtimeは未作成である
    When missing状態でgraph statusを実processで実行する
    Then statusはmissingを非0で返しruntimeを作らない
    When extension未installのままgraph rebuildを実processでapplyする
    Then rebuildもmissingを型付きで返し権限を付与しない

  Scenario: SCN-E2E-SEMGRAPH-004 corrupt投影はexact Evidenceにならない
    Given fixture graph投影を実processで構築済みである
    When current pointerを破損してgraph statusを実processで実行する
    Then statusはcorruptを非0で返しexact Evidenceを拒否する

  Scenario: SCN-E2E-SEMGRAPH-005 source更新後のstale投影は再利用されない
    Given fixture graph投影を実processで構築済みである
    When tracked sourceを変更してgraph statusを実processで実行する
    Then statusはstaleを非0で返しrebuildを要求する

  Scenario: SCN-E2E-SEMGRAPH-006 Node 22.13境界を副作用前に実processで判定する
    Given fixture Graph runtimeは未作成である
    When Node 22.12.0 process seamでgraph install previewを実行する
    And Node 22.13.0 process seamでgraph install previewを実行する
    Then 22.12は拒否され22.13は許可されてruntimeは作られない

  Scenario: SCN-E2E-SEMGRAPH-007 不正な探索入力をexact Evidenceにしない
    Given fixture graph投影を実processで構築済みである
    When 未知nodeと未知edge kindでgraph探索を実process実行する
    Then impact、path、orderはすべて非0でexact Evidenceにならない

  Scenario: SCN-E2E-SEMGRAPH-008 固定catalogと異なるextension manifestをtyped driftにする
    Given fixture graph投影を実processで構築済みである
    When 保存manifestのextension identityを改竄してgraph statusを実process実行する
    Then statusはextension-mismatchだけを安定したreasonで返す

  Scenario: SCN-E2E-SEMGRAPH-009 inferred指定は候補Evidenceに限定し不正形式を読取前拒否する
    Given fixture graph投影を実processで構築済みである
    When include-inferred付きimpactを実processで実行する
    Then completeでもcandidateでありexact Evidenceとmerge authorityを持たない
    When current pointer破損後に値付きinclude-inferredを実processで実行する
    Then 値付きflagはGraph読取前に入力違反として拒否される
