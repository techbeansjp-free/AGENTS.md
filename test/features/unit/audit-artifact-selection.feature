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

  Scenario: SCN-UNIT-AUDITSEL-009 比較基点を候補branch内へ前進させた申告を拒否する
    Given 比較基点を候補branch内へ前進させmerge commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は比較基点の不一致を報告する

  Scenario: SCN-UNIT-AUDITSEL-010 境界commitが親1個のときは比較基点を導出しない
    Given 比較基点を候補branch内へ前進させartifact commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は比較基点を検証せず合格する

  Scenario: SCN-UNIT-AUDITSEL-011 merge-baseが一意でないときを判定不能として拒否する
    Given merge-baseが一意でない履歴でmerge commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は比較基点の導出不能を報告する

  Scenario: SCN-UNIT-AUDITSEL-012 境界commitの親が3個のときを判定不能として拒否する
    Given 親が3個の境界commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は比較基点の導出不能を報告する
    And file監査は候補側の注記を付けない

  Scenario: SCN-UNIT-AUDITSEL-013 既定branch追随merge上では選択した親が候補側でない可能性を診断へ示す
    Given 既定branchを取り込んだ追随merge commitをHEADにした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は選択した親が候補側でない可能性と両親の着地形file数を示す

  Scenario: SCN-UNIT-AUDITSEL-014 境界commitの親が1個のときは候補側の注記を付けない
    Given review artifactと2件の余分なpathを同時にcommitした監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then file監査は不合格になり候補側の注記を付けない

  Scenario: SCN-UNIT-AUDITSEL-015 artifactだけを直す前進commitでH_implを動かさない
    Given review artifactだけを直す前進commitを2本積んだ監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格し導出したH_implが期待どおりである

  Scenario: SCN-UNIT-AUDITSEL-016 artifact以外を含むcommitで遡りを止める
    Given review artifactの直後に実装を変える前進commitを積んだ監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格し導出したH_implが期待どおりである

  Scenario: SCN-UNIT-AUDITSEL-017 suffixの途中でartifactを2件同時に変えるcommitで遡りを止める
    Given suffixの途中でartifactを2件同時に変える監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格し導出したH_implが期待どおりである

  Scenario: SCN-UNIT-AUDITSEL-018 suffixの途中のmerge commitで遡りを止める
    Given suffixの途中にmerge commitがある監査選択repository
    When 監査選択repositoryのfile監査を実行する
    Then 監査選択のfile監査は合格し導出したH_implが期待どおりである
