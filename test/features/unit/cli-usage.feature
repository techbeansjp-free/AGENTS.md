@unit
Feature: CLIの必須flagとusageを1回の実行で提示する

  Scenario: SCN-UNIT-CLIUSAGE-001 不足している必須flagを1回の実行で全件報告する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-001"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-002 不足が1件のときはその1件だけを報告する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-002"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-003 --helpは必須flag検証より先に評価される
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-003"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-004 usageに必須flag、任意flag、既定値、実行例が含まれる
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-004"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-005 空白区切りのflagを無言で未指定扱いにせず専用診断で拒否する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-005"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-006 空白区切りを受理するsubcommandの既存挙動を壊さない
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-006"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-007 位置引数は先頭の必須flagを代替する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-007"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-008 trusted boundary評価は必須flag検証より先に行われる
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-008"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-009 usage未記載のflagを実装が読むと検査が拒否する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-009"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-010 実装が要求する必須flagがusageに無いと検査が拒否する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-010"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-011 usage定義のないsubcommandを検査が拒否する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-011"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-012 現行のsrc/cli.tsは検査に合格する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-012"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-013 mode決定記録を渡すと期待形式を名指しして拒否する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-013"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる

  Scenario: SCN-UNIT-CLIUSAGE-014 staging記録の書き込み可否を副作用の前に判定し記録先を案内する
    Given CLI usage単体検査の準備がある
    When "SCN-UNIT-CLIUSAGE-014"のCLI usage単体検査を実行する
    Then CLI usage単体検査は期待結果になる
