@integration @review-artifact-validation
Feature: review validateのMarkdown入力境界
  コマンドは従来の検証を維持しつつ、リポジトリ内の成果物を安全に読み取る。

  Scenario: SCN-INT-REVARTVAL-001 JSON互換性を維持してroot外pathを拒否する
    Given JSON review evidenceと正しいMarkdown artifactを持つrepositoryがある
    When JSONと安全でないMarkdown pathにreview validateを実行する
    Then JSONは従来結果を返し安全でないartifact pathを拒否する

  @issue-1436
  Scenario: SCN-1436-01 terminal事前検証は構造だけ通る不正なapprovalを拒否する
    Given 構造は正しいがapproval記録が不正なterminal artifactがある
    When 既定とterminalのreview validateを実行する
    Then 既定は構造validでterminalはapproval不備を報告する
