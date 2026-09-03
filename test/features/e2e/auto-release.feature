@e2e @auto-release
Feature: 自動release計画entrypoint
  workflowが使用する実entrypointを起動し、安全な計画JSONだけを出力することを確認する。

  Scenario: SCN-E2E-AUTORELEASE-001 配布差分と同一配布物と再帰commitとtag衝突を安全に計画する
    Given 自動release entrypoint用の未release・同一・再帰・配布差分入力がある
    When 自動release entrypointを入力ごとに実行する
    Then entrypointはreleaseと停止を外部更新なしで返す

  Scenario: SCN-E2E-AUTORELEASE-002 現在versionの明示入力を省略した既存呼び出しを維持する
    Given 現在versionを省略した自動release entrypoint入力がある
    When 現在versionを省略して自動release entrypointを実行する
    Then entrypointは既存tagから現在versionを導く

  Scenario: SCN-E2E-AUTORELEASE-003 digest JSONの欠落と破損を空文字として扱う
    Given 現在tagが存在する自動release entrypoint入力がある
    When 欠落した現在digest fileと壊れた前回digest fileでentrypointを実行する
    Then 欠落した現在digestは停止し壊れた前回digestはfail-openする
