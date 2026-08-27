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

  Scenario: SCN-INT-STEPCHAIN-001 上限を超えたreviewラウンドを拒否する
    Given ラウンド数が"4"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はラウンド上限超過を報告する

  Scenario: SCN-INT-STEPCHAIN-002 ラウンド数の記録が無いartifactを拒否する
    Given ラウンド数欄が無いreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はラウンド数の欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-003 Step chainの申告が無いartifactを拒否する
    Given Step chain欄が無いreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はStep chain申告の欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-004 迂回の申告に理由が無い場合を拒否する
    Given Step chainを理由なしで迂回と申告したreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は迂回理由の欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-005 経由の申告にjournalが無い場合を拒否する
    Given Step chainを経由と申告しjournalが無いreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はjournalの欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-006 経由の申告と整合するjournalを受理する
    Given Step chainを経由と申告し整合するjournalを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-STEPCHAIN-007 注記付きのラウンド数から先頭の整数を読む
    Given ラウンド数が"3（うち1ラウンドは自動review）"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-STEPCHAIN-008 経由の申告で必須Stepが欠けたjournalを拒否する
    Given Step chainを経由と申告し必須Stepが欠けたjournalを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はStep journalの不整合を報告する
