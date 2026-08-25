@unit
Feature: Issue templateと段階別検証の契約

  Scenario: SCN-UNIT-ISSUETPL-001 full templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When full modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-002 quick templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When quick modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-003 poc templateの全必須見出しが検証器の要求と一致する
    Given 出荷Issue templateと検証器の見出し契約がある
    When poc modeの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUETPL-004 検証器の必須見出しをテンプレートから削ると検査が失敗する
    Given 必須見出しを削除したquick templateがある
    When 変更したIssue templateの見出し契約を検査する
    Then quickの不足見出しを示して検査が失敗する

  Scenario: SCN-UNIT-ISSUETPL-005 テンプレートの任意見出しは検査を失敗させない
    Given 任意見出し0. 管理情報を持つquick templateがある
    When 変更したIssue templateの見出し契約を検査する
    Then modeの見出し契約は合格する

  Scenario: SCN-UNIT-ISSUESTG-001 requirements段階は00と01だけを要求する
    Given 00と01だけが記入済みで02と03が未記入のfull Issueがある
    When requirements段階でIssueを検証する
    Then Issue検証は合格する

  Scenario: SCN-UNIT-ISSUESTG-002 design段階は00から03を要求する
    Given 00と01だけを持つvalidなfull Issueがある
    When design段階でIssueを検証する
    Then 02と03の不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUESTG-003 stage未指定は従来どおり全件を要求する
    Given 00と01だけを持つvalidなfull Issueがある
    When stageを指定せずIssueを検証する
    Then 02と03の不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUESTG-004 quickはstageの有無で挙動が変わらない
    Given validなquick Issueがある
    When quick Issueを全stage指定と未指定で検証する
    Then quick Issueの検証結果はすべて同じである

  Scenario: SCN-UNIT-ISSUESTG-005 requirements段階でもGherkin scenario IDを要求する
    Given Gherkin scenario IDがない00と01のfull Issueがある
    When requirements段階でIssueを検証する
    Then Gherkin scenario ID不足を示してIssue検証が失敗する

  Scenario: SCN-UNIT-ISSUEPLC-001 code span内の型引数はplaceholderとしない
    Given validなquick Issueの本文にcode spanの型引数がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-002 code block内のobject literalはplaceholderとしない
    Given validなquick Issueの本文にcode blockのobject literalがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-003 説明文の変更しない条件はplaceholderとしない
    Given validなquick Issueの本文に説明文の変更しない条件がある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-004 Scenario Outlineのparameterはplaceholderとしない
    Given validなquick Issueの本文にScenario Outlineのparameterがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEPLC-005 テンプレート由来の実placeholderは引き続き検出する
    Given validなquick Issueの本文にテンプレート由来のplaceholderがある
    When quick Issueのplaceholderを検証する
    Then placeholder errorを示してIssue検証が失敗する
