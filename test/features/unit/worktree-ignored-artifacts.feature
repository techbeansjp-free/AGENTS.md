@unit @worktree-ignored-artifacts
Feature: 無視対象資産の観測が実行環境のgit設定に依存しない

  Scenario: SCN-UNIT-WTIGN-001 非ASCII名の無視対象で種別不明にならない
    Given "非ASCII名"の無視対象を持つ隔離worktreeがある
    When worktreeの後片付け可否を観測する
    Then 後片付け判定は"種別不明の理由を含まない"である

  Scenario: SCN-UNIT-WTIGN-002 改行を含むfile名がそのままの形で観測される
    Given "改行を含む名前"の無視対象を持つ隔離worktreeがある
    When worktreeの後片付け可否を観測する
    Then 無視対象資産の観測列は"改行を含む名前1件"である

  Scenario: SCN-UNIT-WTIGN-003 quotepathの設定で観測結果が変わらない
    Given "非ASCII名"の無視対象を持つ隔離worktreeがある
    When quotepathをtrueとfalseの両方にして後片付け可否を観測する
    Then 後片付け判定は"2値で一致する"である

  Scenario: SCN-UNIT-WTIGN-004 allowlistを満たす非ASCII名はblockingにならない
    Given "allowlist済み非ASCII名"の無視対象を持つ隔離worktreeがある
    When worktreeの後片付け可否を観測する
    Then 後片付け判定は"無視対象を理由にblockingしない"である

  Scenario: SCN-UNIT-WTIGN-005 実fixtureで作れる危険なpathは従来どおり拒否される
    Given "危険なpath"の無視対象を持つ隔離worktreeがある
    When worktreeの後片付け可否を観測する
    Then 後片付け判定は"種別不明の理由を含む"である

  Scenario: SCN-UNIT-WTIGN-006 ASCII名だけなら観測列が期待どおりになる
    Given "ASCII名のみ"の無視対象を持つ隔離worktreeがある
    When worktreeの後片付け可否を観測する
    Then 無視対象資産の観測列は"ASCII名2件"である
