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

  Scenario: SCN-INT-STEPCHAIN-004 理由を伴わない迂回の申告を拒否する
    Given Step chainを理由なしで迂回と申告したreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はStep chain申告の欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-005 経由の申告を記録として受理する
    Given Step chainを"経由: .agent-skill-chain/tmp/issues/986"と申告したreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-STEPCHAIN-006 短い理由の迂回申告を受理する
    Given Step chainを"迂回: CI障害"と申告したreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する



  Scenario: SCN-INT-STEPCHAIN-007 注記付きのラウンド数から先頭の整数を読む
    Given ラウンド数が"3（うち1ラウンドは自動review）"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-STEPCHAIN-008 先頭が整数でないラウンド数を記録の欠落として扱う
    Given ラウンド数が"（自動review込み）2"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はラウンド数の欠落を報告する

  Scenario: SCN-INT-STEPCHAIN-009 識別情報の節の外にある申告行を数えない
    Given 申告行を本文とcode fenceだけに置いたreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査はラウンド数の欠落を報告する
    And file監査はStep chain申告の欠落を報告する

  Scenario Outline: SCN-INT-SPEEDOBS-001 観測基準の欄が無いartifactを拒否する
    Given "<label>"の欄が無いreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は"<label>"の欠落を報告する

    Examples:
      | label |
      | 仕様の所有箇所 |
      | 成果物行数 |
      | 縮小の先行評価 |

  Scenario: SCN-INT-SPEEDOBS-002 空欄の観測基準を未記入として扱う
    Given "縮小の先行評価"が空欄のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は"縮小の先行評価"の欠落を報告する

  Scenario: SCN-INT-SPEEDOBS-003 該当なしの仕様所有箇所に起票先を要求する
    Given 仕様の所有箇所が"該当なし"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は仕様側の起票先の欠落を報告する

  Scenario: SCN-INT-SPEEDOBS-004 該当なしでも起票先があれば受理する
    Given 仕様の所有箇所が"該当なし: #1234"のreview artifactを持つ統合監査repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格する

  Scenario: SCN-INT-SPEEDOBS-005 支援層が成果物を上回る記録でも停止しない
    Given 成果物行数が"製品 8行 / 支援層 172行"のreview artifactを持つ統合監査repository
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
