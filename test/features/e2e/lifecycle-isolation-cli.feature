@e2e
Feature: CLI lifecycleを隔離ディレクトリだけで実行する

  Scenario: SCN-E2E-LIFECYCLE-001 CLIのinstall・update・deleteを隔離ディレクトリで実行する
    Given CLI lifecycle用の隔離consumerがある
    When CLIのinstallとupdateとdeleteをapplyする
    Then CLI lifecycleは成功してconsumer資産だけが残る

  Scenario: SCN-E2E-LIFECYCLE-002 CLIのdeleteは既定でpreviewとなり外部writeしない
    Given CLIで導入済みの隔離consumerと外部一時資産がある
    When applyなしでCLIのdeleteを実行する
    Then deleteはpreviewだけを返して隔離先と外部資産を変更しない
