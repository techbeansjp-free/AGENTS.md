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

  Scenario: SCN-UNIT-DECREF-005 decisionRefのeffectiveValueとfinding.severityが不一致だと拒否される
    Given effectiveValueがHighのdecisionRefをseverity Lowのfindingへ設定したround入力がある
    When previewReviewRoundを実行する
    Then severityとeffectiveValueの不一致として拒否される

  Scenario: SCN-UNIT-DECREF-006 decision journalに不正な行があると有効なdecisionRefでも拒否される
    Given 有効なdecisionRefを持つがdecision journalに不正な行も混在するfindingがあるround入力がある
    When previewReviewRoundを実行する
    Then decision journalの不正な行として拒否される

  Scenario: SCN-UNIT-DECREF-007 decisionRef field自体が無いlegacy findingは受理され機械検証の対象外になる
    Given decisionRef導入前のfield無しfindingを持つround入力がある
    When previewReviewRoundを実行する
    Then roundが受理される

  Scenario: SCN-UNIT-DECREF-008 decisionRef field無しとdecisionRef nullは異なるroundDigestになる
    Given decisionRef field無しのfindingとdecisionRef nullのfindingで同内容のround入力を用意する
    When 両方のroundDigestを比較する
    Then roundDigestは異なる
