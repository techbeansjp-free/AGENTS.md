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

  Scenario: SCN-E2E-RELID-001 正式配布物installでのmanaged-assets.json一致
    Given release-identity.jsonを持つ配布物bundleと隔離consumerがある
    When bundleのCLIでinstallをapplyする
    Then managed-assets.jsonのversionはrelease versionと一致する

  Scenario: SCN-E2E-RELID-002 --versionがrelease versionを返す
    Given release-identity.jsonを持つ配布物bundleがある
    When bundleのCLIで--versionを実行する
    Then 標準出力はrelease versionと一致し終了値は0である

  Scenario: SCN-E2E-RELID-003 source buildの--versionとdoctorはsentinelをrelease versionとして表示しない
    Given CLI lifecycle用の隔離consumerがある
    When source buildのCLIで--versionとdoctorを実行する
    Then --versionとdoctorはsentinelをrelease versionとして表示せずdoctorのhealthyは変わらない

  Scenario: SCN-E2E-RELID-004 source buildでのinstall/updateは拒否されず警告文を含む
    Given CLI lifecycle用の隔離consumerがある
    When source buildのCLIでinstallとupdateをapplyする
    Then installとupdateは成功し警告文を含む
