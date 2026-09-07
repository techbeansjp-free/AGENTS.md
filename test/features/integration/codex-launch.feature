@integration @codex-launch
Feature: Codexのtrusted採用と実行境界
  採用条件と実行結果を独立に検証する。

  Scenario: SCN-INT-AM-003 candidateが採用tierを自己認定しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When candidate追加と旧slug台帳でtrusted採用不足を補えない
    Then 最新Codex起動の受け入れ条件を満たす

  Scenario: SCN-INT-AM-005 有限実行の結果に秘密を転記しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When 完了と失敗と不明と時間容量上限を区別し秘密を出力しない
    Then 最新Codex起動の受け入れ条件を満たす

  Scenario: SCN-INT-AM-006 taskはshell文として実行しない
    Given 最新Codex起動用のtrusted projectと隔離実行入口がある
    When promptのshell文字列はデータとなりpathとcontext不正はdispatch前に拒否する
    Then 最新Codex起動の受け入れ条件を満たす
