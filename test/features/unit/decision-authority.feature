@unit
Feature: DecisionAuthorityModeごとの有効値反映判定

  Scenario: SCN-UNIT-DECAUTH-001 authoritativeは提案をそのまま反映する
    Given authorityMode "authoritative" とproposedValue "public-api" がある
    When resolveAuthorityDecisionを実行する
    Then effectiveValueは"public-api"で確認不要である

  Scenario: SCN-UNIT-DECAUTH-002 advisoryは未確認だと反映しない
    Given authorityMode "advisory" とproposedValue "Critical" があり確認者が無い
    When resolveAuthorityDecisionを実行する
    Then effectiveValueはnullで確認が必要である

  Scenario: SCN-UNIT-DECAUTH-003 advisoryは確認済みなら反映する
    Given authorityMode "advisory" とproposedValue "Critical" があり確認者 "coordinator" がいる
    When resolveAuthorityDecisionを実行する
    Then effectiveValueは"Critical"で確認不要である

  Scenario: SCN-UNIT-DECAUTH-004 one-way-escalationは安全側方向を確認なしで反映する
    Given authorityMode "one-way-escalation" とproposedValue "not-minor" があり安全側の値は"not-minor"で確認者は無い
    When resolveAuthorityDecisionを実行する
    Then effectiveValueは"not-minor"で確認不要である

  Scenario: SCN-UNIT-DECAUTH-005 one-way-escalationは緩和方向を未確認では反映しない
    Given authorityMode "one-way-escalation" とproposedValue "minor" があり安全側の値は"not-minor"で確認者は無い
    When resolveAuthorityDecisionを実行する
    Then effectiveValueはnullで確認が必要である

  Scenario: SCN-UNIT-DECAUTH-006 one-way-escalationは緩和方向でも確認済みなら反映する
    Given authorityMode "one-way-escalation" とproposedValue "minor" があり安全側の値は"not-minor"で確認者 "coordinator" がいる
    When resolveAuthorityDecisionを実行する
    Then effectiveValueは"minor"で確認不要である

  Scenario: SCN-UNIT-DECAUTH-007 constrained-choiceは候補集合内の選択を反映する
    Given authorityMode "constrained-choice" とproposedValue "codex-sol" があり候補集合は"codex-sol,opus"である
    When resolveAuthorityDecisionを実行する
    Then effectiveValueは"codex-sol"で確認不要である

  Scenario: SCN-UNIT-DECAUTH-008 constrained-choiceは候補集合外を拒否する
    Given authorityMode "constrained-choice" とproposedValue "gemini" があり候補集合は"codex-sol,opus"である
    When resolveAuthorityDecisionを実行する
    Then 拒否される
