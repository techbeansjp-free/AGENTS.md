@integration
Feature: root READMEのCLI同期とpackage収録

  Scenario: SCN-INT-README-001 実READMEがCLI契約検査と配布物検査を満たす
    Given repository rootに利用者向けREADMEがある
    When 実READMEのCLI契約と配布物収録設定を検査する
    Then 両方の公開README検査が成功する

  Scenario: SCN-INT-README-007 READMEのcommand driftを品質gateが拒否する
    Given 公開commandを欠落させたREADME fixtureがある
    When README fixtureのCLI契約検査を実行する
    Then CLI契約検査はREADMEのcommand driftを拒否する
