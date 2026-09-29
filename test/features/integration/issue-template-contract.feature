@integration
Feature: 出荷Issue templateとCLI・品質gateの統合契約

  Scenario: SCN-INT-ISSUECOMMENT-001 validation後の出荷markerをreview初期化のinventoryへbindingする
    Given 出荷03のprogress markerを保持した記入済みfull Issueがある
    When CLIでstageを指定せずIssueを検証する
    Then CLIのIssue検証は合格する
    When 検証済みIssueのreview round初期化draftを生成する
    Then 初回review previewは同じ03のprogress inventoryを受理する

  Scenario: SCN-INT-ISSUETPL-001 出荷full templateを埋めた文書がIssue検証を通る
    Given 出荷full templateを埋めたIssueがある
    When CLIでstageを指定せずIssueを検証する
    Then CLIのIssue検証は合格する

  Scenario: SCN-INT-ISSUETPL-002 出荷quick templateを埋めた文書がIssue検証を通る
    Given 出荷quick templateを埋めたIssueがある
    When CLIでstageを指定せずIssueを検証する
    Then CLIのIssue検証は合格する

  Scenario: SCN-INT-ISSUETPL-003 step-04相当の00と01でrequirements段階が通る
    Given 00と01だけを持つ出荷full templateのIssueがある
    When CLIでrequirements段階のIssueを検証する
    Then CLIのIssue検証は合格する

  Scenario: SCN-INT-ISSUETPL-004 template見出しを改変するとskills checkが失敗する
    Given full templateの必須見出しを改変したpackage資産がある
    When package資産のskills checkを実行する
    Then fullの不足見出しを示してskills checkが失敗する

  Scenario: SCN-INT-ISSUETPL-005 出荷Issue templateの配置非依存参照は生成対象template検査に合格する
    Given 出荷Issue templateと検証器の見出し契約がある
    When package資産のskills checkを実行する
    Then skills checkは合格する

  Scenario: SCN-INT-ISSUETPL-006 既定staging配置でも配置非依存参照が解決できる
    Given ASC docsを展開した一時repositoryがある
    When 既定staging配置でfull issueを作成する
    Then 生成された00から03の配置非依存参照はfixture rootから解決できる

  Scenario: SCN-INT-ISSUETPL-007 wildcard custom staging-rootでも配置非依存参照が解決できる
    Given ASC docsを展開しwildcardのcustom staging-rootを宣言した一時repositoryがある
    When wildcard custom staging-rootでfull issueを作成する
    Then 生成された00から03の配置非依存参照はfixture rootから解決できる

  Scenario: SCN-INT-ISSUETPL-008 深いtracked staging-rootでも配置非依存参照が解決できる（#1516再現相当）
    Given ASC docsを展開し深いtracked staging-rootを宣言した一時repositoryがある
    When 深いtracked staging-rootでfull issueを作成する
    Then 生成された00から03の配置非依存参照はfixture rootから解決できる

  Scenario: SCN-INT-ISSUETPL-009 code fence内の旧形式link例・外部URL・anchor・画像・意図的な非link文字列は生成対象template検査を誤って失敗させない
    Given 旧形式linkの説明例をcode fence内に持ち外部URL・anchor・画像・directory参照も含むtemplateを持つpackage資産がある
    When package資産のskills checkを実行する
    Then skills checkは合格する
