@integration @review-artifact-validation
Feature: review validateのMarkdown入力境界
  コマンドは従来の検証を維持しつつ、リポジトリ内の成果物を安全に読み取る。

  Scenario: SCN-INT-REVARTVAL-001 JSON互換性を維持してroot外pathを拒否する
    Given JSON review evidenceと正しいMarkdown artifactを持つrepositoryがある
    When JSONと安全でないMarkdown pathにreview validateを実行する
    Then JSONは従来結果を返し安全でないartifact pathを拒否する
