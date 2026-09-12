@unit
Feature: 成果物1単位の構造warning

  Scenario: SCN-UNIT-ARTUNIT-001 異なるkindの成果物markerを警告する
    Given 対象内にfeatureとcontractの成果物markerがある
    When 成果物単位warningを検出する
    Then codeとcount 2とkindを持つwarningを1件返す

  Scenario: SCN-UNIT-ARTUNIT-002 同じkindの成果物markerを2単位として警告する
    Given 対象内にadrの成果物markerが2件ある
    When 成果物単位warningを検出する
    Then count 2とadrだけを持つwarningを1件返す

  Scenario: SCN-UNIT-ARTUNIT-003 markerが無ければ警告しない
    Given 対象内に通常の箇条書きだけがある
    When 成果物単位warningを検出する
    Then 成果物単位warningは空である

  Scenario: SCN-UNIT-ARTUNIT-004 markerが1件なら警告しない
    Given 対象内にfeatureの成果物markerが1件ある
    When 成果物単位warningを検出する
    Then 成果物単位warningは空である

  Scenario: SCN-UNIT-ARTUNIT-005 malformedと入れ子markerを数えない
    Given 対象内にmalformedと入れ子の成果物markerだけがある
    When 成果物単位warningを検出する
    Then 成果物単位warningは空である

  Scenario: SCN-UNIT-ARTUNIT-006 他sectionのmarkerを数えない
    Given 対象外sectionに成果物markerが2件ある
    When 成果物単位warningを検出する
    Then 成果物単位warningは空である

  Scenario: SCN-UNIT-ARTUNIT-007 code fence内のmarkerを数えない
    Given 対象内のcode fenceに成果物markerが2件ある
    When 成果物単位warningを検出する
    Then 成果物単位warningは空である

  Scenario: SCN-UNIT-ARTUNIT-010 workflowとtemplateとhelpがmarker契約を案内する
    Given 配布する成果物単位marker契約がある
    When workflowと3 templateとCLI helpを読む
    Then 全文書が成果物1単位と45分とmarkerの非停止性を案内する

  Scenario: SCN-UNIT-ARTUNIT-011 inline codeを説明に含むmarkerを警告する
    Given 対象内にinline code説明を持つ成果物markerが2件ある
    When 成果物単位warningを検出する
    Then codeとcount 2とkindを持つwarningを1件返す
