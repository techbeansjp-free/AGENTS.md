@integration
Feature: 影響集合をreview焦点とreviewer文脈と検証選択で共有する

  Scenario: SCN-INT-IMPACT-001 commitのtreeから影響集合を導出しworktreeの未commit変更に左右されない
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    And 2 commit間の影響集合をGitから導出する
    Then 影響集合はtargetedで隣接範囲はsrc/app.tsとsrc/util.tsである
    And 影響featureはtest/features/app.featureとtest/features/traced.featureである

  Scenario: SCN-INT-IMPACT-002 impact CLIはfeature選択を出力しfullでは終了値1で全体検証を要求する
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    And impact CLIをfeatures形式で実行する
    Then impact CLIは終了値0で影響featureを1行1件で出力する
    When package.jsonを変更したcommitを作りimpact CLIをfeatures形式で実行する
    Then impact CLIは終了値1で全体検証を要求する

  Scenario: SCN-INT-IMPACT-003 review round 2の雛形は影響集合の隣接範囲を設定し改竄した隣接範囲を拒否する
    Given 影響集合を導出できるrepositoryでround 1のHigh findingを永続化したreview sessionがある
    When src/lib.tsを是正したcommitでround 2の雛形を作る
    Then 雛形のadjacentScopeは影響集合の隣接範囲でGraph Evidenceは影響集合digestである
    When 雛形のadjacentScopeへ任意のGraph Evidenceを持つpathを加えて記録する
    Then review roundは隣接範囲の不一致で拒否される

  Scenario: SCN-INT-IMPACT-004 隣接範囲へ入った前round blocker起因のHigh回帰はcurrent blockerになる
    Given 影響集合を導出できるrepositoryでround 1のHigh findingを永続化したreview sessionがある
    When src/lib.tsを是正したcommitでround 2の雛形を作る
    And 雛形へ隣接範囲の修正起因High findingを加えて記録する
    Then 隣接範囲の修正起因Highはcurrent blockerとして記録される

  Scenario: SCN-INT-IMPACT-005 reviewer文脈の関連fileはtargetedの影響集合の隣接範囲になる
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    And 補助reviewの差分文脈を収集する
    Then 補助reviewの関連fileは影響集合の隣接範囲と一致する

  Scenario: SCN-INT-IMPACT-006 staging rootは作業treeではなくhead commitのproject policyから読む
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When staging宣言の無いcommitでstaging配下の.gitignoreを変更し作業treeにだけstaging宣言を置く
    And 2 commit間の影響集合をGitから導出する
    Then 影響集合はfullで理由に"影響を導出できない種別のfile"を含む
    When staging宣言をcommitしたうえでstaging配下の.gitignoreを再び変更する
    And 2 commit間の影響集合をGitから導出する
    Then 影響集合はtargetedで理由を持たない

  Scenario: SCN-INT-IMPACT-007 反復解析の返却値を変えても次の判定を汚染しない
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    Then 反復Git観測は返却値の改変から隔離される

  Scenario: SCN-INT-IMPACT-008 同じHEADでも基点が変われば再導出しpolicy変更も反映する
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    Then 基点とHEADとpolicyの変更は以前の影響集合を再利用しない

  Scenario: SCN-INT-IMPACT-009 反復時もGit sourceの実在と観測上限を再検査する
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    Then Git sourceの欠落と観測上限は反復投影でも拒否する

  Scenario: SCN-INT-IMPACT-010 SHAだけでsourceの同一性を判断しない
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    Then Git replacementのsource変更を同じSHAの古い投影で隠さない

  Scenario Outline: SCN-INT-IMPACT-011 依存先を固定できない動的読込は初回も反復時もfullになる
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When 動的な依存読込"<式>"を"<所在>"へcommitして影響集合を2回導出する
    Then 初回も反復時も動的依存を名指ししてfull検証を要求する

    Examples:
      | 式                                             | 所在          |
      | import(name)                                   | src/lib.ts    |
      | require(name)                                  | src/lib.ts    |
      | (require)(name)                                | src/lib.ts    |
      | (require as typeof require)(name)              | src/lib.ts    |
      | (require!)(name)                               | src/lib.ts    |
      | (<typeof require>require)(name)                | src/lib.ts    |
      | (require satisfies typeof require)(name)       | src/lib.ts    |
      | import(name)                                   | src/util.ts   |
      | import(name)                                   | src/loader.ts |
      | import(flag ? './app.js' : name)                | src/loader.ts |

  Scenario Outline: SCN-INT-IMPACT-012 有限literal候補を全列挙できる動的依存は静的Graphへ保持する
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When 有限候補の依存読込"<式>"を"<所在>"へ配置して影響集合を導出する
    Then 有限候補の全依存を保持して初回も反復時もtargetedになる

    Examples:
      | 式                                                 | 所在          |
      | import(flag ? './util.js' : './app.js')              | src/lib.ts    |
      | require(flag ? './util.js' : './app.js')             | src/lib.ts    |
      | (require)(flag ? './util.js' : './app.js')           | src/lib.ts    |
      | import('./util.js')                                | src/lib.ts    |
      | (require as typeof require)('./util.js')            | src/lib.ts    |
      | import(flag ? './app.js' : './lib.js')               | src/loader.ts |
      | ((require: Function) => require(name))(() => null)   | src/loader.ts |
      | import(flag ? './isolated-a.js' : './isolated-b.js') | src/loader.ts |

  Scenario: SCN-INT-IMPACT-013 同じreview操作だけで正式なImpact観測を共有する
    Given importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある
    When src/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す
    Then reviewの同一操作はfocusとinspectionのImpactを一度だけ導出する
