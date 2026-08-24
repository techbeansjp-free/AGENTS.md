@e2e @provider-routing
Feature: provider利用不能時のClaude fallbackとrouting CLI
  routingの7サブコマンドを合成し、Codex利用不能時は設定済みClaude coordinatorへ明示的に切り替える。

  Scenario: SCN-E2E-ROUTING-001 Codex利用不能時にClaude実装へ切り替える
    Given routing CLI用の隔離projectと利用不能なprovider実行入口がある
    When product実装taskの担当をrouting CLIから解決する
    Then routing resolveは0でClaude fallbackを解決する
    And Codex利用不能の理由とClaude実装identityを返す
    When routingの7サブコマンドを隔離projectで実行する
    Then 7サブコマンドは定義済みの終了codeを返す
    And authorizeなしのprune applyは拒否される
