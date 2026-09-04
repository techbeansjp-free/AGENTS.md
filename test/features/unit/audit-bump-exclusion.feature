@unit @audit-bump-exclusion
Feature: release bump commitの監査対象除外
  機械生成されたversion bumpだけを監査対象から除外し、反例は通常変更として扱う。

  Scenario: SCN-UNIT-AUDITBUMP-001 release bump commitの変更を監査対象から除外する
    Given 監査artifact後に正規のrelease bump commitがある隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査は合格する

  Scenario: SCN-UNIT-AUDITBUMP-002 commit messageだけ一致し変更fileが異なるcommitを除外しない
    Given release bump形式のmessageで対象外fileも変更した隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査はreview artifact以外のpathを理由に失敗する

  Scenario: SCN-UNIT-AUDITBUMP-003 package.jsonのversion以外を変えるcommitを除外しない
    Given release bump形式のmessageでpackage metadataも変更した隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査はreview artifact以外のpathを理由に失敗する

  Scenario: SCN-UNIT-AUDITBUMP-004 bump以外のpackage.json変更は従来どおり監査表との一致を要求する
    Given release bump以外のmessageでpackage.jsonを変更した隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査はreview artifact以外のpathを理由に失敗する

  Scenario: SCN-UNIT-AUDITBUMP-005 cutoffより後のrelease bump形式commitは除外しない
    Given 監査artifact後に正規のrelease bump commitがある隔離repository
    When cutoffをbump commitの直前に置いてfile監査を実行する
    Then file監査はbump commitを境界に含めたことを理由に失敗する

  Scenario: SCN-UNIT-AUDITBUMP-006 cutoffを解決できない履歴では監査を停止する
    Given 監査artifact後に正規のrelease bump commitがある隔離repository
    When 履歴に存在しないcutoffでfile監査を実行する
    Then file監査はcutoffを解決できないことを理由に停止する

  Scenario: SCN-UNIT-AUDITBUMP-007 bumpを含まない履歴でもcutoff解決不能なら停止する
    Given release bump commitを持たない隔離repository
    When 履歴に存在しないcutoffでfile監査を実行する
    Then file監査はcutoffを解決できないことを理由に停止する

  Scenario: SCN-UNIT-AUDITBUMP-008 版管理下の生成物distを個別監査の対象から外す
    Given 生成物distを実装commitへ含む隔離repository
    When 隔離repositoryのfile監査を実行する
    Then file監査は合格する
