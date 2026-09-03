@unit @evidence-claim-vocabulary
Feature: pass根拠の性質主張へ検証の併記を要求する

  Scenario: SCN-UNIT-CLAIMVOCAB-001 裸の性質主張をpass根拠に置けない
    Given pass行へ検証の併記がない性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張として拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-002 SCN IDの併記があれば受理する
    Given pass行へSCN IDを併記した性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-003 原文引用の併記があれば受理する
    Given pass行へ原文引用を併記した性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-004 pass以外の判定行は対象にしない
    Given not-applicable行へ裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-005 判定列を持たない表は対象にしない
    Given 判定列のない表へ裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-006 個別監査表のpass行も対象にする
    Given 個別判定列のpass行へ裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張として拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-007 登録していない一般的全称語は対象にしない
    Given pass行へ登録外の全称語だけがあるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-008 判定列が無く末尾cellがpassでも対象にしない
    Given 判定列が無く末尾cellがpassの表へ裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-009 code fence内の表行を対象にしない
    Given code fence内に裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-010 閉じないfence以降を対象にしない
    Given 閉じないcode fenceの後に裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-011 行内の各登録語彙を各cellについて検査する
    Given 証拠のあるcellと裸のcellへ別の登録語彙があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 証拠の無い語彙だけが1件拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-012 同じ語彙が複数cellにあるとき証拠の無いcellを検出する
    Given 同じ登録語彙が証拠ありcellと裸cellの両方にあるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張として拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-013 判定値の内部文字を削らない
    Given 判定列がp assの行へ裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-014 登録語彙そのものの引用を併記と認めない
    Given pass行へ登録語彙そのものを引用した性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張として拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-015 異なるfence記号ではfenceを閉じない
    Given backtick fence内にtilde行と裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-016 cell内のfence記号をfenceと読まない
    Given cell内にfence記号を含む裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張として拒否される

  Scenario: SCN-UNIT-CLAIMVOCAB-017 短いdelimiterでは長いfenceを閉じない
    Given 4個のbacktickで開き途中に3個の行がある裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である

  Scenario: SCN-UNIT-CLAIMVOCAB-018 info string付きの行ではfenceを閉じない
    Given fence内にinfo string付きのdelimiter行がある裸の性質主張があるreview artifactがある
    When pass根拠の性質主張を検査する
    Then 検証を伴わない主張は0件である
