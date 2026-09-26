@unit
Feature: ローカル設定のactive→primary worktree継承（Issue #1485、L-04）

  Scenario: SCN-UNIT-LCW-001 activeにfileが無ければprimaryへfallbackする
    Given primaryにJev provider configがあり連結worktreeには無い
    When 連結worktreeからresolveJevProviderConfigを実行する
    Then 解決状態はenabledでsourceはprimaryである

  Scenario: SCN-UNIT-LCW-002 activeがdisabledならprimaryへfallbackしない
    Given primaryにJev provider configがあり連結worktreeではdisabledに設定されている
    When 連結worktreeからresolveJevProviderConfigを実行する
    Then 解決状態はdisabledでsourceはactiveである

  Scenario: SCN-UNIT-LCW-003 activeがinvalidならprimaryへfallbackしない
    Given primaryにJev provider configがあり連結worktreeでは不正な設定になっている
    When 連結worktreeからresolveJevProviderConfigを実行する
    Then 解決状態はinvalidでsourceはactiveである

  Scenario: SCN-UNIT-LCW-004 activeにもprimaryにも無ければabsentである
    Given primaryにも連結worktreeにもJev provider configが無い
    When 連結worktreeからresolveJevProviderConfigを実行する
    Then 解決状態はabsentである

  Scenario: SCN-UNIT-LCW-005 activeにあればprimaryを読まずenabledを返す
    Given primaryには無く連結worktreeにJev provider configがある
    When 連結worktreeからresolveJevProviderConfigを実行する
    Then 解決状態はenabledでsourceはactiveである
