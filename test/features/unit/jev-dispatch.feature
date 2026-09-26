@unit
Feature: Jev requestのpure構築とdata egress policy、response解析

  Scenario: SCN-UNIT-JEVDISP-001 optionsが2件未満のchoice questionは拒否される
    Given optionsが1件のchoice questionがある
    When choice requestを構築する
    Then requestの構築でエラーが投げられる

  Scenario: SCN-UNIT-JEVDISP-002 criteriaに未記載のoptionがあるchoice questionは拒否される
    Given criteriaが一部欠けたchoice questionがある
    When choice requestを構築する
    Then requestの構築でエラーが投げられる

  Scenario: SCN-UNIT-JEVDISP-003 optionsが重複するchoice questionは拒否される
    Given optionsが重複するchoice questionがある
    When choice requestを構築する
    Then requestの構築でエラーが投げられる

  Scenario: SCN-UNIT-JEVDISP-004 正常なchoice requestが正しい形状で構築される
    Given 正常なchoice questionがある
    When choice requestを構築する
    Then 構築されたrequestはmodel・questions・stateを含む

  Scenario: SCN-UNIT-JEVDISP-005 禁止key名を含むstateはegress policyで拒否される
    Given apiKeyというkeyを含むstateがある
    When stateをegress検証する
    Then egress検証はokがfalseで理由に禁止key名が含まれる

  Scenario: SCN-UNIT-JEVDISP-006 上限を超える長さの文字列を含むstateはegress policyで拒否される
    Given 上限を超える長さの文字列を含むstateがある
    When stateをegress検証する
    Then egress検証はokがfalseで理由に上限が含まれる

  Scenario: SCN-UNIT-JEVDISP-007 通常のstateはegress policyを通過する
    Given 通常のcontext文字列だけを含むstateがある
    When stateをegress検証する
    Then egress検証はokがtrueである

  Scenario: SCN-UNIT-JEVDISP-008 200応答が期待形状ならok outcomeへ解析される
    Given 期待形状の200応答がある
    When 応答を解析する
    Then outcomeはokでchoiceとconfidenceとusageを持つ

  Scenario: SCN-UNIT-JEVDISP-009 200応答でもanswers[key]の形状が不正ならschema-errorになる
    Given answersの形状が不正な200応答がある
    When 応答を解析する
    Then outcomeはschema-errorである

  Scenario: SCN-UNIT-JEVDISP-010 401応答はauth-errorへ解析される
    Given 401応答がある
    When 応答を解析する
    Then outcomeはauth-errorである

  Scenario: SCN-UNIT-JEVDISP-011 422応答はpydantic detailを含むschema-errorへ解析される
    Given 422応答がある
    When 応答を解析する
    Then outcomeはschema-errorであり理由にlocが含まれる

  Scenario: SCN-UNIT-JEVDISP-012 400応答はusage-errorへ解析される
    Given 400応答がある
    When 応答を解析する
    Then outcomeはusage-errorである

  Scenario: SCN-UNIT-JEVDISP-013 429応答はrate-limitedへ解析されretryAfterMsを保持する
    Given retryAfterMs付きの429応答がある
    When 応答を解析する
    Then outcomeはrate-limitedでretryAfterMsが3000である

  Scenario: SCN-UNIT-JEVDISP-014 未知のstatusはunexpected-statusへ解析される
    Given 500応答がある
    When 応答を解析する
    Then outcomeはunexpected-statusでstatusが500である
