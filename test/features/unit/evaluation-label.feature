@unit
Feature: EvaluationLabel（referenceValueの記録経路）

  Scenario: SCN-UNIT-EVALLABEL-001 evidence-adjudicatedはevidenceRefsが必須である
    Given evidenceRefsが空のevidence-adjudicated入力がある
    When evaluation label入力を解析する
    Then 解析でエラーが投げられる

  Scenario: SCN-UNIT-EVALLABEL-002 owner-adjudicatedはevidenceRefsを省略できる
    Given evidenceRefsを省略したowner-adjudicated入力がある
    When evaluation label入力を解析する
    Then 解析結果のevidenceRefsは空配列である

  Scenario: SCN-UNIT-EVALLABEL-003 未知のlabelSourceは拒否される
    Given 未知のlabelSourceを持つ入力がある
    When evaluation label入力を解析する
    Then 解析でエラーが投げられる

  Scenario: SCN-UNIT-EVALLABEL-004 4種のlabelSourceすべてが正しく解析される
    Given independent-reviewのlabelSourceを持つ有効な入力がある
    When evaluation label入力を解析する
    Then 解析結果のlabelSourceはindependent-reviewである

  Scenario: SCN-UNIT-EVALLABEL-005 存在しないdecisionRecordIdへの追記は拒否される
    Given decision journalが空のprimaryRootがある
    When 存在しないdecisionRecordIdでlabelを追記する
    Then 追記でエラーが投げられる

  Scenario: SCN-UNIT-EVALLABEL-006 decision journalに実在するdecisionRecordIdへの追記は成功し検索できる
    Given decisionRecordIdが記録済みのprimaryRootがある
    When そのdecisionRecordIdでlabelを追記する
    Then 追記したlabelを同じdecisionRecordIdで検索できる

  Scenario: SCN-UNIT-EVALLABEL-007 同じdecisionRecordIdへの重複labelは拒否される
    Given decisionRecordIdが記録済みのprimaryRootがある
    And そのdecisionRecordIdでlabelを追記する
    When 同じdecisionRecordIdでもう1件labelを追記する
    Then 追記でエラーが投げられる
