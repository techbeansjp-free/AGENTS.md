@unit
Feature: Step 10 review round consumer側のdecisionRef機械検証（Issue #1485、L-03）

  Scenario: SCN-UNIT-DECREF-001 有効なdecisionRefを持つroundは受理される
    Given DCAND-006で分類しdecisionRefを付けたfindingを持つround入力がある
    When previewReviewRoundを実行する
    Then roundが受理される

  Scenario: SCN-UNIT-DECREF-002 存在しないdecisionRefは拒否される
    Given 存在しないdecisionRefを持つfindingがあるround入力がある
    When previewReviewRoundを実行する
    Then decisionRef欠落として拒否される

  Scenario: SCN-UNIT-DECREF-003 candidateHeadShaが不一致のdecisionRefは拒否される
    Given 別HEADで記録したdecisionRefを持つfindingがあるround入力がある
    When previewReviewRoundを実行する
    Then candidateHeadSha不一致として拒否される

  Scenario: SCN-UNIT-DECREF-004 finding内容を書き換えるとinputDigest不一致で拒否される
    Given decisionRef記録後にevidenceを書き換えたfindingがあるround入力がある
    When previewReviewRoundを実行する
    Then inputDigest不一致として拒否される
