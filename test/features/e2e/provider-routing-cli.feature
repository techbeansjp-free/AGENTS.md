@e2e @provider-routing
Feature: provider利用不能時の停止とrouting CLI
  routingの7サブコマンドを合成し、利用不能時もcoordinator実装へ後退しない。

  Scenario: SCN-E2E-ROUTING-001 Codex利用不能時にClaudeへ無告知で後退しない
    Given routing CLI用の隔離projectと利用不能なprovider実行入口がある
    When product実装taskの担当をrouting CLIから解決する
    Then routing resolveは非0で実装を開始しない
    And 利用不能の根拠と確認済み入口と安全なfallback候補と必要authorityと停止点と再開条件を返す
    And 安全なfallback候補は存在しないと明示する
    When routingの7サブコマンドを隔離projectで実行する
    Then 7サブコマンドは定義済みの終了codeを返す
    And authorizeなしのprune applyは拒否される
