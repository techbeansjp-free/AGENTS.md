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

  Scenario: SCN-UNIT-REVIEWCONV-004 3 round後も未解決なら自動scope拡大せず終了する
    Given 固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある
    When 同じHigh findingをround 3まで未解決にする
    Then review sessionはbudget-exhaustedになる
    And round 4への自動継続を拒否する

  Scenario: SCN-UNIT-REVIEWCONV-005 収束後の実commitだけを同digest chainで再reviewする
    Given findingなしでround 1が収束したreview sessionがある
    When 収束HEAD後に実commitを追加しround 2で再reviewする
    Then review sessionはround 2で再収束する
    When 同じHEADをround 3として追記する
    Then review session更新は同じHEADと空fixedDiffで拒否される
