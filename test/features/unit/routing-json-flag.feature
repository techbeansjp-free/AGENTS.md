@unit
Feature: routing rolesとceilingのJSON flagは宣言・実行例・診断が実装と一致する

  Scenario: SCN-UNIT-JSONFLAG-001 helpがinline JSON型と実行例を示す
    Given routing rolesとrouting ceilingのusageがある
    When 両subcommandの--helpを表示する
    Then --assignmentsと--overrideはJSON型で説明と実行例はinline JSONを示す

  Scenario: SCN-UNIT-JSONFLAG-002 path風の値はinline JSONを渡す案内つきで拒否する
    Given file pathをJSON flagへ渡すargvがある
    When routing rolesとrouting ceilingを実行する
    Then 両方とも終了値1でreasonsにinline JSONを渡す案内を含み値本文を含まない

  Scenario: SCN-UNIT-JSONFLAG-003 inline JSONの受理と判定は変わらない
    Given 先頭空白付きのinline JSONをJSON flagへ渡すargvがある
    When routing rolesとrouting ceilingを実行する
    Then 変更前と同じ判定を返す
