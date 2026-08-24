@unit @provider-routing
Feature: coordinatorからimplementerへのrouting解決
  role分離とmodel解決を決定的に行い、不明な状態で実装を開始しないことを具体例で示す。

  Scenario: SCN-UNIT-ROUTING-001 Claude進行時に利用可能なCodex最高位tierへ実装を委譲する
    Given ClaudeがcoordinatorでCodexの最高位coding tierを利用できる
    When product実装taskの担当を解決する
    Then implementerはCodexである
    And modelはprovider公式recommended defaultである
    And reasoning effortはhighである
    And service tierはdefaultである
    And high非対応の公式recommended defaultはpendingである

  Scenario: SCN-UNIT-ROUTING-004 Codexが使えるscopeでcoordinatorの実装を拒否する
    Given ClaudeがcoordinatorでCodexを利用できる
    When coordinator identityでproduct pathの実装を開始しようとする
    Then role違反として拒否する
    And 拒否結果はrule IDを持つ

  Scenario: SCN-UNIT-ROUTING-005 低位modelと別reasoningと高速tierへの無告知後退を拒否する
    Given 最高位coding tierとreasoning effort highとservice tier defaultを解決した
    When 低位modelまたは別のreasoning effortまたはfast以上の速度tierへ差し替えようとする
    Then 無告知の後退として拒否する
    And 実行直前の再検証で解決結果が変化しても拒否する
    And 実装を開始しない

  Scenario: SCN-UNIT-ROUTING-007 公式recommended defaultを観測できないときpendingで停止する
    Given 利用可能model一覧に公式recommended defaultがない
    When 最高位coding tierを解決する
    Then 解決状態はpendingである
    And provider再観測要求を返す
    And 順位を推測しない

  Scenario: SCN-UNIT-ROUTING-011 recommended defaultが複数あるとき推測せずpendingにする
    Given provider観測にrecommended defaultが2件ある
    And その2件がいずれも利用可能である
    When 最高位coding tierを解決する
    Then 解決状態はpendingである
    And 同一入力に対する結果は一意である
