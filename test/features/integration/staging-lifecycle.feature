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

