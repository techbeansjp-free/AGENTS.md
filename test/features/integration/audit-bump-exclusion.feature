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

  Scenario: SCN-INT-AUDITBUMP-003 既定branch追随でrelease bump PRのmergeを取り込んだH_impl..currentが合格する
    Given 既定branch追随の後にrelease bump PRのmergeだけを取り込んだ隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査は合格する

  Scenario: SCN-INT-AUDITBUMP-004 取り込んだmergeの別親側にbump以外のcommitがあれば除外しない
    Given 既定branch追随で取り込んだmergeの別親側にbump以外のcommitがある隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査はreview artifact以外のpathを理由に失敗する
