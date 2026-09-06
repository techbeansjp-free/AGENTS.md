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

  Scenario: SCN-INT-AUTORELEASE-003 実workflowが既定branchへ書き込まない
    Given 自動release用の実workflow本文を読み込む
    When 自動release workflow契約を検証する
    Then 実workflowは既定branchへ書き込まない

  Scenario: SCN-INT-AUTORELEASE-004 乖離した既存bump branchをB基準で作り直す
    Given Bより古い基準のbump branchを持つ隔離repositoryと、bump branchを持たない同条件の隔離repositoryを用意する
    When 双方でbump準備手順を実行する
    Then HのtreeはBのtreeと正規bump差分の合成に一致し、二つのgate対象treeのtree hashも一致する

  Scenario: SCN-INT-AUTORELEASE-005 既にB基準で正規なbump branchを作り直さない
    Given B基準で正規なbump branchを持つ隔離repositoryを用意する
    When bump準備手順を実行する
    Then remote headは実行前後で変化せず、そのbump commitのsubjectはchore(release): bump version toで始まり、変更pathはpackage.jsonとpackage-lock.jsonだけになる

  Scenario: SCN-INT-AUTORELEASE-006 正規bump差分を超える混入を拒否し最後の1回のpush以外でremoteへ書き込まない
    Given package-lock.jsonのintegrityを変えた混入、package.jsonに__proto__ keyを持つ基準、versionのlifecycleがremoteへ書き込む基準の3つの隔離repositoryを用意する
    When 3つでbump準備手順を実行する
    Then 混入は作り直しで除かれるか非0で停止し、__proto__を持つ基準は非0で停止し、lifecycleが書いた内容はremoteのbump branchに残らない

  Scenario: SCN-INT-AUTORELEASE-007 基準SHAを確定できない場合と競合を検出した場合にgateを実行せず停止する
    Given 基準SHAを取得できない隔離repositoryと、観測後に別主体がbump branchを作成する隔離repositoryを用意する
    When 双方でbump準備手順を実行する
    Then いずれもgateを実行せず非0で終了し、成立しなかった条件を出力へ残す

  Scenario: SCN-INT-AUTORELEASE-008 mainのversionが目標versionと一致する場合は書き込まない
    Given mainのversionが目標versionと一致する隔離repositoryを用意する
    When bump準備手順を実行する
    Then bump branchとPRのremote状態は変化しない

  Scenario: SCN-INT-AUTORELEASE-011 release.ymlにnpm公開jobとversion注入経路が存在しない
    Given release.ymlをYAMLのjob構造として読み込む
    When npm公開経路の不在を判定する
    Then npm公開jobもpublish_npm入力もnpm publish stepも存在しない

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

  Scenario: SCN-INT-AUTORELEASE-012 version注入はpackage.jsonとpackage-lock.jsonの3 version fieldだけを変える
    Given sentinel versionを持つ隔離package treeがある
    When release tagのversionを注入する
    Then 変更はpackage.jsonとpackage-lock.jsonの3 version fieldだけである

  Scenario: SCN-INT-AUTORELEASE-013 version以外を変える注入を拒否する
    Given sentinel versionを持つ隔離package treeがある
    When version以外も変える注入を実行する
    Then 注入は正規bump差分でないことを理由に拒否される
