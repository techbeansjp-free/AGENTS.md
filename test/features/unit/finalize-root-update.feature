@unit @rootupd
Feature: merge後のroot更新と終端処理を安全側に計画する

  Scenario: SCN-UNIT-ROOTUPD-001 cleanな既定branchを検証済みmerge SHAへfast-forwardできる
    Given cleanなroot mainの更新観測がある
    When root更新を計画する
    Then root更新計画はreadyである

  Scenario: SCN-UNIT-ROOTUPD-002 dirty・非既定branch・upstream不明を拒否する
    Given dirty・非既定branch・upstream不明のroot更新観測がある
    When root更新を計画する
    Then root更新計画は3つの安全理由でrejectedである

  Scenario: SCN-UNIT-ROOTUPD-003 remote SHA不一致とdivergedを拒否する
    Given remote SHA不一致かつdivergedなroot更新観測がある
    When root更新を計画する
    Then root更新計画はremote同一性とfast-forward不可を報告する

  Scenario: SCN-UNIT-ROOTUPD-004 既に最新のrootを冪等な完了として扱う
    Given 既にmerge SHAへ到達したroot更新観測がある
    When root更新を計画する
    Then root更新計画はfromとtoが同じreadyである

  Scenario: SCN-UNIT-ROOTUPD-005 対象PR専用worktreeの完全一致だけをcleanup対象にする
    Given 完全一致・prefix一致・大小文字違い・重複のworktree登録がある
    When worktree cleanup対象を計画する
    Then 完全一致1件だけがreadyで他の照合はrejectedである

  Scenario: SCN-UNIT-ROOTUPD-006 canonical Issueだけをclosesで参照する本文を許可する
    Given canonical IssueをCLOSESで後続IssueをRelates toで参照する本文がある
    When Issue終了参照を検証する
    Then canonical Issueだけを自動closeする本文はvalidである

  Scenario: SCN-UNIT-ROOTUPD-007 後続Issueをclosesで参照する本文を拒否する
    Given canonical Issueと後続Issueを終端keywordで参照する本文がある
    When Issue終了参照を検証する
    Then 後続Issueを自動closeする本文はinvalidである
