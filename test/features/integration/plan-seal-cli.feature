@integration
Feature: CLI経路でのstaging digest不一致の診断

  Scenario: SCN-INT-PLANSEAL-001 delivery直前検査の診断が追加された成果物と次の行動を名指しする
    Given Step 10まで記録した隔離stagingへ成果物を追加した
    When CLI経路のdelivery直前検査を実行する
    Then 診断は追加された成果物と前進commitを伴うreview roundを名指しし--reconfirmを含まない

  Scenario: SCN-INT-PLANSEAL-002 review session更新前検査の診断にも同じ説明が届く
    Given Step 10まで記録した隔離stagingへ成果物を追加した
    When review session更新前検査を実行する
    Then 診断は追加された成果物と前進commitを伴うreview roundを名指しし--reconfirmを含まない

  Scenario: SCN-INT-PLANSEAL-003 delivery stateを読めなくてもjournalのStep 11で内容を戻す案内を返す
    Given Step 11まで記録しdelivery stateを読み取れない隔離stagingへ成果物を追加した
    When review session更新前検査を実行する
    Then 診断は編集前の内容へ戻す手順を示し--reconfirmを含まない

  Scenario: SCN-INT-PLANSEAL-004 Step 10記録後に未記録のAMD-002を追記するとdelivery検査が拒否する
    Given AMD-001を記録したStep 10までのquick stagingがある
    When 未記録のAMD-002を追記してdelivery直前検査を実行する
    Then 診断は未記録のAMD-002とStep 10の再記録を名指しする
    And AMD-002を含めてStep 10を再記録すると計画変更の診断は消える

  Scenario: SCN-INT-PLANSEAL-005 版管理下stagingではcommit上の05_計画変更.mdもworktreeと一致させる
    Given Step 4で封印した版管理下quick stagingとcommit済みrepositoryがある
    When AMD-001をcommitせずにStep 9を記録する
    Then commit上の05_計画変更.mdの不一致を名指しして拒否しjournalは変わらない
    And AMD-001をcommitするとStep 9は世代2を記録する
