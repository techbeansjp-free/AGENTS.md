@e2e
Feature: CLIでhost skill登録アダプターを管理する

  Scenario: SCN-E2E-HOST-SKILL-001 CLI install・update・doctor・deleteが両host adapterを管理する
    Given host adapter CLI検証用consumerがある
    When CLIでinstallとupdateとdoctorとdeleteを適用する
    Then CLIは両host adapterを登録診断削除して成功する
