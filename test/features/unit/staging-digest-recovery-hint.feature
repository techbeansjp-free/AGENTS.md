@unit
Feature: staging digest不一致の復旧案内

  Scenario: SCN-UNIT-RECOVERYHINT-001 Step 10記録後は上流再確定を案内する
    Given Step 10を記録しStep 11を記録していないjournalの記録状態がある
    When staging digest不一致の案内を生成する
    Then 案内が上流Step再確定と対象Step範囲を名指しする

  Scenario: SCN-UNIT-RECOVERYHINT-002 Step 10記録前は従来の案内を返す
    Given Step 10を記録していないjournalの記録状態がある
    When staging digest不一致の案内を生成する
    Then 案内が最新Stepの再記録を示し上流再確定を名指ししない

  Scenario: SCN-UNIT-RECOVERYHINT-003 Step 11記録後は上流再確定を案内しない
    Given Step 11まで記録したjournalの記録状態がある
    When staging digest不一致の案内を生成する
    Then 案内が上流再確定を名指しせずstagingを編集しないことを示す

  Scenario: SCN-UNIT-RECOVERYHINT-004 規範文書とStep skillから到達できる
    Given 配布される規範文書とStep 10のskill契約がある
    When 上流再確定の記述を読み取る
    Then 両方に上流再確定の記述がある
