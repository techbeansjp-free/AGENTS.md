@integration @release
Feature: 手動releaseの工程証跡監査例外
  品質検査を維持し対象commitに限定した明示例外を記録する。

  Scenario: SCN-INT-RELEASE-EXCEPTION-001 手動実行と対象SHAを必須にする
    Given 対象SHAと理由を指定した手動release環境がある
    When 手動releaseの工程監査例外を評価する
    Then 工程監査例外は手動実行の完全一致SHAと理由がある場合だけ成立する

  Scenario: SCN-INT-RELEASE-EXCEPTION-002 不合格を合格に書き換えず例外として保存する
    Given 対象SHAと理由を指定した手動release環境がある
    When 手動releaseの工程監査例外を評価する
    Then 工程監査例外は元の不合格結果と実行者を保存し記録失敗を拒否する

  Scenario: SCN-INT-RELEASE-EXCEPTION-003 品質検査と配布物検査を省略しない
    Given 対象SHAと理由を指定した手動release環境がある
    When 手動releaseの工程監査例外を評価する
    Then releaseの品質gateは維持され工程監査だけに例外入力が渡る

  Scenario Outline: SCN-INT-RELEASE-EXCEPTION-004 実Gitの監査で証跡欠落だけを例外化する
    Given 工程監査例外の実Git境界fixture "<kind>" がある
    When 工程監査の実結果にrelease例外を適用する
    Then 工程監査例外の適用可否は "<result>" になる

    Examples:
      | kind          | result |
      | missing       | allow  |
      | corrupt       | deny   |
      | binding       | deny   |
      | loss          | deny   |
      | unobserved    | deny   |
      | single-parent | deny   |
