@unit
Feature: 一時ステージング・ライフサイクルを安全側に判定する

  Scenario: SCN-UNIT-STAGING-001 同期証拠のないstagingを年齢だけで削除しない
    Given 保持期限を超えた未同期stagingがある
    When staging cleanupをpreviewする
    Then 未同期stagingは削除候補にならず理由付きで保持される

  Scenario: SCN-UNIT-STAGING-002 absolute trackerでsync-verifiedかつ保持期限経過だけをdeletion-readyにする
    Given 同期確認済みと未同期と短縮trackerのstagingがある
    When 保持期限経過後のstagingを検査してcleanupをpreviewする
    Then absolute trackerの同期確認済みstagingだけがdeletion-readyになる

  Scenario: SCN-UNIT-STAGING-003 必要成果物が揃っていないstagingをretainedにする
    Given 必須成果物が欠けたfull stagingがある
    When staging cleanupをpreviewする
    Then 必須成果物不足のstagingは理由付きで保持される

  Scenario: SCN-UNIT-STAGING-004 記録fileを持たないlegacyは空の場合だけdeletion-readyにする
    Given 空と内容ありのlegacy stagingがある
    When staging cleanupをpreviewする
    Then 空のlegacyだけがdeletion-readyになる

  Scenario: SCN-UNIT-STAGING-005 hash不一致とstale planでは1件も削除しない
    Given cleanup可能なstagingのpreview planがある
    When hash不一致とstaging変更後のapplyを試みる
    Then staging applyはいずれもremoveを呼ばず拒否される

  Scenario: SCN-UNIT-STAGING-006 tmpの外、symlink、親参照、role-log、metricsを対象にしない
    Given staging境界を逸脱する候補がある
    When staging cleanupをpreviewする
    Then staging境界外とsymlinkと予約領域は候補にならない
