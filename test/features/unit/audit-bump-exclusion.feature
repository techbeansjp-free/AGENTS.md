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
