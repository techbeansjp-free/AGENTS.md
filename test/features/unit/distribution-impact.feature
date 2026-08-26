@unit
Feature: 変更の配布物影響をreview証拠で必須にする

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

  Scenario: SCN-UNIT-DISTIMPACT-004 配布物影響の節が無いartifactを拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-004"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-005 配布境界へ入るpathの記載漏れを拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-005"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-006 更新したか更新しないかの判断が無い節を拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-006"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-007 判断だけで根拠が無い節を拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-007"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-008 全件記載と判断と根拠がそろう節を受理する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-008"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-009 本文中の見出し文字列を節と誤認しない
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-009"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-010 dist配下の直接変更も配布境界とみなす
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-010"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-011 判断行が2件ある節を拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-011"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-012 許可外の判断値を拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-012"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-013 根拠がplaceholderのままの節を拒否する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-013"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる

  Scenario: SCN-UNIT-DISTIMPACT-014 番号付き見出しの節を受理する
    Given 配布物影響単体検査の準備がある
    When "SCN-UNIT-DISTIMPACT-014"の配布物影響単体検査を実行する
    Then 配布物影響単体検査は期待結果になる
