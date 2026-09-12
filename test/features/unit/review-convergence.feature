@unit
Feature: Review sessionを固定契約へ収束させる

  Scenario: SCN-UNIT-REVIEWCONV-001 前round blockerを解消し範囲外audit提案を記録だけにして収束する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When round 2で既存findingを解消し範囲外audit改善提案を追加する
    Then review sessionはdigest chainを保ってconvergedになる
    And 範囲外audit改善提案はrecord-onlyである
    And 未照合Graph digestによる隣接Highはrecord-onlyである

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

  Scenario: SCN-UNIT-REVIEWCONV-004 予算上限まで未解決なら自動scope拡大せず終了する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingを予算上限まで未解決にする
    Then review sessionはbudget-exhaustedになる
    And 取り直しroundへの自動継続を拒否する

  Scenario: SCN-UNIT-REVIEWCONV-005 収束後の実commitだけを同digest chainで再reviewする
    Given findingなしでround 1が収束したreview sessionがある
    When 収束HEAD後に実commitを追加しround 2で再reviewする
    Then review sessionはround 2で再収束する
    When 同じHEADをround 3として追記する
    Then review session更新は同じHEADと空fixedDiffで拒否される

  Scenario: SCN-UNIT-REVIEWCONV-006 収束後のHEAD移動へ取り直しを別枠で許す
    Given findingなしでround 1が収束したreview sessionがある
    When 収束させずに予算上限まで進める
    And 収束後にHEADを進めて取り直しroundを使い切る
    Then review sessionは取り直しroundで再収束する
    And 取り直し上限を超える自動継続を拒否する

  Scenario: SCN-UNIT-REVIEWCONV-007 取り直しラウンドで未解決が残ればbudget-exhaustedにする
    Given findingなしでround 1が収束したreview sessionがある
    When 収束させずに予算上限まで進める
    And 収束後にHEADを進めて取り直しroundで未解決を残す
    Then review sessionは取り直しroundでbudget-exhaustedになる
    And budget終了後の追記を拒否する

  Scenario: SCN-UNIT-REVIEWCONV-008 既定branch追随だけのroundは予算へ数えない
    Given findingなしでround 1が収束したreview sessionがある
    When 既定branchを取り込む自動mergeだけでHEADを進めroundを3回記録する
    Then どのroundも記録されるが予算へは数えない
    And 予算上限までの通常roundを続けて記録でき記録総数は予算上限を超える

  Scenario: SCN-UNIT-REVIEWCONV-009 追随として受理しない形を名指しして拒否する
    Given findingなしでround 1が収束したreview sessionがある
    Then 衝突を解決したmergeは自動merge結果と一致しないとして拒否される
    And 既定branchのancestorでない第2親を持つmergeは拒否される
    And 第1親が前roundのcandidateでないmergeは拒否される
    And 追随roundへfindingを載せると予算へ数える旨を名指しして拒否される
    And 実装commitを挟んでからのmergeは拒否される

