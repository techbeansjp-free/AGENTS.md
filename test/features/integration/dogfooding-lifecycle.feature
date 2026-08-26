@integration
Feature: 製品自身のrepositoryがlifecycle健全性検査に合格する

  Scenario: SCN-INT-DOGFOOD-001 製品自身の複製へinstallするとdoctorがhealthyを返す
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-001"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる

  Scenario: SCN-INT-DOGFOOD-002 install適用後もrepositoryがcleanである
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-002"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる

  Scenario: SCN-INT-DOGFOOD-003 未展開のままではdoctorがhealthy falseを返す
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-003"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる

  Scenario: SCN-INT-DOGFOOD-004 managed recordを壊すとdoctorがhealthy falseを返す
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-004"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる

  Scenario: SCN-INT-DOGFOOD-005 merge済みで後片付け可能なworktreeをdoctorが報告する
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-005"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる

  Scenario: SCN-INT-DOGFOOD-006 worktree報告は削除を行わない
    Given dogfooding lifecycle検査の準備がある
    When "SCN-INT-DOGFOOD-006"のdogfooding lifecycle検査を実行する
    Then dogfooding lifecycle検査は期待結果になる
