@integration @audit-artifact-selection
Feature: fixture repositoryでのreview証跡差分選択
  branchとmergeを含むGit履歴からreview証跡をfile名の大小に依存せず選ぶ。

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

  Scenario: SCN-INT-STEPCHAIN-001 上限を超えたreviewラウンドを拒否する
    Given ラウンド数が"9"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はラウンド上限超過を報告する

  Scenario: SCN-INT-STEPCHAIN-010 取り直しを含む8ラウンドを受理する
    Given ラウンド数が"8"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-AUDITSEL-005 第1親が既定branch tipのmerge commitから比較基点を導出して合格する
    Given 第1親が既定branch tipのmerge commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-AUDITSEL-006 浅いcloneでfork点を観測できないときを判定不能として拒否する
    Given fork点を取得範囲の外に置いた浅いcloneの監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は比較基点の導出不能を報告する

  Scenario: SCN-INT-REVEVID-006 file名が<Issue番号>_review.jsonでない証跡を拒否する
    Given Markdownのreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はfile名書式の不一致を報告する

  Scenario: SCN-INT-REVEVID-007 file名のIssue番号と証跡のissueの不一致を拒否する
    Given file名のIssue番号とissueが一致しないreview証跡を持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はIssue番号の不一致を報告する

  Scenario: SCN-INT-REVEVID-008 手で書き直した証跡を拒否する
    Given 手で書き直したreview証跡を持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は正規直列化の不一致を報告する
