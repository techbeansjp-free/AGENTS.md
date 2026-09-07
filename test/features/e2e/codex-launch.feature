@e2e @codex-launch
Feature: 起動ごとの最新Codex自動使用
  公開CLIから取得時点の公式推奨を使う。

  Scenario: SCN-E2E-AM-001 公式推奨の変更を次回起動へ反映する
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 公式推奨をAからBへ変更して公開CLIを2回起動する
    Then 固定名なしで各回の具体modelとhighと標準速度を実execへ渡す
