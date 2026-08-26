@integration
Feature: 実repositoryでSCN配置検査が一時ステージングと共存する

  Scenario: SCN-INT-SCNSCOPE-001 stagingを持つrepository構造で配置違反が出ない
    Given 仕様一式とIssue一時ステージングを持つrepository fixtureがある
    When fixtureのtrace gateを実行する
    Then trace gateはSCN配置違反を報告しない

  Scenario: SCN-INT-SCNSCOPE-002 除外領域のpathを実装が重複定義しない
    Given SCN配置検査の実装がある
    When 除外領域pathの定義箇所を数える
    Then 定義は正本1箇所だけであり検査は参照する

  Scenario: SCN-INT-SCNSCOPE-003 除外はSCN配置検査だけに効き他検査の観測対象を変えない
    Given 除外領域に要件本文とSCN定義を併記したfixtureがある
    When SCN配置検査を実行する
    Then SCN配置違反は出ないが要件本文の診断は従来どおり出る

  Scenario: SCN-INT-SCNSCOPE-004 配布物へ新exportが現れ既存exportが減らない
    Given 配布buildのstaging moduleがある
    When 公開exportの一覧を取得する
    Then 一覧はisIssueStagingPathを含み既存exportを1件も失っていない
