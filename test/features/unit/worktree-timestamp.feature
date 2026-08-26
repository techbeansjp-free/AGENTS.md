@unit
Feature: worktree directory名のtimestampを作成時刻へ拘束する

  Scenario: SCN-UNIT-WTTS-001 未来のtimestampを持つpathを拒否する
    Given 基準時刻より未来のtimestampを持つworktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then 未来のtimestampとして拒否される

  Scenario: SCN-UNIT-WTTS-002 現在時刻から著しく離れた過去のtimestampを拒否する
    Given 基準時刻から許容範囲を超えて古いtimestampを持つworktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then 古すぎるtimestampとして拒否される

  Scenario: SCN-UNIT-WTTS-003 許容範囲内のtimestampを受理する
    Given 基準時刻から許容範囲内のtimestampを持つworktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then timestamp付きworktree配置は有効である

  Scenario: SCN-UNIT-WTTS-004 拒否理由が日本語で許容範囲を示す
    Given 基準時刻から許容範囲を超えて古いtimestampを持つworktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then 拒否理由は日本語で10分以内を示す

  Scenario: SCN-UNIT-WTTS-005 timestampの書式違反を従来どおり拒否する
    Given timestampの書式に違反するworktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then directory名の規定書式違反として拒否される

  Scenario: SCN-UNIT-WTTS-006 domainが現在時刻を取得しない
    Given 呼び出し側の基準時刻だけで判定するworktree配置がある
    When 渡した時刻と未指定の時刻で純粋検証する
    Then 渡した時刻だけを使い未指定は拒否される

  Scenario: SCN-UNIT-WTTS-007 path省略時にIssue番号とslugと現在時刻からpathを構成する
    Given path構成用のIssue番号とslugと基準時刻がある
    When worktree pathを純粋に構成する
    Then local timeのtimestampを持つ規定pathになる

  Scenario: SCN-UNIT-WTTS-008 構成したpathがIssue番号とslugの検証を満たす
    Given path構成用のIssue番号とslugと基準時刻がある
    When 構成したworktree pathを純粋検証する
    Then 構成したpathのIssue番号とslugは有効である

  Scenario: SCN-UNIT-WTTS-009 Git内部pathかつtimestamp書式違反ではGit内部違反を優先する
    Given trusted policyを持つworktree作成用の隔離repositoryがある
    When Git内部のtimestamp書式違反pathでworktree create CLIを実行する
    Then timestamp書式違反よりGit内部違反が報告される

  Scenario: SCN-UNIT-WTTS-010 repository外pathかつtimestamp書式違反では脱出違反を優先する
    Given repository外のtimestamp書式違反worktree配置がある
    When timestamp付きworktree配置を純粋検証する
    Then timestamp書式違反よりrepository外への脱出違反が先に報告される
