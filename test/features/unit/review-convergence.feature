@unit
Feature: Review sessionを固定契約へ収束させる

  Scenario: SCN-UNIT-REVIEWCONV-001 前round blockerを解消し範囲外audit提案を記録だけにして収束する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When round 2で既存findingを解消し範囲外audit改善提案を追加する
    Then review sessionはdigest chainを保ってconvergedになる
    And 範囲外audit改善提案はrecord-onlyである
    And 影響集合を証明できない修正差分外で前round blockerへ結び付かないHighはrecord-onlyである

  Scenario: SCN-UNIT-REVIEWCONV-002 round自己申告resetとanchor変更を拒否する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じstagingでround 1へresetする
    Then review session更新はreset拒否で失敗する
    When round 2でscope anchorを変更する
    Then review session更新はanchor拒否で失敗する

  Scenario: SCN-UNIT-REVIEWCONV-003 修正起因Highだけを新規blockerへ認める
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When round 2の修正差分で前round finding起因のHigh回帰を記録する
    Then 修正起因Highはcurrent blockerになる

  Scenario: SCN-UNIT-REVIEWCONV-005 収束後の実commitだけを同digest chainで再reviewする
    Given findingなしでround 1が収束したreview sessionがある
    When 収束HEAD後に実commitを追加しround 2で再reviewする
    Then review sessionはround 2で再収束する
    When 同じHEADをround 3として追記する
    Then review session更新は同じHEADと空fixedDiffで拒否される

  Scenario: SCN-UNIT-ROUNDBUDGET-001 round数の上限による拒否が無い
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingを旧上限を超えるroundまで未解決にする
    Then round数を理由に拒否されずactiveのままである
    When 次roundで前round blockerを解消する
    Then review sessionは旧上限を超えたroundで収束する
    When 収束後にHEADを進めて再reviewを繰り返す
    Then 収束後の再reviewも件数で拒否されない

  Scenario: SCN-UNIT-ROUNDBUDGET-002 保存済みbudget-exhausted sessionを読み取り継続できる
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingを旧上限を超えるroundまで未解決にする
    And 保存済みsessionのstatusを旧形式のbudget-exhaustedへ書き換える
    Then 旧形式のsessionをactiveとして読み取れる
    And 旧形式でもstatus以外の改竄は拒否する
    And 旧形式のsessionへ次roundを記録できる

  Scenario: SCN-UNIT-ROUNDBUDGET-003 発散の兆候をwarningとして報告し判定を変えない
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingを旧上限を超えるroundまで未解決にする
    Then 発散warningが再発findingを名指しする
    And 再発が閾値未満ならwarningを出さない
    And warningは記録済みstatusとdigestを変えない
    When 次roundで新しいHigh blockerを修正差分に記録する
    Then 発散warningが新規blockerを名指しする

  Scenario: SCN-UNIT-ROUNDBUDGET-004 round上限廃止後もadmission規則で拒否する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingを旧上限を超えるroundまで未解決にする
    Then 旧上限を超えたroundでもadmission違反を拒否する
    And 旧上限を超えたroundでも固定ACへ結び付かないHighはrecord-onlyである

  Scenario: SCN-UNIT-REVIEWCONV-008 既定branch追随だけのroundは数えるroundに含めない
    Given findingなしでround 1が収束したreview sessionがある
    When 既定branchを取り込む自動mergeだけでHEADを進めroundを3回記録する
    Then どのroundも記録されるが数えるroundには含めない
    And 通常roundを続けて記録でき記録総数は数えるround数を超える

  Scenario: SCN-UNIT-REVIEWCONV-009 追随として受理しない形を名指しして拒否する
    Given findingなしでround 1が収束したreview sessionがある
    When 衝突を解決したmergeは自動merge結果と一致しないとして拒否される
    Then 既定branchのancestorでない第2親を持つmergeは拒否される
    And 第1親が前roundのcandidateでないmergeは拒否される
    And 追随roundへfindingを載せると数えるroundとして記録する旨を名指しして拒否される
    And 実装commitを挟んでからのmergeは拒否される

  Scenario: SCN-UNIT-REVIEWCONV-010 未解決blockerを持つ追随roundを記録し保存時もGit証拠を再検証する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 未解決blockerを持ったまま既定branchの自動mergeだけを記録する
    Then 追随roundはblockerと数えるround数を維持したactive状態になる
    When Git条件を満たさないfollow-only sessionを保存して読み直す
    Then 保存済みfollow-only roundはGit再検証で拒否される

  Scenario: SCN-UNIT-REVIEWCONV-011 reanchor後の実効HEADからの追随を保存後も受理する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When reanchor後の実効HEADから既定branchの自動mergeだけを記録する
    Then 追随roundは保存後read-backでも受理される

  Scenario: SCN-UNIT-RECORDLAYER-004 検証済みrecord layer roundを記録して数えるroundに含めない
    Given findingなしでround 1が収束したreview sessionがある
    When 検証済みrecord layerとしてround 2をdomainへ記録する
    Then record layer roundは保存され数えるroundに含めない

  Scenario: SCN-UNIT-RECORDLAYER-005 findingありroundを数えるroundに含める
    Given findingなしでround 1が収束したreview sessionがある
    When findingありの通常round 2をdomainへ記録する
    Then findingありroundは数えるroundに含める
