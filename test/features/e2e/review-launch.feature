@e2e @review-launch @routing-1425
Feature: CLIからreviewer routingを解決し既存commandと共存する

  Scenario: SCN-E2E-REVIEW-1425-008 CLIはローカルLLM未設定を非0で拒否する
    Given build済みCLIでreviewerがローカルLLM未設定のprojectがある
    When CLIでrouting review-resolveを実行する
    Then CLIは非0かつrejected状態のJSONを返す

  Scenario: SCN-E2E-REVIEW-1425-009 既存のrouting resolveコマンドは変わらず利用できる
    Given build済みCLIでreviewerがローカルLLM未設定のprojectがある
    When CLIで既存のrouting resolveを実行する
    Then 既存のroutingコマンドは変わらず利用できる

  Scenario: SCN-E2E-REVIEW-1425-010 review-resolveはprovider capability mapping未設定でも解決できる
    Given build済みCLIでprovider capability mapping未設定・reviewerがollama構成済みのprojectがある
    When CLIでrouting review-resolveを実行する
    Then CLIは0かつresolved状態のJSONを返す
