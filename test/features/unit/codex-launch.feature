@unit @codex-launch
Feature: 公式推奨Codexの一意選択
  起動前に推奨とhigh対応を確認する。

  Scenario: SCN-UNIT-AM-002 名称で性能順位を推測しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 非推奨の新しそうな名前を選ばず一意の公式推奨だけを起動する
    Then 最新Codex起動の受け入れ条件を満たす

  Scenario: SCN-UNIT-AM-004 不明な公式推奨で起動しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 公式推奨不明と曖昧とhigh非対応とcustom catalogで起動しない
    Then 最新Codex起動の受け入れ条件を満たす
