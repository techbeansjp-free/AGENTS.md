@unit
Feature: 開発考慮事項の理由・証拠の具体性とGherkin方言のscenario検出

  Scenario: SCN-UNIT-ISSUEDC-001 全角括弧を含む自然文の理由と証拠を受理する
    Given 理由が「CLIはGUIを持たない（JSON出力のみ）ため対象外」である開発考慮事項がある
    When 開発考慮事項を検証する
    Then 開発考慮事項の検証は合格する

  Scenario: SCN-UNIT-ISSUEDC-002 template由来のplaceholderを文中に残した理由を拒否する
    Given 理由が「対象外である。（範囲を限定した理由）」である開発考慮事項がある
    When 開発考慮事項を検証する
    Then DC-PRIVACYの理由が具体化されていないerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-003 review JSON経路でも同じplaceholderを拒否する
    Given developmentConsiderationsの証拠に「（脅威、個人情報・秘密、保持・削除、SCN）」を残したreview JSONがある
    When reviewを評価する
    Then reviewはDC-PRIVACYの証拠が具体化されていないerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-008 review JSON経路で波括弧の未記入を残した理由を拒否する
    Given developmentConsiderationsの理由に「対象外である。{理由を書く}」を含むreview JSONがある
    When reviewを評価する
    Then reviewはDC-PRIVACYの理由が具体化されていないerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-004 01の参照行だけで合格する
    Given 01の開発考慮事項欄が参照行1行だけのfull stagingがある
    When 方言を指定せずIssueを検証する
    Then 参照行つきのIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEDC-005 参照行と差分行は差分行だけを検証する
    Given 01が参照行とplaceholderを残したDC-PRIVACYの1行を持つfull stagingがある
    When 方言を指定せずIssueを検証する
    Then DC-PRIVACYの理由が具体化されていないerrorだけで拒否する

  Scenario: SCN-UNIT-ISSUEDC-006 00の参照行を拒否する
    Given 00の開発考慮事項欄が参照行だけのfull stagingがある
    When 方言を指定せずIssueを検証する
    Then 00_要求定義.mdは参照行を使用できないerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-007 参照行なしの欠落は引き続き拒否する
    Given 01の開発考慮事項欄が空のfull stagingがある
    When 方言を指定せずIssueを検証する
    Then DC-PRIVACYが重複なく1件必要なerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-009 参照行と未知IDの差分行は未知IDを拒否する
    Given 01が参照行と未知ID DC-UNKNOWNの1行を持つfull stagingがある
    When 方言を指定せずIssueを検証する
    Then DC-UNKNOWNは未知の開発契約IDのerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-010 code fence内の参照行は宣言として扱わない
    Given 01がcode fenceの中にだけ参照行を持つfull stagingがある
    When 方言を指定せずIssueを検証する
    Then DC-PRIVACYが重複なく1件必要なerrorで拒否する

  Scenario: SCN-UNIT-ISSUEDC-011 info string付きの内側fenceは外側fenceを閉じない
    Given 01がmarkdown fenceの中にtext fenceと参照行を持つfull stagingがある
    When 方言を指定せずIssueを検証する
    Then DC-PRIVACYが重複なく1件必要なerrorで拒否する

  Scenario: SCN-UNIT-ISSUEGHK-001 ja宣言時にシナリオkeywordでIDを検出する
    Given 受け入れ例を「シナリオ: SCN-X-001」で書いたquick stagingがある
    When 方言jaでIssueを検証する
    Then GherkinシナリオIDがありませんのerrorを含まない

  Scenario: SCN-UNIT-ISSUEGHK-002 en宣言時はシナリオkeywordだけでは検出しない
    Given 受け入れ例を「シナリオ: SCN-X-001」で書いたquick stagingがある
    When 方言enでIssueを検証する
    Then GherkinシナリオIDがありませんのerrorを含む

  Scenario: SCN-UNIT-ISSUEGHK-006 en宣言時にScenario OutlineのID行を検出する
    Given 受け入れ例を「Scenario Outline: SCN-X-003」で書いたquick stagingがある
    When 方言enでIssueを検証する
    Then GherkinシナリオIDがありませんのerrorを含まない

  Scenario: SCN-UNIT-ISSUEGHK-003 未知の方言を拒否する
    Given 受け入れ例を「Scenario: SCN-X-001」で書いたquick stagingがある
    When 方言xxでIssueを検証する
    Then gherkinDialectが未対応のerrorで拒否する

  Scenario: SCN-UNIT-ISSUEGHK-004 ja Outlineのparameterはplaceholderとしない
    Given 「シナリオテンプレート:」と「<値>」を持つquick stagingがある
    When 方言jaでIssueを検証する
    Then ja Outlineのplaceholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEGHK-007 ja step keywordのparameterはplaceholderとしない
    Given 「シナリオテンプレート:」と「前提 <値>」を持つquick stagingがある
    When 方言jaでIssueを検証する
    Then ja Outlineのplaceholder errorなしでIssue検証は合格する

  Scenario: SCN-UNIT-ISSUEGHK-008 散文中のシナリオkeywordはIDとして検出しない
    Given 受け入れ例を「説明文に シナリオ: SCN-X-999」で書いたquick stagingがある
    When 方言jaでIssueを検証する
    Then GherkinシナリオIDがありませんのerrorを含む

  Scenario: SCN-UNIT-ISSUEGHK-005 CLIはproject choiceの方言を注入する
    Given gherkinDialectがjaのproject choiceを4階層上に持つquick stagingがある
    When CLIでIssueを検証する
    Then GherkinシナリオIDがありませんのerrorを含まない
