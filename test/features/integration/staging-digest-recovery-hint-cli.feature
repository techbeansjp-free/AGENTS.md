@integration
Feature: CLI経路での復旧案内

  Scenario: SCN-INT-RECOVERYHINT-005 delivery直前検査の診断に上流再確定が届く
    Given Step 10まで記録した隔離stagingとdigest不一致がある
    When CLI経路のdelivery直前検査を実行する
    Then 返された診断に上流Step再確定の案内が含まれる

  Scenario: SCN-INT-RECOVERYHINT-009 review session更新前検査の診断にも案内が届く
    Given Step 10まで記録した隔離stagingとdigest不一致がある
    When review session更新前検査を実行する
    Then 返された診断に上流Step再確定の案内が含まれる
