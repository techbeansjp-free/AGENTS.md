@unit @provider-routing
Feature: coordinatorからimplementerへのrouting解決
  Codex優先とClaude fallbackを決定的に解決し、roleとmodel選択元を証拠化する具体例を示す。

  Scenario: SCN-UNIT-ROUTING-001 Claude進行時に利用可能なCodex最高位tierへ実装を委譲する
    Given ClaudeがcoordinatorでCodexの最高位coding tierを利用できる
    When product実装taskの担当を解決する
    Then implementerはCodexである
    And modelはprovider公式recommended defaultである
    And reasoning effortはhighである
    And service tierはdefaultである
    And high非対応の公式recommended defaultはClaude fallbackである

  Scenario: SCN-UNIT-ROUTING-004 Codexが使えるscopeでcoordinatorの実装を拒否する
    Given ClaudeがcoordinatorでCodexを利用できる
    When coordinator identityでproduct pathの実装を開始しようとする
    Then role違反として拒否する
    And 拒否結果はrule IDを持つ
    And coordinatorとimplementerが同一identityのroutingは解決時に拒否する

  Scenario: SCN-UNIT-ROUTING-005 低位modelと別reasoningと高速tierへの無告知後退を拒否する
    Given 最高位coding tierとreasoning effort highとservice tier defaultを解決した
    When 低位modelまたは別のreasoning effortまたはfast以上の速度tierへ差し替えようとする
    Then 無告知の後退として拒否する
    And 実行直前の再検証で解決結果が変化しても拒否する
    And 実装を開始しない

  Scenario: SCN-UNIT-ROUTING-007 公式recommended defaultを観測できないときClaude modelへ切り替え実装は停止する
    Given 利用可能model一覧に公式recommended defaultがない
    When 最高位coding tierを解決する
    Then 解決状態はfallbackである
    And Claude modelへ切り替え、coordinatorの実装は再割当まで停止する
    And Codexの順位を推測しない

  Scenario: SCN-UNIT-ROUTING-011 recommended defaultが複数あるとき推測せずClaude実装へ切り替える
    Given provider観測にrecommended defaultが2件ある
    And その2件がいずれも利用可能である
    When 最高位coding tierを解決する
    Then 解決状態はfallbackである
    And 同一入力に対する結果は一意である
