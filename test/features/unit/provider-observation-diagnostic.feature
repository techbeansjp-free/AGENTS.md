@unit
Feature: provider観測の失敗診断は実行入口と終了値を示す

  観測に失敗したとき、利用者が配布物のdistを読まずに「何を実行して何が返ったか」を
  出力だけで特定できるようにする。診断へ載せるのは製品が組み立てたargvと整数の
  終了値だけであり、標準エラーの本文は転記しない。

  Scenario: SCN-UNIT-OBSDIAG-001 非0終了の観測は実行argvと終了値を返す
    Given 終了値3で終了する実行入口を持つproviderがある
    When 失敗診断のためにproviderを観測する
    Then entrypointは"provider-fixture models list --json"である
    And reasonは"provider実行入口のread-only観測が失敗しました（終了値3）"である

  Scenario: SCN-UNIT-OBSDIAG-002 起動できない入口は起動失敗として実行argvを返す
    Given 起動に失敗する実行入口を持つproviderがある
    When 失敗診断のためにproviderを観測する
    Then entrypointは"provider-fixture models list --json"である
    And reasonは"provider実行入口を起動できません"である

  Scenario: SCN-UNIT-OBSDIAG-003 診断にstderrの本文を含めない
    Given stderrへ秘密を書いて終了値3で終了する実行入口を持つproviderがある
    When 失敗診断のためにproviderを観測する
    Then 観測結果のどのfieldにもstderrの本文が現れない

  Scenario: SCN-UNIT-OBSDIAG-004 実在しない実行fileは既定executorでも起動失敗として報告される
    Given 実在しない実行fileを指すproviderがある
    When 既定executorで失敗診断のためにproviderを観測する
    Then reasonは"provider実行入口を起動できません"である
    And reasonに終了値が現れない

  Scenario: SCN-UNIT-OBSDIAG-005 executorがargsを書き換えても診断は製品が組み立てたargvを示す
    Given 受け取ったargsを書き換えてから終了値3で終了する実行入口を持つproviderがある
    When 失敗診断のためにproviderを観測する
    Then entrypointは"provider-fixture models list --json"である

  Scenario: SCN-UNIT-OBSDIAG-006 同期実行は起動したprocessの打ち切りを起動失敗としない
    Given 実在しない実行fileと、起動してから打ち切られる実行fileがある
    When 同期実行でそれぞれを実行する
    Then 実在しない方だけが起動失敗として報告される

  Scenario: SCN-UNIT-OBSDIAG-007 JSONLセッションも起動失敗と打ち切りを区別する
    Given 実在しない実行fileと、起動してから打ち切られる実行fileがある
    When JSONLセッションでそれぞれを実行する
    Then 実在しない方だけが起動失敗として報告される

