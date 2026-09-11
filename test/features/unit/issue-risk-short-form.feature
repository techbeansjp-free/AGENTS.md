@unit
Feature: Verification Set riskに比例した02/03短縮形式

  Scenario: SCN-WF-1334-001 low-riskの02/03短縮行を受理する
    Given Verification Set riskが"low"で02と03の対象節が理由付き短縮行である
    When risk比例のIssue成果物を検証する
    Then risk比例のIssue検証は合格する

  Scenario Outline: SCN-WF-1334-002 high-riskとunknownの短縮行を拒否する
    Given Verification Set riskが"<risk>"で02と03の対象節が理由付き短縮行である
    When risk比例のIssue成果物を検証する
    Then short formを許可するriskがlowだけだと示して拒否する

    Examples:
      | risk    |
      | high    |
      | unknown |

  Scenario: SCN-WF-1334-003 理由なしの短縮行を拒否する
    Given Verification Set riskが"low"で02と03の対象節が理由なし短縮行である
    When risk比例のIssue成果物を検証する
    Then 理由付きの単一行書式を示して拒否する

  Scenario: SCN-WF-1334-004 templateとvalidatorの短縮契約が一致する
    Given 出荷される02と03のIssue templateがある
    When risk比例短縮のtemplate注記を検査する
    Then 両templateがlow限定とissue validateを明記する

  Scenario: SCN-WF-1334-005 既存詳細形式とmode判定を維持する
    Given Verification Set riskが"high"で02と03の対象節が詳細記述である
    When risk比例のIssue成果物を検証する
    Then risk比例のIssue検証は合格する

  Scenario: SCN-WF-1334-006 Verification Set入力のsymlinkを拒否する
    Given low-risk短縮行のVerification Set入力がsymlinkである
    When risk比例のIssue成果物を検証する
    Then Verification Set入力が通常fileでないと示して拒否する

  Scenario Outline: SCN-WF-1334-007 high-riskのUnicode類似短縮行を拒否する
    Given Verification Set riskが"high"で02と03の対象節が区切り"<separator>"の短縮行である
    When risk比例のIssue成果物を検証する
    Then 理由付きの単一行書式を示して拒否する

    Examples:
      | separator |
      | ：        |
      | ∶         |
      | ː         |

  Scenario: SCN-WF-1334-008 字下げcodeを短縮形式として受理しない
    Given Verification Set riskが"low"で02と03の対象節が字下げcode短縮行である
    When risk比例のIssue成果物を検証する
    Then 理由付きの単一行書式を示して拒否する

  Scenario Outline: SCN-WF-1334-009 対象外から始まる通常の日本語本文を維持する
    Given Verification Set riskが"high"で02と03の対象節が本文"<content>"である
    When risk比例のIssue成果物を検証する
    Then risk比例のIssue検証は合格する

    Examples:
      | content                                  |
      | 対象外理由を設計判断として詳しく記録する。 |
      | 対象外ではないため既存契約を維持する。     |
