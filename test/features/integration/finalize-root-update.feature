@integration @rootupd
Feature: 隔離repositoryでmerge後のroot更新とcleanupを実行する

  Scenario: SCN-INT-ROOTUPD-001 隔離repositoryでmerge後のrootをfast-forwardする
    Given merge済みremoteを持つ隔離root repositoryがある
    When 検証済みmerge SHAへrootをfast-forwardする
    Then 隔離rootのHEADはremote merge SHAと一致する

  Scenario: SCN-INT-ROOTUPD-002 dirtyなrootを変更せずfail-closedで停止する
    Given merge済みremoteを持つdirtyな隔離root repositoryがある
    When dirtyな隔離rootの更新を計画する
    Then 隔離rootのHEADと作業内容を変更せずrejectedになる

  Scenario: SCN-INT-ROOTUPD-003 対象worktreeだけを削除し他worktreeとmetadataを保持する
    Given 対象・他作業・prunable metadataを持つ隔離repositoryがある
    When 完全一致した対象worktreeだけをcleanupする
    Then 他worktreeとprunable metadataは保持される
