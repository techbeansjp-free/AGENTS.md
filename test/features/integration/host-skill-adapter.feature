@integration
Feature: host skill登録アダプターをpackage lifecycleで管理する

  Scenario: SCN-INT-HOST-SKILL-001 installはClaude CodeとCodexの探索pathへ同じadapterを登録する
    Given 空のconsumer repositoryがある
    When package lifecycleのinstallを適用する
    Then 両host adapterは正本とbyte一致しmanaged recordへ記録される
    And doctorはhost adapterをhealthyと診断する

  Scenario: SCN-INT-HOST-SKILL-002 updateは未管理の同一adapterを採用する
    Given install済みconsumerから両host adapterの管理記録だけを除いた状態がある
    When package lifecycleのupdateを適用する
    Then 両host adapterはadoptedとしてmanaged recordへ記録される

  Scenario: SCN-INT-HOST-SKILL-003 updateは未管理の異なる同名fileを保持する
    Given install済みconsumerに未管理で内容が異なるClaude adapterがある
    When package lifecycleのupdateを適用する
    Then 異なるClaude adapterはretainedとして同じ内容で残る

  Scenario: SCN-INT-HOST-SKILL-004 updateは管理中adapterをpackage正本へ更新する
    Given install済みconsumerに旧package所有adapterがある
    When package lifecycleのupdateを適用する
    Then 管理中の旧adapterは現在のpackage正本へ更新される

  Scenario: SCN-INT-HOST-SKILL-005 deleteは管理中adapterだけを削除して他skillを保持する
    Given install済みconsumerにClaude CodeとCodexの他skillがある
    When package lifecycleのdeleteを適用する
    Then 両host adapterだけが削除され他skillは同じ内容で残る

  Scenario: SCN-INT-HOST-SKILL-006 doctorはadapter不整合を具体的に報告する
    Given install済みconsumerのCodex adapterが改ざんされている
    When package lifecycleのdoctorを実行する
    Then doctorはunhealthyと対象pathを含む診断を返す

  Scenario: SCN-INT-HOST-SKILL-007 現行Codex adapterをlegacy .agentsと誤判定しない
    Given install済みconsumerに現行Codex adapterだけがある
    When package lifecycleのdoctorを実行する
    Then doctorはdot agentsをlegacyと判定しない
    When dot agentsへ旧資産を追加してdoctorを実行する
    Then doctorはdot agentsをlegacyと判定する

  Scenario: SCN-INT-HOST-SKILL-008 host探索pathのsymlinkによる境界外writeを拒否する
    Given consumerのClaude探索pathが境界外directoryへのsymlinkである
    When package lifecycleのinstallを試みる
    Then installは書込前に拒否され境界内外へpackage資産を作らない
