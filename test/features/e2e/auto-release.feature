@e2e @auto-release
Feature: 自動release計画entrypoint
  workflowが使用する実entrypointを起動し、安全な計画JSONだけを出力することを確認する。

  Scenario: SCN-E2E-AUTORELEASE-001 対象変更と非対象変更と再帰commitとtag衝突を安全に計画する
    Given 自動release entrypoint用の対象・非対象・再帰・tag衝突入力がある
    When 自動release entrypointを入力ごとに実行する
    Then entrypointはreleaseと停止とbumpを外部更新なしで返す
