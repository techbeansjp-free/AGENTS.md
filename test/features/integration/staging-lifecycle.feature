@integration
Feature: 一時ステージングのpreviewと適用を分離する

  Scenario: SCN-INT-STAGING-001 隔離ディレクトリでpreviewとapplyを分離して実行する
    Given cleanup可能なstagingを持つ隔離repositoryがある
    When stagingをpreviewして同じhashでapplyする
    Then previewでは残りapply後に対象だけが削除される

  Scenario: SCN-INT-STAGING-002 削除中の失敗を部分失敗として報告し成功と誤報しない
    Given cleanup可能なstagingが2件ある
    When 2件目のstaging削除で失敗させる
    Then staging cleanupは部分失敗と未処理対象と復旧方法を返す

  Scenario: SCN-INT-STAGING-003 同期記録の書き込み後読み取り確認が成功した場合だけsync-verifiedになる
    Given 未同期のquick stagingがある
    When 不一致と一致の読み取りdigestで同期記録を順に試みる
    Then 一致した同期記録だけがsync-verifiedになる

  Scenario: SCN-INT-STAGING-004 promotion-activeの再同期先を別Issueに変更しない
    Given promotion-activeの元Issue同期stagingがある
    When 別Issueへの再同期を適用する
    Then 外部副作用前と直接記録の両方で拒否される

  Scenario: SCN-INT-STAGING-005 promotion-activeは元Issueにだけ再同期できる
    Given promotion-activeの元Issue同期stagingがある
    When 元Issueへの再同期を適用する
    Then 元Issueだけが同期されsync-verifiedになる

  Scenario: SCN-INT-STAGING-006 promotion-activeのfull Step 4は元Issueだけを更新して同期記録を変えない
    Given promotion-activeの元Issue同期stagingがある
    When full補完中のStep 4を元Issueへ同期する
    Then 元Issueだけを更新しstaging記録はpromotion-activeを維持する

  Scenario: SCN-INT-STAGING-007 短縮Issue番号を将来再同期不能なtrackerとして保存しない
    Given 未同期のquick stagingがある
    When 短縮Issue番号で同期記録を試みる
    Then absolute GitHub Issue URLでないtrackerは拒否される

  Scenario: SCN-INT-STAGING-008 保存済みlegacy trackerを認可済みwrite時だけabsolute URLへ移行する
    Given absolute trackerで同期済みのquick stagingがある
    When 保存済みlegacy trackerを認可済みwriteとして移行する
    Then read-only解決は変更せずlegacy trackerはabsolute URLへ移行される

  Scenario: SCN-INT-STAGING-009 legacy trackerのread-only対象解決は誤ったrepositoryでも永続状態を変更しない
    Given absolute trackerで同期済みのquick stagingがある
    When 保存済みlegacy trackerを誤ったrepositoryでread-only解決する
    Then staging recordはbyte単位で変更されない
