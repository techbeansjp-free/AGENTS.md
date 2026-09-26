@unit
Feature: 変更の配布物影響をGitとpackage filesから導出する

  Scenario: SCN-UNIT-DISTIMPACT-001 配布境界へ入るpathを判定する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-001"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-002 compileされて配布されるsourceも配布境界とみなす
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-002"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-003 配布されないpathを配布境界に含めない
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-003"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-010 dist配下の直接変更も配布境界とみなす
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-010"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-015 配布物影響を散文なしで変更pathから導出する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-015"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる
