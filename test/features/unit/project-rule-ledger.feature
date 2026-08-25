@unit
Feature: project固有rule台帳の単体契約

  Scenario: SCN-UNIT-LEDGER-001 全project ruleがID・目的・所有者・scope・enforcement・証拠・変更authorityを持つ
    Given 必須fieldだけのlegacy ruleと変更authorityを持つ拡張ruleがある
    When project ruleの構造を検証する
    Then 後方互換を保ち拡張ruleの変更authorityも検証される

  Scenario: SCN-UNIT-LEDGER-002 runtimeにもCIにも現れないruleをorphanとして拒否する
    Given runtimeにもCIにもIDがないrule coverage入力がある
    When rule coverage matrixを構築する
    Then 未検証ruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-003 規範文書にあるがpolicy未定義のrule IDを拒否する
    Given policy未定義のrule IDを持つ規範文書がある
    When rule coverage matrixを構築する
    Then 規範だけのruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-004 CIにだけ現れる暗黙ruleを拒否する
    Given policy未定義のrule IDを持つCIがある
    When rule coverage matrixを構築する
    Then CIだけの暗黙ruleがorphanとして拒否される

  Scenario: SCN-UNIT-LEDGER-005 連番prefixと日本語名を持たない固定Markdownを拒否する
    Given 連番または日本語名を欠く固定Markdown名がある
    When 固定Markdown名を検証する
    Then すべての不正な固定Markdown名が拒否される

  Scenario: SCN-UNIT-LEDGER-006 契約上固定された名称だけを命名例外として許可する
    Given 契約上の固定名称と未知の英語Markdown名がある
    When 固定Markdown名を検証する
    Then 明示された固定名称だけが許可される

  Scenario: SCN-UNIT-LEDGER-007 rule metadataの省略と非空文字列を許可し不正値を拒否する
    Given metadataを省略したruleと有効・空文字列・非文字列のmetadataを持つruleがある
    When runtimeでrule metadataとtrusted policy比較を検証する
    Then metadata省略と有効値だけを許可しmetadata追加を意味変更として拒否しない
