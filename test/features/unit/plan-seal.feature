@unit
Feature: 承認済み計画の封印と計画変更記録

  Scenario: SCN-UNIT-PLANSEAL-001 quickのStep 4記録が00の計画封印を成果物から計算する
    Given Step 1まで記録したquick stagingがある
    When Step 4を呼出し側の偽の封印値付きで記録する
    Then Step 4 entryのplanSealは00の実digestだけを持ち偽の値を採用しない

  Scenario: SCN-UNIT-PLANSEAL-002 fullのStep 8記録が00から03の計画封印を持ちStep 4は封印しない
    Given 01から03を置きStep 7まで記録したfull stagingがある
    When Step 8を記録する
    Then Step 8 entryのplanSealは00から03の実digestを持ちStep 4 entryは封印を持たない

  Scenario: SCN-UNIT-PLANSEAL-003 封印後に計画文書を編集するとStep 9記録を拒否し戻すと受理する
    Given Step 4で封印したquick stagingとcommit済みrepositoryがある
    When 00を編集してStep 9を記録する
    Then 封印済みで00が変化したことと05_計画変更.mdを名指しして拒否しjournalは変わらない
    And 同じ状態のStep 10記録も封印済み計画の変化を名指しして拒否する
    And 00を封印時の内容へ戻すとStep 9を記録できる

  Scenario: SCN-UNIT-PLANSEAL-004 封印後に計画文書を編集するとdelivery直前検査がdigest照合より先に拒否する
    Given Step 4で封印したquick stagingとcommit済みrepositoryがある
    When 00を編集してdelivery直前検査を実行する
    Then 診断は計画凍結と05_計画変更.mdを名指ししdigest不一致の診断ではない

  Scenario: SCN-UNIT-PLANSEAL-005 封印を持たない旧journalでは計画凍結を検査しない
    Given 封印を持たないStep 4 entryだけを記録した旧quick stagingがある
    When 00を編集して計画凍結を検査する
    Then 計画凍結の検査は拒否しない

  Scenario: SCN-UNIT-PLANSEAL-006 計画変更記録は欠番・重複・項目欠落・placeholderを拒否する
    Given 計画変更記録の正しい例と不正な例がある
    When それぞれを構造検査する
    Then 正しい例だけを受理し不正な例は理由を名指しして拒否する

  Scenario: SCN-UNIT-PLANSEAL-007 封印後の計画変更記録の構造不正はStep 9記録を拒否する
    Given Step 4で封印したquick stagingとcommit済みrepositoryがある
    When 項目の欠けた05_計画変更.mdを置いてStep 9を記録する
    Then 05_計画変更.mdの構造検査失敗と欠けた項目を名指しして拒否する

  Scenario: SCN-UNIT-PLANSEAL-008 journal構造検査は封印Step以外と不正なfile集合のplanSealを拒否する
    Given 封印Step以外のplanSealと不正なfile集合のplanSealと正しいplanSealを持つjournal行がある
    When journal行を構造検査する
    Then 不正な2行だけが理由を名指しして拒否される

  Scenario: SCN-UNIT-PLANSEAL-009 --reconfirmを拒否し既存journalの再確定entryは読める
    Given Step 0から8まで記録したfull stagingがある
    When Step 3を--reconfirm付きで記録する
    Then 廃止を名指しして拒否されjournalは変わらない
    And 通常entryに続く既存の再確定entryを含むjournalは順序検査を通る

  Scenario: SCN-UNIT-PLANSEAL-010 封印後の契約変更は計画変更記録へ振り分ける
    Given fullのAC変更とquickの通常契約変更とquickの失格条件の発見がある
    When 封印済みと未封印でそれぞれ発見を評価する
    Then 封印済みの再確定はrecord-planning-amendmentと05_計画変更.mdへ置き換わり昇格判定は変わらない

  Scenario: SCN-UNIT-PLANSEAL-011 assess-discoveryはstagingの封印をjournalから観測する
    Given Step 4で封印したquick stagingとquickの通常契約変更の発見入力がある
    When staging指定ありとなしでassess-discoveryを実行する
    Then staging指定ありだけがrecord-planning-amendmentを返す

  Scenario: SCN-UNIT-PLANSEAL-012 digest不一致の診断は変化と記録状態に応じた次の行動を返し再確定を案内しない
    Given 追加・削除・封印済み計画の変化と各記録状態の組がある
    When digest不一致の診断文を生成する
    Then 変化した成果物を名指しし記録状態ごとの次の行動を返し--reconfirmを含まない
