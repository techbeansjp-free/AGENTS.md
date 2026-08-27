@integration
Feature: 保護workflowが呼ぶscriptがtrusted validatorに固定されていることを強制する

  Scenario: SCN-INT-SCRIPTPIN-001 製品repositoryに未固定の参照がない
    Given script固定検査の準備がある
    When "SCN-INT-SCRIPTPIN-001"のscript固定検査を実行する
    Then script固定検査は期待結果になる

  Scenario: SCN-INT-SCRIPTPIN-002 固定集合に無いscriptの参照を検出する
    Given script固定検査の準備がある
    When "SCN-INT-SCRIPTPIN-002"のscript固定検査を実行する
    Then script固定検査は期待結果になる
