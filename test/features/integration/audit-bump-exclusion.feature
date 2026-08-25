@integration @audit-bump-exclusion
Feature: merge後のrelease bump監査
  実main履歴と同じmerge構造を隔離repositoryで再現してfile監査を検証する。

  Scenario: SCN-INT-AUDITBUMP-001 隔離repositoryでbump commitを挟んだH_impl..currentが合格する
    Given 正規のrelease bumpをmergeした隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査は合格する

  Scenario: SCN-INT-AUDITBUMP-002 隔離repositoryでbump以外のcommitを挟んだH_impl..currentが失敗する
    Given bump以外のpackage変更をmergeした隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査はreview artifact以外のpathを理由に失敗する
