@unit
Feature: finding修正提案を隔離検証する

  Scenario: SCN-UNIT-SUGGESTION-001 対象HEADの単一fileに適用できるpatchを受理する
    Given 修正提案用の隔離Git repositoryがある
    When 対象HEADの有効な修正提案を検証する
    Then 対象HEADとpatchを持つ修正提案が返る
    And 修正提案の検証は作業treeを変更しない

  Scenario Outline: SCN-UNIT-SUGGESTION-002 無効なpatchを省略する
    Given 修正提案用の隔離Git repositoryがある
    When "<case>" の修正提案を検証する
    Then 修正提案は省略される
    And 修正提案の検証は作業treeを変更しない

    Examples:
      | case |
      | 別HEAD |
      | 別path |
      | 文脈不一致 |
      | 構文破壊 |
      | 複数path |
      | path脱出 |
      | 64KiB超過 |
      | symlink |
