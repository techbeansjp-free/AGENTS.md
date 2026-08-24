@integration
Feature: 隔離repositoryのworkspace衛生を安全に適用する

  Scenario: SCN-INT-HYGIENE-001 隔離repositoryで空directoryと一時生成物だけを削除する
    Given 削除対象と保持対象を分離した隔離repositoryがある
    When 全workspace hygiene operationをpreview reportからapplyする
    Then 空directoryと一時生成物だけが削除される
    And 内容のあるmemoと他project資産とnode_modulesは保持される

  Scenario: SCN-INT-HYGIENE-002 削除中の失敗を部分失敗として報告し成功と誤報しない
    Given permission failureを含む複数の空directory候補がある
    When 実際の非再帰削除をapplyする
    Then 部分失敗として未処理対象と復旧方法が報告される
    And apply成功結果は返らない

  Scenario: SCN-INT-HYGIENE-003 登録済みworktreeと未登録の空containerを区別する
    Given 登録済みworktreeと未登録の空containerを持つ隔離repositoryがある
    When workspace hygieneをpreviewする
    Then 未登録の空containerだけがworktree container候補になる
    And 登録済みworktreeはGit公式command専用として保持される

  Scenario: SCN-INT-HYGIENE-004 削除後もGit HEAD・refs・status・worktree listが期待どおりである
    Given Git不変条件を記録したworkspace hygiene候補がある
    When 全workspace hygiene operationをpreview reportからapplyする
    Then Git HEADとrefsとworktree listは不変である
    And Git statusは未追跡一時生成物の削除だけを反映する
