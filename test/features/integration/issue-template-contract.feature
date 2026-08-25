@integration
Feature: 出荷Issue templateとCLI・品質gateの統合契約

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
