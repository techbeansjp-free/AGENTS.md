@integration
Feature: Shadow評価をprimaryRootとworkflow metricsへ接続する
  Scenario: SCN-INT-SHADOW-EVAL-001 primaryRootからの読取り
    Given 隔離repositoryにshadow評価journalを用意する
    When 別worktreeから重複指定を含めshadow評価を読む
    Then 入力を変えずprimary記録を一度だけ評価し安全でない読取りを拒否する
  Scenario: SCN-INT-SHADOW-EVAL-002 workflow metrics統合
    Given 隔離repositoryにshadow評価journalを用意する
    When 既存metricsへshadow評価を合成する
    Then shadow集計と既存時間およびnullをそれぞれ維持する
