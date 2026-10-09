@unit
Feature: 固定契約のadmissionと旧policyの再評価

  Scenario: SCN-REVIEW-FAST-101 MediumとLowの一般改善でreviewを再開しない
    Given 固定契約admissionの入力がある
    When 一般改善と固定契約違反を全severityで評価する
    Then 一般改善はrecord-onlyで固定契約違反はblock-currentになる

  Scenario: SCN-REVIEW-FAST-102 固定契約違反をseverity低下だけで解消しない
    Given 固定契約admissionの入力がある
    When 固定契約blockerのseverityをLowへ下げる
    Then validな固定契約blockerが残る
    And 固定契約を持たないMediumの修正回帰はrecord-onlyである

  Scenario: SCN-REVIEW-FAST-105 focused scope外と未知契約を採用しない
    Given 固定契約admissionの入力がある
    When focused範囲外と未知契約と非validのfindingを再評価する
    Then focused範囲外と未知契約と非validのfindingはblockerにならない

  Scenario: SCN-REVIEW-FAST-107 同roundの複数blockerを一括で解決する
    Given 固定契約admissionの入力がある
    When 2件の契約blockerを1つの修正HEADで解決する
    Then 2 roundで実効収束し追加roundは不要になる

  Scenario: SCN-REVIEW-FAST-108 旧main生成sessionを元のdigestで厳密に再生する
    Given 旧mainが生成したMediumとLowの契約違反sessionと履歴省略sessionがある
    When 旧sessionを現行validatorで再生する
    Then 元のdigestと保存statusを保ち全historyからpendingを復元する
    And pendingのある証跡生成と証跡照合は拒否する
    And pendingのあるsessionはreview session置換の前提を満たさない
    And markerとadmissionの改竄と新版から旧版への逆戻りは拒否する

  Scenario: SCN-UNIT-REVIEWPOLICY-001 pendingを非消費roundやhistory省略で消さない
    Given 旧mainが生成したMediumとLowの契約違反sessionと履歴省略sessionがある
    When pendingのあるfollowとrecordLayerとfinding省略を試みる
    Then 未評価findingと保存済みdigestは変わらない
    When 同HEADで全pendingを明示的に解決する
    Then pendingは復活せず通常の収束済み同HEAD禁止へ戻る

  Scenario: SCN-UNIT-REVIEWPOLICY-002 最新観測の分類と履歴のscopeでlegacy適格性を判定する
    Given 旧mainが生成したMediumとLowの契約違反sessionと履歴省略sessionがある
    When 旧historyへresolvedと未知契約とscope外の最新観測を再生する
    Then 旧historyのresolvedと未知契約は解除しscope外の継続違反はpendingに残す

  Scenario: SCN-UNIT-REVIEWPOLICY-003 旧CriticalとHighのblockerは非消費roundで保持する
    Given 旧mainが生成したHigh契約blockerがある
    When 旧blockerを保持してfollowとrecordLayerの非消費roundを進める
    Then 旧CriticalとHighはpendingではなくactive blockerのままである

  Scenario: SCN-UNIT-REVIEWPOLICY-004 旧roundのHighだけを修正しても再掲したMedium契約違反は配送できない
    Given 旧policyでMedium契約違反を再掲しHighだけを解決したsessionがある
    When 旧sessionの履歴を現policyのsessionと比較する
    Then 旧digestとstatusを保持して同じ未解決契約違反をblockerにする
    When 同HEADで全pendingを明示的に解決する
    Then pendingは復活せず通常の収束済み同HEAD禁止へ戻る

  Scenario: SCN-UNIT-REVIEWPOLICY-005 途中で解除した旧findingを無関係scopeで再掲しても再ブロックしない
    Given 旧policyでMedium契約違反を再掲しHighだけを解決したsessionがある
    When 途中の旧roundで非blockingに分類した後にscope外でvalidを再掲する
    Then 解除済みのfindingはpendingへ復活しない

  Scenario: SCN-UNIT-REVIEWPOLICY-006 初観測からscope外の旧契約findingは再掲してもpendingにならない
    Given 旧policyでMedium契約違反を再掲しHighだけを解決したsessionがある
    When 契約findingの初観測をfocused範囲外にする
    Then 解除済みのfindingはpendingへ復活しない
