@integration
Feature: 旧policyの未評価契約違反を全consumerで止める

  Scenario: SCN-INTEGRATION-REVIEWPOLICY-001 旧convergedのpendingを配送せずreviewerへ渡す
    Given 隔離repoに旧policyの履歴省略sessionを保存した
    When Step10とexportとreanchorのgateを評価する
    Then Step10とexportとreanchorはpendingを名指しして拒否する
    And handoffは全pendingを持つ次roundのreviewerを指定する
    And resumeは実効activeを表示し保存sessionのstatusを変えない

  Scenario: SCN-INTEGRATION-REVIEWPOLICY-002 同HEADで全historyのpendingをcarriedへ復元する
    Given 隔離repoに旧policyの履歴省略sessionを保存した
    When 同HEADのreview round雛形を作る
    Then 全pendingを復元してrecordLayerを自動付与しない
    And 全pendingを解決した後の同HEADの雛形は拒否する

  Scenario: SCN-INTEGRATION-REVIEWPOLICY-003 同roundのblocker群を1つの修正HEADへまとめる
    Given 隔離repoに旧policyの履歴省略sessionを保存した
    When 2件の契約blockerを同roundに固定して1つのcommitで修正する
    Then 次のfocused roundで全blockerを一括resolvedにして収束する

  Scenario: SCN-INTEGRATION-REVIEWPOLICY-004 旧High activeはcorrectionへ進む
    Given 隔離repoに旧policyのHigh activesessionを保存した
    When 保存sessionのStep10 handoffを観測する
    Then 旧Highのhandoffは再評価ではなくcorrectionへblockerを渡す
