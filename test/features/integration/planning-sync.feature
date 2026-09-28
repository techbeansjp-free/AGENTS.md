@integration
Feature: 同期操作が所有するPlanningの構造検証

  Scenario: SCN-PRAT-007 不正Planningは同期previewでproviderを呼ぶ前に拒否する
    Given 同stagingの00に具体的な内容を持つ3つのPlanning参照がある
    When 不正Planningの同期previewを隔離providerで検査する
    Then 同期previewのprovider呼出しは0件である
