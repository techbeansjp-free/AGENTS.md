@integration
Feature: workflow mark・workflow metricsのCLI統合

  Scenario: SCN-MT-1482-006 workflow metricsがstep_msとrole_ms内訳を統合して返す
    Given journal付きの隔離issue stagingを用意する
    And role=implementer・role=reviewer・model=codexの計測イベントをworkflow markで記録する
    When workflow metricsを実行する
    Then step_msとrole_msとmodel_msとartifact_build_msとsupport_msが算出される

  Scenario: SCN-MT-1482-007 metricsディレクトリが既存資産だという誤情報が計画文書群以外に無い
    Given repository rootを対象にする
    When repository全体でmetrics既存資産の誤情報をgrepする
    Then memo配下以外に一致は無い

  Scenario: SCN-MT-1482-010 制御文字を含むlabelを持つworkflow markを拒否する
    Given journal付きの隔離issue stagingを用意する
    When 制御文字を含むlabelでworkflow markを試みる
    Then workflow markは拒否される

  Scenario: SCN-MT-1482-016 step_msはStep番号が重複するjournalでも全entryを保持する
    Given journal/steps.jsonlにStep9が2回記録されたstagingを用意する
    When workflow metricsのstep_msを取得する
    Then step_msはStep9の両entryを縮約せず保持する

  Scenario: SCN-MT-1482-017 workflow markの前後でstaging digestが変化しない
    Given 隔離issue stagingを用意しstaging digestを記録する
    When workflow markを1回実行する
    Then staging digestはworkflow markの前後で変化しない

  Scenario: SCN-MT-1482-019 CLI経由でもINV-03の二重startを拒否する
    Given journal付きの隔離issue stagingでrole=implementerがopen状態である
    When 同じkind=roleでstartのworkflow markを試みる
    Then CLI経由でもINV-03により拒否される

  Scenario: SCN-MT-1482-020 relative pathの--review-sessionからreview_roundsを算出する
    Given journal付きの隔離issue stagingとrelative pathのreview session fileを用意する
    When relative pathの--review-sessionでworkflow metricsを実行する
    Then review_roundsがrelative pathからも算出される

  Scenario: SCN-MT-1482-021 計測event logが無い場合は個別fieldがunavailableになる
    Given journal付きの隔離issue stagingを計測event logなしで用意する
    When 計測event logが無い状態でworkflow metricsを実行する
    Then role_msとmodel_msとdeterministic_msとartifact_build_msとsupport_msはunavailableである

  Scenario: SCN-MT-1482-022 --outで.agent-skill-chain/metrics/配下へreportを書き込む
    Given journal付きの隔離issue stagingがある
    When --out付きでworkflow metricsを実行する
    Then .agent-skill-chain/metrics/配下へreportが書き込まれる

  Scenario: SCN-MT-1482-023 計測event logの不正行はfail-closedでrole_msをunavailableにする
    Given 計測event logに不正な行を1件書き込んだstagingを用意する
    When その状態でworkflow metricsを実行する
    Then role_msはfail-closedでunavailableになり不正行のwarningが含まれる
