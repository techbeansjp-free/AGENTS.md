@integration
Feature: 実CLI経路のrisk比例短縮検証

  Scenario: SCN-INT-WF-1334-001 実CLIがlow-risk短縮行を受理する
    Given Verification Set riskが"low"で02と03の対象節が理由付き短縮行である
    When CLIでrisk比例のIssue成果物を検証する
    Then CLIのrisk比例Issue検証は合格する

  Scenario: SCN-INT-WF-1334-002 実CLIがhigh-risk短縮行を拒否する
    Given Verification Set riskが"high"で02と03の対象節が理由付き短縮行である
    When CLIでrisk比例のIssue成果物を検証する
    Then CLIはrisk=low限定の診断で失敗する
