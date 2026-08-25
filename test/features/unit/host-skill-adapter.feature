@unit
Feature: host skill登録アダプターのpackage契約

  Scenario: SCN-UNIT-HOST-SKILL-001 adapter正本は有効なfrontmatterと正本linkを持つ
    Given package内のhost skill登録アダプター正本がある
    When adapter正本の契約を検査する
    Then adapter正本はasc-step frontmatterとWorkflow・Step skillへの誘導を持つ

  Scenario: SCN-UNIT-HOST-SKILL-002 package検査はadapter正本を必須配布資産にする
    Given package内容検査scriptがある
    When package内容検査の必須資産を検査する
    Then host skill登録アダプター正本は必須配布資産である
