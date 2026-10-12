@integration
Feature: 実装先行候補は隔離Gitと事前契約・実行済みテストに拘束される

  Scenario: SCN-INT-CANDIDATE-001 同じdummyの事前HEADから全差分を検分する
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    Then 対象テストの実行結果から独立review待ちになる
    When 後からbaseと許可範囲とテスト成功を申告する
    Then すべての自己申告を拒否する
    When dummyの認可処理へ想定外の変更をcommitする
    Then 事前HEADから認可差分を検出し上流へ戻す

  Scenario: SCN-INT-CANDIDATE-002 失敗テストと複数不足責務を保持する
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    Then 対象テストの失敗をCLIが観測する
    When dummyの認可処理へ想定外の変更をcommitする
    Then 失敗テストとセキュリティ不足を両方保持する

  Scenario: SCN-INT-CANDIDATE-003 dirtyな候補と別worktreeのsessionは拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    Then 別worktreeのsessionを使えない
    When 候補に未記録の変更を加える
    Then 事後検分はdirtyなGitを拒否する

  Scenario: SCN-INT-CANDIDATE-004 sessionの上書きとsymlinkを拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    Then 同じsessionを事前判定で上書きできない
    When sessionをsymlinkへ置き換える
    Then 事後検分はsessionのsymlinkを拒否する

  Scenario: SCN-INT-CANDIDATE-005 テストが候補を変更したら観測を破棄する
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    Then 対象テスト中のtracked変更を拒否する

  Scenario: SCN-INT-CANDIDATE-006 読み戻せない巨大sessionを作らない
    Given 候補用の隔離dummyと事前sessionを作る
    When 上限超過の事前Intentを与える
    Then sessionは生成されず拒否される

  Scenario: SCN-INT-CANDIDATE-007 sessionのbase改ざんでもGit分岐点を隠せない
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    And dummyの認可処理へ想定外の変更をcommitする
    And sessionのbaseと許可範囲を事後改ざんする
    Then Git分岐点の再計算でbase改ざんを拒否する

  Scenario: SCN-INT-CANDIDATE-008 許可範囲だけ改ざんしても認可差分を上流へ戻す
    Given 候補用の隔離dummyと事前sessionを作る
    When dummyの文言修正をcommitする
    And dummyの認可処理へ想定外の変更をcommitする
    And sessionの許可範囲だけを事後改ざんする
    Then 許可済みと偽装した認可差分も上流へ戻す

  Scenario: SCN-INT-CANDIDATE-009 単一Coordinator呼出しで隔離実装とGit観測を行う
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離Workerが低riskの文言だけを修正する
    Then Coordinatorが差分と対象テストを観測し独立reviewへ送る

  Scenario: SCN-INT-CANDIDATE-010 WorkerはCoordinatorの事前契約を書き換えられない
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離WorkerがCoordinatorのsessionへ書き込もうとする
    Then Coordinatorの事前契約を変更できずcandidateをcommitしない

  Scenario: SCN-INT-CANDIDATE-011 高risk要求はWorker起動前に上流へ戻る
    Given 候補用の隔離dummyと事前sessionを作る
    When 事前判定で認可riskを未解決にする
    Then Worker起動前に上流へ戻してGitを変更しない

  Scenario: SCN-INT-CANDIDATE-012 同じ書込dirの許可外差分はCoordinatorが拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離Workerが許可外の認可fileも変更する
    Then Coordinatorは許可外差分をcommitしない

  Scenario: SCN-INT-CANDIDATE-013 WorkerはGit metadataを書き換えられない
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離WorkerがGit metadataへ書き込もうとする
    Then Git metadataは変更されずcandidateをcommitしない

  Scenario: SCN-INT-CANDIDATE-014 ignored fileへの副作用も候補採用前に拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離Workerが無視対象のfileを作る
    Then ignored差分も拒否しcandidateをcommitしない

  Scenario: SCN-INT-CANDIDATE-015 書込pathのsymlink祖先を拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When Workerの書込pathの祖先を外部directoryへのsymlinkにする
    Then 外部directoryへ書込権限を付与しない

  Scenario: SCN-INT-CANDIDATE-016 Coordinatorのcommitはrepository hookを起動しない
    Given 候補用の隔離dummyと事前sessionを作る
    When 悪意あるcommit hookを設定して隔離Workerが文言を修正する
    Then Coordinatorはhookを実行せず候補だけをcommitする

  Scenario: SCN-INT-CANDIDATE-017 不正な対象テストはWorker起動前に拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When 不正な対象テストで隔離Workerを起動しようとする
    Then Workerは差分を作らずHEADも変わらない

  Scenario: SCN-INT-CANDIDATE-018 Workerが作った壊れたsymlinkはcommitしない
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離Workerが許可fileを壊れたsymlinkにする
    Then CoordinatorはsymlinkをindexとHEADへ採用しない

  Scenario: SCN-INT-CANDIDATE-019 Git clean filterがCoordinator権限で起動しない
    Given 候補用の隔離dummyと事前sessionを作る
    When 悪意あるGit clean filterを設定して隔離Workerを起動しようとする
    Then Coordinatorはfilterを実行せず候補を変更しない

  Scenario: SCN-INT-CANDIDATE-020 commit内の属性fileを作業treeで隠してもfilterを起動しない
    Given 候補用の隔離dummyと事前sessionを作る
    When commit内のfilter属性をassume-unchangedで隠して候補実行する
    Then Coordinatorは隠された属性を拒否しfilterを起動しない

  Scenario: SCN-INT-CANDIDATE-021 複数fileの後半がsize上限を超えたら元候補を変更しない
    Given 候補用の隔離dummyと事前sessionを作る
    When Workerが先頭の許可fileと巨大な後続fileを変更する
    Then Coordinatorは全payloadを検査して元候補をcleanに保つ

  Scenario: SCN-INT-CANDIDATE-022 Workerが書込directoryを閉じても一時worktreeを残さない
    Given 候補用の隔離dummyと事前sessionを作る
    When Workerが一時worktreeの書込directoryを読み取り専用にして失敗する
    Then Coordinatorは一時worktree登録を片付け元候補をcleanに保つ

  Scenario: SCN-INT-CANDIDATE-023 assume-unchangedで隠した元fileを候補取込で上書きしない
    Given 候補用の隔離dummyと事前sessionを作る
    When 元候補の許可fileをassume-unchangedで隠してWorkerを起動する
    Then Coordinatorは隠された元fileを保持しWorkerを起動しない

  Scenario: SCN-INT-CANDIDATE-024 skip-worktree付きfileを候補取込に使わない
    Given 候補用の隔離dummyと事前sessionを作る
    When 元候補の許可fileにskip-worktreeを設定してWorkerを起動する
    Then Coordinatorは隠蔽index flagを拒否する

  Scenario: SCN-INT-CANDIDATE-025 WorkerのTMPDIRを読取専用にされても残さない
    Given 候補用の隔離dummyと事前sessionを作る
    When WorkerがTMPDIR内のdirectoryを読取専用にして失敗する
    Then CoordinatorはWorker runtimeを削除し失敗を保持する

  Scenario: SCN-INT-CANDIDATE-026 runtime cleanup失敗でもWorker終了値を失わない
    Given cleanup診断用の観測を準備する
    When runtime cleanup失敗とWorker終了値の観測を合成する
    Then 診断にWorker終了値とcleanup失敗が両方残る

  Scenario: SCN-INT-CANDIDATE-027 複数fileの合計size上限は候補取込前に拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When Workerが各fileは上限内だが合計が上限超過の差分を作る
    Then Coordinatorは合計sizeを拒否し元候補をcleanに保つ

  Scenario: SCN-INT-CANDIDATE-028 commit object生成の失敗は元候補を変更しない
    Given 候補用の隔離dummyと事前sessionを作る
    When Coordinatorのcommit-tree失敗を注入する
    Then Coordinatorは元候補のHEAD・index・fileを保持する

  Scenario: SCN-INT-CANDIDATE-029 出力worktree生成の失敗は元候補を変更しない
    Given 候補用の隔離dummyと事前sessionを作る
    When Coordinatorの出力worktree生成失敗を注入する
    Then Coordinatorは元候補のHEAD・index・fileを保持する

  Scenario: SCN-INT-CANDIDATE-030 出力生成中の元HEAD競合は公開を拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When Coordinatorの出力生成中に元HEADを移動する
    Then Coordinatorは元HEAD変更を保持し出力を拒否する

  Scenario: SCN-INT-CANDIDATE-031 出力生成中の元file編集を上書きしない
    Given 候補用の隔離dummyと事前sessionを作る
    When Coordinatorの出力生成中に元fileを編集する
    Then Coordinatorは元file変更を保持し出力を拒否する

  Scenario: SCN-INT-CANDIDATE-032 対象テスト失敗後の候補は新規executeに再利用しない
    Given 候補用の隔離dummyと事前sessionを作る
    When 対象テストが失敗する候補実装を実行する
    Then 失敗したcommitを同じ候補worktreeの新規executeへ流用しない

  Scenario: SCN-INT-CANDIDATE-033 元候補を変更せず別worktreeへcommitを公開する
    Given 候補用の隔離dummyと事前sessionを作る
    When 隔離Workerが低riskの文言だけを修正する
    Then Coordinatorは元候補を維持し別worktreeへcommitを公開する

  Scenario: SCN-INT-CANDIDATE-034 元worktreeの絶対test pathを候補HEADの成功証拠にしない
    Given 候補用の隔離dummyと事前sessionを作る
    When 元worktreeだけなら成功する絶対test pathを候補で実行する
    Then Coordinatorは元worktreeの成功を候補成功へ昇格しない

  Scenario: SCN-INT-CANDIDATE-035 配布CLIも元候補を上書きせず新規worktreeを返す
    Given 候補用の隔離dummyと事前sessionを作る
    When 配布CLIで隔離Workerの文言修正を実行する
    Then Coordinatorは元候補を維持し別worktreeへcommitを公開する

  Scenario: SCN-INT-CANDIDATE-036 元worktreeの絶対実行test pathも候補成功証拠にしない
    Given 候補用の隔離dummyと事前sessionを作る
    When 元worktreeでだけ成功する実行testを絶対pathで指定する
    Then Coordinatorは別worktreeの実行testを拒否する

  Scenario: SCN-INT-CANDIDATE-037 実行fileの親directory経由で元worktreeを読ませない
    Given 候補用の隔離dummyと事前sessionを作る
    When 元worktreeの親に実行fileを複製して元のtestを指定する
    Then Coordinatorは元worktreeの成功を候補成功へ昇格しない

  Scenario: SCN-INT-CANDIDATE-038 結果用worktreeの登録・変更・孤立を副作用なしで観測する
    Given 候補用の隔離dummyと事前sessionを作る
    When 結果用worktreeのclean・変更済み・登録のみ・未登録directory・同名fileを作る
    Then Candidate inventoryは5状態を区別しGit状態を変更しない

  Scenario: SCN-INT-CANDIDATE-039 inventoryはGit clean filterを実行せず不明として停止する
    Given 候補用の隔離dummyと事前sessionを作る
    When clean filterを設定した結果worktreeをinventoryする
    Then Candidate inventoryはfilterを起動せず不明として停止する

  Scenario: SCN-INT-CANDIDATE-040 inventoryは隠蔽indexをcleanと誤認しない
    Given 候補用の隔離dummyと事前sessionを作る
    When 隠蔽indexを設定した結果worktreeをinventoryする
    Then Candidate inventoryは隠蔽indexを不明として停止する

  Scenario: SCN-INT-CANDIDATE-041 inventoryは壊れたsymlinkを登録欠落と誤認しない
    Given 候補用の隔離dummyと事前sessionを作る
    When 結果worktreeを壊れたsymlinkに置換してinventoryする
    Then Candidate inventoryはsymlinkを不明として停止する


  Scenario: SCN-INT-CANDIDATE-042 低リスク候補の採用はStep 9に履歴を明示し独立reviewを要求する
    Given 候補用の隔離dummyと事前sessionを作る
    When 結果用worktreeにquick stagingを作りCandidateを正式採用する
    Then Candidate採用記録はGitと要求に束縛されStep 10 reviewが残る

  Scenario: SCN-INT-CANDIDATE-043 採用後の要求改ざんはjournal読取で拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When 結果用worktreeのCandidateを採用後に要求成果物を改変する
    Then Candidate採用記録の要求digest不一致を検出する

  Scenario: SCN-INT-CANDIDATE-044 認可fileを変更したCandidateは正式採用を拒否する
    Given 候補用の隔離dummyと事前sessionを作る
    When 認可変更を含む結果用worktreeのCandidate採用を試す
    Then Candidate採用は拒否されStep 9記録を残さない


  Scenario: SCN-INT-CANDIDATE-045 直前commitで認可変更を隠した候補は採用できない
    Given 候補用の隔離dummyと事前sessionを作る
    When 認可変更を前のcommitに隠したCandidate採用を試す
    Then Candidate採用は拒否されStep 9記録を残さない
