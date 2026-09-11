@unit
Feature: 上流再確定entryは順序判定から外れ通常entryと区別できる

  Scenario: SCN-UNIT-RECONFIRM-001 Step 8記録後にStep 3を再確定記録できる
    Given Step 0から8まで記録したfull stagingがある
    When Step 3を--reconfirm付きで記録する
    Then 記録は受理されworkflow verifyのoutOfOrderは空である

  Scenario: SCN-UNIT-RECONFIRM-002 再確定entryはreconfirmationで区別できる
    Given Step 0から8まで記録したfull stagingがある
    When Step 3を--reconfirm付きで記録する
    Then 追記entryはreconfirmation trueを持ちjournal行で通常entryと区別できる

  Scenario: SCN-UNIT-RECONFIRM-003 flag無しの後付けは従来どおり拒否する
    Given Step 0から8まで記録したfull stagingがある
    When Step 3を--reconfirmなしで記録する
    Then 記録はoutOfOrderで拒否されjournalは変わらない

  Scenario: SCN-UNIT-RECONFIRM-004 先行entryの無いStepとStep 10は再確定できない
    Given Step 0から4まで記録したfull stagingがある
    When Step 5とStep 10を--reconfirm付きで記録する
    Then 両方とも理由を名指しして拒否されjournalは変わらない

  Scenario: SCN-UNIT-RECONFIRM-005 journal本文のreconfirmationはtrueかつStep 1〜9だけを受理する
    Given reconfirmationにtrue以外の値とStep 10を持つjournal行がある
    When journalを構造検査する
    Then 両方の行が理由を名指しして拒否される
