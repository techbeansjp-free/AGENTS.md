@unit
Feature: 正式gateを維持する機械可読Work Unit契約

  Scenario Outline: SCN-UNIT-EXECPLAN-001 意味判断と決定論的操作を担当境界に分ける
    Given execution契約のStep「<step>」とrole「<role>」がある
    When execution契約を導出する
    Then executorは「<executor>」で最大1遷移と正式gate完了条件を持つ

    Examples:
      | step | role               | executor     |
      | 1    | request            | fresh-worker |
      | 2    | requirements       | fresh-worker |
      | 3    | readiness-reviewer | fresh-worker |
      | 4    | coordinator        | cli          |
      | 5    | design             | fresh-worker |
      | 6    | planning           | fresh-worker |
      | 7    | readiness-reviewer | fresh-worker |
      | 8    | coordinator        | cli          |
      | 9    | implementation     | fresh-worker |
      | 10   | reviewer           | fresh-worker |
      | 10   | correction         | fresh-worker |
      | 10   | coordinator        | cli          |
      | 11   | coordinator        | cli          |
      | 99   | coordinator        | none         |

  Scenario Outline: SCN-UNIT-EXECPLAN-002 同じStep10でも正式検証Evidenceで実行担当を選ぶ
    Given Step10の候補role「<role>」とgate「<gate>」と責務「<obligation>」と最新失敗「<failed>」がある
    When Evidenceから次のWork Unitを選ぶ
    Then 検証先行の選択は「<selected>」で正式reviewの記録を先行しない

    Examples:
      | role        | gate     | obligation | failed | selected |
      | reviewer    | required | unsatisfied | false  | true     |
      | reviewer    | required | invalidated | false  | true     |
      | reviewer    | required | unknown     | false  | false    |
      | reviewer    | required | satisfied   | false  | false    |
      | reviewer    | observed | satisfied   | false  | false    |
      | reviewer    | blocked  | invalidated | false  | false    |
      | reviewer    | required | invalidated | true   | false    |
      | reviewer    | none     | unsatisfied | false  | false    |
      | correction  | required | unsatisfied | false  | false    |
      | coordinator | required | unsatisfied | false  | true     |
      | coordinator | required | invalidated | false  | true     |
      | coordinator | required | invalidated | true   | false    |

  Scenario: SCN-UNIT-EXECPLAN-003 参照入力を正式記録artifactへ混入させない
    Given execution契約のStep「2」とrole「requirements」がある
    When Step2の参照入力と正式出力を持つ実行契約を導出する
    Then Step2の正式artifactは01だけで00は参照入力に留まる

  Scenario Outline: SCN-UNIT-EXECPLAN-004 Step11の操作はPRとtrusted merge方針に従う
    Given Step11のdelivery状態「<state>」とmerge方針「<mode>」がある
    When Step11の実行契約を導出する
    Then 最初の操作は「<operation>」で承認flagは「<authorize>」である

    Examples:
      | state          | mode      | operation                 | authorize |
      | none           | automatic | preview-manual-delivery   | true      |
      | pr-bound       | automatic | preview-merge-or-readback | false     |
      | pr-bound       | assisted  | preview-merge-or-readback | true      |
      | pr-bound       | disabled  | preview-manual-delivery   | true      |
      | pr-bound       | poc       | preview-manual-delivery   | true      |
      | merge-prepared | automatic | preview-merge-or-readback | false     |
      | merge-prepared | disabled  | preview-merge-or-readback | false     |
      | merge-observed | assisted  | preview-merge-or-readback | false     |

  Scenario: SCN-UNIT-EXECPLAN-005 完成済みQuick要求は追加Workerなしで正式記録へ進む
    Given Step1の隔離quick stagingと未完成の00がある
    When 00を完成させてEvidenceから次のWork Unitを選ぶ
    Then 未完成時は限定Coordinatorで完成後はCLIのみを示し正式記録はまだ行わない

  Scenario: SCN-UNIT-EXECPLAN-012 Issue作成入口もCandidate根拠から同じCoordinatorを選ぶ
    Given Step1の隔離quick stagingと未完成の00がある
    When Candidate結果で新たなIssueをprepare-next付きで作成する
    Then 作成時と通常planは同じ限定Coordinatorを示しworkerをdispatchしない

  Scenario: SCN-UNIT-EXECPLAN-006 完成済みQuick要求も既存Step1 gateを通る
    Given Step1の隔離quick stagingと未完成の00がある
    When 00を完成させてEvidenceから次のWork Unitを選ぶ
    And 完成済み00を正式gateで1回記録する
    Then Step1だけが記録されStep4以降の契約は維持される

  Scenario: SCN-UNIT-EXECPLAN-007 Candidate出自なしの完成済みQuickはWorkerを省かない
    Given Candidate出自のないStep1の隔離quick stagingがある
    When 00を完成させてEvidenceから次のWork Unitを選ぶ
    Then Candidate出自がなければ完成済み00でもfresh Workerを維持する

  Scenario: SCN-UNIT-EXECPLAN-008 危険差分のCandidateはQuick完成文書だけでWorkerを省かない
    Given Candidateの危険差分があるStep1の隔離quick stagingがある
    When 00を完成させてEvidenceから次のWork Unitを選ぶ
    Then 危険差分があれば完成済み00でもCLI記録へ進まない

  Scenario: SCN-UNIT-EXECPLAN-009 Candidateのplan後にHEADが動いたら記録を拒否する
    Given Step1の隔離quick stagingと未完成の00がある
    When 00を完成させてEvidenceから次のWork Unitを選ぶ
    And plan後にCandidate HEADが変わった状態で正式記録を試す
    Then 古いCandidate計画ではStep1を記録しない

  Scenario: SCN-UNIT-EXECPLAN-010 Quickの意味的責務は現在HEADへ拘束したreviewでだけ充足する
    Given Quick reviewの隔離fixtureがある
    When Quick reviewの現在HEAD拘束と失効を証明責務へ投影する
    Then 古いreviewは未確定で修正後の正式reviewだけが責務を満たす

  Scenario: SCN-UNIT-EXECPLAN-011 Quick要求の不足を解消できない場合はfresh Workerへ委譲する
    Given Step1の隔離quick stagingと未完成の00がある
    When 未確定のQuick要求を明示的にfresh Workerへ委譲する
    Then 委譲は正式記録を変えず独立Worker dispatchを返す
