@unit
Feature: decision invoke（Decision Type Registryの実行、Issue #1485）

  Scenario: SCN-UNIT-DECINV-001 DCAND-001は既存関数と同じ結果を返す（挙動不変）
    Given quick失格分類が検出されるchangedFilesを持つdecision invoke入力がある
    When invokeDecisionを実行する
    Then resolverOutputはdetectQuickDisqualifiersの直接呼び出しと一致する

  Scenario: SCN-UNIT-DECINV-002 DCAND-008は最新HEADの明示的なlimit観測をauthoritativeに確定する
    Given 最新HEADにrate limit観測を持つDCAND-008入力がある
    When invokeDecisionを実行する
    Then authorityModeはauthoritativeでeffectiveValueは"confirmed-limited"である

  Scenario: SCN-UNIT-DECINV-003 DCAND-008は確定できない場合providerへadvisoryで委譲する
    Given 最新HEADの観測が無いDCAND-008入力がありproposedValueを渡す
    When invokeDecisionを実行する
    Then authorityModeはadvisoryでexecutorはproviderになる

  Scenario: SCN-UNIT-DECINV-004 applyすると同じ根で読み返せるjournal recordが残る
    Given confirmedByを含むDCAND-006入力がある
    When invokeDecisionをapplyつきで実行する
    Then primaryRootのdecision journalへ同じdecisionRecordIdの記録が読み返せる

  Scenario: SCN-UNIT-DECINV-005 自己申告のcandidateHeadShaは実HEADと不一致だと拒否される
    Given 実HEADと異なるcandidateHeadShaを持つdecision invoke入力がある
    When invokeDecisionを実行する
    Then エラーで拒否される

  Scenario: SCN-UNIT-DECINV-006 連結worktreeから実行してもjournalはprimaryRootへ書かれる
    Given 連結worktreeのstagingでDCAND-006入力がある
    When 連結worktreeでinvokeDecisionをapplyつきで実行する
    Then journalは連結worktreeでなくprimaryRoot配下に作られる

  Scenario: SCN-UNIT-DECINV-007 constrained-choiceで候補集合外を選ぶとrejectedになる
    Given 候補集合外の提案を持つDCAND-009入力がある
    When invokeDecisionを実行する
    Then rejectedである

  Scenario: SCN-UNIT-DECINV-008 DCAND-009はPolicy Allowed外だけの候補集合を拒否する
    Given Policy Allowed外の値だけを宣言したDCAND-009入力がある
    When invokeDecisionを実行する
    Then エラーで拒否される

  Scenario: SCN-UNIT-DECINV-009 DCAND-009は呼び出し側が宣言したPolicy Allowed外の値を候補集合へ混入させても採用しない
    Given Policy Allowed外の値を混入させたcandidateSetとそれに一致するproposedValueを持つDCAND-009入力がある
    When invokeDecisionを実行する
    Then rejectedである
