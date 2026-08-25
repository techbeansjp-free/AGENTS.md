@integration @role-tier
Feature: project policyへrole契約とtierを統合する
  実repositoryの固定choiceを変更せず隔離fixtureで前方互換契約を検証する。

  Scenario: SCN-INT-ROLE-001 project choice fixtureがrole契約とtier mappingを定義する
    Given 一時directoryにrole契約とtier mappingを持つproject choice fixtureがある
    When project choice fixtureをruntimeで検証する
    Then project choice fixtureは妥当である

  Scenario: SCN-INT-ROLE-002 role・tier証拠が不明な場合にPR・merge・finalizeを拒否する
    Given PRとmergeとfinalizeに必要なrole・tier証拠がない
    When 終端role操作を検証する
    Then すべての終端role操作はfail closedで拒否される

  Scenario: SCN-INT-ROLE-003 project choiceのrole契約弱化とtier引き下げを拒否する
    Given role禁止操作を削除しtierを引き下げたproject choice差分がある
    When role tierのproject choice差分を分類する
    Then role契約弱化とtier引き下げが記録される
