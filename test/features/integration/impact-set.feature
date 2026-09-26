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
