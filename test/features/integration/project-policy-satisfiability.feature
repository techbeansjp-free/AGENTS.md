@integration @project-policy-satisfiability
Feature: 異なる言語構成の利用projectがpolicyを充足する
  実在する資産だけでproject policy一式を検証する。

  Scenario: SCN-INT-SAT-001 PHP主体・TypeScript補助のtheme projectがproject policyを充足できる
    Given PHP templateとTypeScript frontendを持つ隔離theme project policyがある
    When 隔離theme project policy一式を検証する
    Then 虚偽のexportと不存在pathと未採番SCNなしでvalidである

  Scenario: SCN-INT-SAT-002 型検査を持たない言語のprojectがproject policyを充足できる
    Given 型検査を持たない隔離project policyがある
    When 隔離project policy一式を検証する
    Then package-attestedとquality applicabilityでvalidである

  Scenario: SCN-INT-SAT-003 現行repositoryのproject policyが変更なしで同じ強度で合格する
    Given 現行repositoryのproject policyを変更せず読み込む
    When 現行repositoryのpolicyとconformanceを検証する
    Then scope省略と全applicableとquality実値の同じ強度でvalidである

  Scenario: SCN-INT-SAT-004 I1を1件削除、exportを不存在名へ変更、SCN成功証拠を削除した構成は従来どおり失敗する
    Given 現行conformanceを3種類弱化した反例がある
    When 現行repositoryのconformance反例を検証する
    Then I1削除と不存在exportとSCN証拠削除をすべて拒否する
