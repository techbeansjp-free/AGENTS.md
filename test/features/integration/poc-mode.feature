@integration
Feature: PoCの最小成果物と停止点を統合する

  Background:
    Given PoC検証用の隔離repositoryと完全宣言がある

  Scenario: SCN-INT-POC-001 pocのstagingは最小成果物とPoC宣言を日本語で生成する
    Given PoCの最小stagingを生成する条件が揃っている
    When pocのissue stagingを作成する
    Then stagingのモードはpocである
    And stagingには00要求定義だけが存在する
    And 00要求定義に目的と期間と成功中止条件と非対象と責任者が日本語で記録される
    And 00要求定義の管理情報はpocである

  Scenario: SCN-INT-POC-002 pocはrelease・自動merge・本番cleanupへ進めない
    Given pocのissue stagingを作成済みである
    When pocでreleaseと自動mergeと本番cleanupを検証する
    Then すべての禁止操作は拒否される
    And PoCの禁止操作一覧が返る

  Scenario: SCN-INT-POC-003 pocから正式開発へ移る際の不足成果物を列挙する
    Given pocのissue stagingを作成済みである
    When PoCの正式開発昇格計画を作る
    Then fullに不足する01と02と03の成果物が列挙される
    And 昇格根拠と補完理由が返る
