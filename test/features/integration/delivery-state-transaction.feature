@integration
Feature: delivery stateとstaging recordを永続transactionで一体更新する

  Scenario Outline: SCN-INT-DELTXN-001 各crash cutから旧版または新版へ安全に収束する
    Given delivery state transactionが"<cut>"で停止している
    When delivery readiness readでpending transactionを復旧する
    Then delivery state transactionは"<result>"へ収束する

    Examples:
      | cut | result |
      | publish前 | 旧版 |
      | delivery publish後 | 新版 |
      | staging record refresh後 | 新版 |
      | marker clear後 | 新版 |

  Scenario Outline: SCN-INT-DELTXN-002 不正markerを副作用なしでfail-closedにする
    Given delivery state transaction markerを"<tamper>"にする
    When delivery readiness readでpending transactionを復旧する
    Then delivery state transactionは副作用なしで拒否される

    Examples:
      | tamper |
      | digest改ざん |
      | path escape |
      | path count超過 |
      | byte超過 |
      | symlink |
      | hardlink |

  Scenario: SCN-INT-DELTXN-003 delivery stateが旧版と新版のどちらでもなければfail-closedにする
    Given delivery state transactionに第三のdelivery stateがある
    When delivery readiness readでpending transactionを復旧する
    Then delivery state transactionは副作用なしで拒否される

  Scenario: SCN-INT-DELTXN-004 transaction中のstaging改ざんをfail-closedにする
    Given delivery state transaction中に別のstaging成果物が改ざんされている
    When delivery readiness readでpending transactionを復旧する
    Then delivery state transactionは副作用なしで拒否される

  Scenario: SCN-INT-DELTXN-005 dispatch claim publish後の再実行は外部dispatch権を再発行しない
    Given PR create dispatch claimのpublish後に停止している
    When 別時刻でPR create dispatchを再claimする
    Then 最初のdispatch claimだけを保持し再dispatchを許可しない

  Scenario: SCN-INT-DELTXN-006 Step 11終端後の変更を副作用なしで拒否する
    Given Step 11をPR停止終端として記録済みである
    When 異なるStep 11 evidenceへの変更を試みる
    Then 終端delivery stateとstaging recordはbyte単位で変わらない
