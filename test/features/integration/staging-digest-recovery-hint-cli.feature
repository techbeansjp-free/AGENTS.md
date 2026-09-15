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

  Scenario: SCN-INT-RECOVERYHINT-010 delivery stateを読めなくてもjournalのStep 11で終端案内を返す
    Given Step 11まで記録しdelivery stateを読み取れない隔離stagingとdigest不一致がある
    When CLI経路のdelivery直前検査を実行する
    Then 返された診断が上流再確定を名指しせず内容を戻す手順を示す

  Scenario: SCN-INT-RECOVERYHINT-011 review session更新前検査でも終端案内が保たれる
    Given Step 11まで記録しdelivery stateを読み取れない隔離stagingとdigest不一致がある
    When review session更新前検査を実行する
    Then 返された診断が上流再確定を名指しせず内容を戻す手順を示す

  Scenario: SCN-INT-RECOVERYHINT-012 delivery stateだけがterminalでも終端案内を返す
    Given journalがStep 11を持たずdelivery stateだけがterminalな隔離stagingとdigest不一致がある
    When CLI経路のdelivery直前検査を実行する
    Then 返された診断が上流再確定を名指しせず内容を戻す手順を示す

  Scenario: SCN-INT-RECOVERYHINT-013 journalを読めなくてもdelivery stateのterminalが効く
    Given journalを読み取れずdelivery stateがterminalな隔離stagingとdigest不一致がある
    When review session更新前検査を実行する
    Then 返された診断が上流再確定を名指しせず内容を戻す手順を示す
