@unit @audit-artifact-selection
Feature: review artifactの差分選択
  file名の連番ではなくreview headの差分からreview artifactを一意に選ぶ。

  Scenario: SCN-UNIT-AUDITSEL-001 H_implからreview headまでの差分1件をreview artifactとして選ぶ
    Given 差分がreview artifact 1件だけの監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 差分内のreview artifactが選ばれてfile監査は合格する

  Scenario: SCN-UNIT-AUDITSEL-002 番号が小さい成果物でも正しく選ばれる
    Given 40番の既存成果物より後に05番の成果物を追加した監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 05番のreview artifactが選ばれてfile監査は合格する

  Scenario: SCN-UNIT-AUDITSEL-003 差分0件をerrorとする
    Given review headの差分が0件の監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then review artifact commitの追加方法を示して失敗する

  Scenario: SCN-UNIT-AUDITSEL-004 差分2件以上をerrorとし余分なpathを全件列挙する
    Given review artifactと2件の余分なpathを同時にcommitした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 複数差分の診断に全pathが列挙される

  Scenario: SCN-UNIT-AUDITSEL-005 差分の1件がdocs reviews配下でないときerrorとする
    Given 差分1件がdocs reviews配下でない監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then docs reviews配下でないpathと修正方法を示して失敗する

  Scenario: SCN-UNIT-AUDITSEL-006 release bump commitを除外したうえで差分1件と判定する
    Given review artifact後に正規のrelease bumpがある監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then release bumpを除外してreview artifact 1件が選ばれる

  Scenario: SCN-UNIT-AUDITSEL-007 artifact本文のH_implと実際のcommit構造が一致しないときerrorとする
    Given artifact本文のH_implがreview headの親と異なる監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then H_implとcommit構造の不一致を示して失敗する

  Scenario: SCN-UNIT-AUDITSEL-008 辞書順で9番が10番より大きくても選択に影響しない
    Given 9番の既存成果物より後に10番の成果物を追加した監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 10番のreview artifactが選ばれてfile監査は合格する
