@unit
Feature: finding修正提案を隔離検証する

  Scenario: SCN-UNIT-SUGGESTION-001 対象HEADの単一fileに適用できるpatchを受理する
    Given 修正提案用の隔離Git repositoryがある
    When 対象HEADの有効な修正提案を検証する
    Then 対象HEADとpatchを持つ修正提案が返る
    And 修正提案の検証は作業treeを変更しない

  Scenario: SCN-UNIT-SUGGESTION-003 複数ドット名のsource fileへのpatchを受理する
    Given 修正提案用の隔離Git repositoryがある
    When 複数ドット名の有効な修正提案を検証する
    Then 対象HEADとpatchを持つ修正提案が返る
    And 修正提案の検証は作業treeを変更しない

  Scenario: SCN-UNIT-SUGGESTION-004 過大候補を省略して後続の有効提案を検証する
    Given 修正提案用の隔離Git repositoryがある
    When 過大候補の次に有効な修正提案を検証する
    Then 後続の有効提案だけがfindingへ添えられる
    And 修正提案の検証は作業treeを変更しない

  Scenario: SCN-UNIT-SUGGESTION-005 構文検証を期限で終了する
    Given 修正提案の構文検証器がある
    When 大きなTypeScript sourceを1ms期限で構文検証する
    Then 構文検証は1秒以内に失敗する

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
      | JS内の型注釈 |
      | JS内のJSX |
      | UTF-8でないblob |
