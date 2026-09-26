@integration
Feature: 計画文書を版管理下の1箇所に置きIssue本文をpointerにする

  Scenario: SCN-INT-TRACKPTR-001 版管理下stagingの作成からpointer本文の同期まで通す
    Given 版管理下のdocs issuesへpointer本文で同期するproject policyを持つrepositoryがある
    When CLIでfullのissue createを実行する
    Then stagingはdocs issues直下に作られ旧配置の通知を出さない
    And stagingの文書は版管理対象で機械記録は除外される
    When 成果物を記入してStep 8の同期本文を生成しIssueへ同期する
    Then Issue本文は成果物の配置とdigestを示すpointer形である
    And staging記録は同期確認済みになる
    When issue startで版管理下のstagingを指定する
    Then stagingの配置は受理され次の既定branch解決へ進む

  Scenario: SCN-INT-TRACKPTR-002 既定配置のissue createは作成を妨げずに1行の通知を出す
    Given staging節を持たないproject policyのrepositoryがある
    When CLIで既定配置のissue createを実行する
    Then stagingは既定の一時領域に作られ1行の通知をstderrへ出す
