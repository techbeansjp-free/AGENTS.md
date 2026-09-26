@unit
Feature: Continuous shadowのquestion構成・record構築・永続化

  Scenario: SCN-UNIT-JEVSHADOW-001 executor.kindがproviderのときだけshadow対象になる
    Given deterministic executorがある
    When shadow適格性を判定する
    Then shadow適格性はfalseである

  Scenario: SCN-UNIT-JEVSHADOW-002 provider executorはshadow対象になる
    Given provider executorがある
    When shadow適格性を判定する
    Then shadow適格性はtrueである

  Scenario: SCN-UNIT-JEVSHADOW-003 DCAND-010は固定optionsのquestionへ変換される
    Given DCAND-010のshadow question入力がある
    When shadow questionを計画する
    Then questionのoptionsはminorとnot-minorである

  Scenario: SCN-UNIT-JEVSHADOW-004 DCAND-009はcandidateSetが2件以上なければ計画できない
    Given candidateSetが1件のDCAND-009のshadow question入力がある
    When shadow questionを計画する
    Then shadow question計画はundefinedである

  Scenario: SCN-UNIT-JEVSHADOW-005 DCAND-009はcandidateSetがそのままoptionsになる
    Given candidateSetが2件のDCAND-009のshadow question入力がある
    When shadow questionを計画する
    Then questionのoptionsはcandidateSetと一致する

  Scenario: SCN-UNIT-JEVSHADOW-006 DCAND-006はshadow question計画の対象外である
    Given DCAND-006のshadow question入力がある
    When shadow questionを計画する
    Then shadow question計画はundefinedである

  Scenario: SCN-UNIT-JEVSHADOW-007 ok outcomeはmatchesPrimaryProposedValueを比較して記録する
    Given primaryProposedValueと一致するok outcomeがある
    When shadow recordを構築する
    Then shadow recordのmatchesPrimaryProposedValueはtrueである

  Scenario: SCN-UNIT-JEVSHADOW-008 error outcomeはjevProposedValueをnullのまま記録する
    Given auth-error outcomeがある
    When shadow recordを構築する
    Then shadow recordのjevProposedValueはnullでoutcomeKindはauth-errorである

  Scenario: SCN-UNIT-JEVSHADOW-009 shadow recordを追記して同じdecisionRecordIdで検索できる
    Given 空のjev-shadow journalがある
    When shadow recordを1件追記する
    Then 同じdecisionRecordIdでshadow recordを検索できる

  Scenario: SCN-UNIT-JEVSHADOW-010 同じdecisionRecordIdの重複追記は拒否される
    Given 空のjev-shadow journalがある
    And shadow recordを1件追記する
    When 同じdecisionRecordIdでもう1件追記する
    Then shadow追記でエラーが投げられる
