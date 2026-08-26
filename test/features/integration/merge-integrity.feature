@integration @merge-integrity
Feature: 既定branch追随とH_impl不変条件の両立
  既定branch追随をreview artifact commitより前へ置いた形が監査に合格し、
  追随時の衝突解消で損失検知tokenが失われた場合は監査が失敗する。

  Scenario: SCN-INT-MERGEINT-001 追随後にreview artifactを置き直した監査が合格する
    Given 実装後に既定branchを取り込み最後にreview artifactを置いた隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then 追随を含むfile監査は合格する

  Scenario: SCN-INT-MERGEINT-002 追随mergeが既定branch側のtokenを落とすと失敗する
    Given 追随mergeで既定branch側のtokenを落とした隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は損失検知tokenの消失を理由に失敗する

  Scenario: SCN-INT-MERGEINT-003 別fileに同じtokenが残っていても失敗する
    Given 同じtokenを2 fileへ持ち片方だけを落とした追随mergeの隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は損失検知tokenの消失を理由に失敗する

  Scenario: SCN-INT-MERGEINT-004 第2親だけが追加しmergeで消えたpathを検出する
    Given 既定branchだけが追加したfileを追随mergeで削除した隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は損失検知tokenの消失を理由に失敗する

  Scenario: SCN-INT-MERGEINT-005 親が3個のmergeを判定不能として拒否する
    Given 監査範囲に親が3個のmergeを含む隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は判定不能を理由に失敗し、安全な次操作を示す

  Scenario: SCN-INT-MERGEINT-006 merge-baseが一意でないmergeを判定不能として拒否する
    Given 監査範囲にmerge-baseが2個のmergeを含む隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は判定不能を理由に失敗し、安全な次操作を示す

  Scenario: SCN-INT-MERGEINT-007 release bump除外条件を満たすmergeも観測対象にする
    Given release bump除外条件をすべて満たす追随mergeの隔離repository
    When 監査範囲のmerge観測を集める
    Then 観測は1件で、pathが検査対象になっている

  Scenario: SCN-INT-MERGEINT-008 監査範囲にmergeが無い従来形は従来どおり合格する
    Given 追随mergeを持たない従来形の隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then 追随を含むfile監査は合格する

  Scenario: SCN-INT-MERGEINT-009 追随後に整理commitを置いた形が合格する
    Given 追随mergeの後に整理commitを置きH_implを整理commitとした隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then 追随を含むfile監査は合格する

  Scenario: SCN-INT-MERGEINT-010 公開戻り値のkey集合を変えない
    Given 実装後に既定branchを取り込み最後にreview artifactを置いた隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査の戻り値のkey集合が従来と一致する

  Scenario: SCN-INT-MERGEINT-011 renameと同時にtokenを落としたmergeを検出する
    Given 追随mergeがfileをrenameしつつtokenを落とした隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then file監査は損失検知tokenの消失を理由に失敗する

  Scenario: SCN-INT-MERGEINT-012 既定branchのrenameを保持したmergeは合格する
    Given 既定branchのrenameを保持した追随mergeの隔離repository
    When 追随を含む隔離repositoryのfile監査を実行する
    Then 追随を含むfile監査は合格する
