@unit
Feature: delivery summaryの厳密な入力契約

  Scenario Outline: SCN-UNIT-DELIVERYINPUT-001 未知fieldと不完全な機械欄や仕様宣言を拒否する
    Given 正常なdelivery summary JSONがある
    When summaryの「<case>」を不正にする
    Then delivery summary入力が拒否される

    Examples:
      | case                  |
      | caller-head           |
      | caller-approval       |
      | missing-placeholder   |
      | duplicate-placeholder |
      | unknown-placeholder   |
      | missing-consistent    |
      | short-rationale       |
      | false-consistent      |
      | wrong-issue           |

  Scenario: SCN-UNIT-DELIVERYINPUT-002 末端helpの完全JSON例をそのまま入力できる
    Given 正常なdelivery summary JSONがある
    When PR create helpのsummaryExampleを読む
    Then 全placeholderと改行を持つsummaryとして解釈できる
