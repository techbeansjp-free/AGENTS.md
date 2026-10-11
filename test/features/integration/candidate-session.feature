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
