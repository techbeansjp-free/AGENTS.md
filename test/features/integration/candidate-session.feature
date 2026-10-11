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
