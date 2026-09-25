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
