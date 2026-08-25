@integration @auto-release
Feature: 自動release workflowと配布digest CLI
  実workflowとnpm pack fixtureを使って配布物による判定境界を検証する。

  Scenario: SCN-INT-AUTORELEASE-001 実workflowが自動triggerと再帰防止と冪等条件と経路別gateを満たす
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then 自動release workflow検証は有効になる

  Scenario: SCN-INT-AUTORELEASE-002 自動npm公開を含むworkflowを拒否する
    Given 無条件main pushと自動npm公開を含むworkflow本文がある
    When 自動release workflow契約を検証する
    Then 自動release workflow検証はdigest stepとnpm条件を根拠に拒否する

  Scenario: SCN-INT-AUTORELEASE-003 bump経路が必要なgateをすべて含む
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then bump経路はaudit:check以外のrelease gateをすべて含む

  Scenario: SCN-INT-DIGEST-001 fixture repositoryで配布file一覧からdigestを算出する
    Given distと配布fileを持つfixture packageがある
    When fixture packageの配布digest CLIを実行する
    Then 配布file一覧から64桁のdigestを算出する

  Scenario: SCN-INT-DIGEST-002 distが無いとき明確な日本語errorで停止する
    Given distが無いfixture packageがある
    When fixture packageの配布digest CLIを実行する
    Then distが必要な日本語errorで非0終了する

  Scenario: SCN-INT-DIGEST-003 cwd optionで別directoryを対象にできる
    Given distと配布fileを持つfixture packageがある
    When repository rootからcwd optionで配布digest CLIを実行する
    Then 指定したfixtureの配布file一覧からdigestを算出する

  Scenario: SCN-INT-DIGEST-004 READMEだけの変更で配布digestが変わる
    Given READMEを配布するfixture packageがある
    When READMEだけを変更して前後の配布digestを算出する
    Then README変更後の配布digestは異なる

  Scenario: SCN-INT-DIGEST-005 docs specsだけの変更では配布digestが変わらない
    Given docs specsを配布しないfixture packageがある
    When docs specsだけを変更して前後の配布digestを算出する
    Then docs specs変更後の配布digestは同じになる

  Scenario: SCN-INT-DIGEST-006 package files追加へpaths変更なしで追随する
    Given 追加可能な配布fileを持つfixture packageがある
    When package filesへ配布対象を追加して前後の配布digestを算出する
    Then 追加fileが配布entryへ増えてdigestは異なる
