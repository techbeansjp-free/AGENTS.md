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
