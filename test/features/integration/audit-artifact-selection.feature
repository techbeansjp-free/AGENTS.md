@integration @audit-artifact-selection
Feature: fixture repositoryでのreview artifact差分選択
  branchとmergeを含むGit履歴からreview artifactをfile名の大小に依存せず選ぶ。

  Scenario: SCN-INT-AUDITSEL-001 fixture repositoryでaudit checkが差分から成果物を選ぶ
    Given review artifactを最終commitにした統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 差分内のreview artifactが選ばれてfile監査は合格する

  Scenario: SCN-INT-AUDITSEL-002 同じ番号のreview artifactを持つ2 branchを両方mergeしても検査が通る
    Given 同じ番号のreview artifactを持つ2 branchを両方mergeしたrepository
    When 各branchのmerge後にfile監査を実行する
    Then 両方のmerge後に対応するreview artifactが選ばれて合格する

  Scenario: SCN-INT-AUDITSEL-003 差分2件の診断に余分なpathが含まれる
    Given review artifactと余分なpathをcommitした統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 統合監査の複数差分診断に余分なpathが含まれる

  Scenario: SCN-INT-AUDITSEL-004 既存41件のreview artifactを持つrepositoryで従来どおり動作する
    Given 既存41件のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 41件目のreview artifactが選ばれてfile監査は合格する
