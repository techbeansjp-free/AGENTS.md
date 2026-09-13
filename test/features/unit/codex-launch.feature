@unit @codex-launch
Feature: 公式推奨Codexの一意選択
  起動前に推奨とhigh対応を確認する。

  @routing-1383
  Scenario: SCN-UNIT-ROUTING-1383-002 不正topologyはdispatch前に拒否する
    Given Git書込commandを使わない隔離linked worktree fixtureがある
    When 不正なGit相互linkと未知topologyを起動前に拒否する
    Then Git workspace境界の受け入れ条件を満たす

  @routing-1383
  Scenario: SCN-UNIT-ROUTING-1383-003 read-onlyとprimaryの権限を維持する
    Given Git書込commandを使わない隔離linked worktree fixtureがある
    When read-onlyとprimaryの固定argvを維持する
    Then Git workspace境界の受け入れ条件を満たす

  @routing-1383
  Scenario: SCN-UNIT-ROUTING-1383-004 拒否理由へ秘密を漏らさない
    Given Git書込commandを使わない隔離linked worktree fixtureがある
    When Git境界拒否結果からprivate入力を除外する
    Then Git workspace境界の受け入れ条件を満たす

  Scenario: SCN-UNIT-AM-002 名称で性能順位を推測しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 非推奨の新しそうな名前を選ばず一意の公式推奨だけを起動する
    Then 最新Codex起動の受け入れ条件を満たす

  Scenario: SCN-UNIT-AM-004 不明な公式推奨で起動しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 公式推奨不明と曖昧とhigh非対応とcustom catalogで起動しない
    Then 最新Codex起動の受け入れ条件を満たす
