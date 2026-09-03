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
