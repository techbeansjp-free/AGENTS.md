@unit
Feature: worktree配置を規定rootと命名規則へ拘束する

  Scenario: SCN-UNIT-WTPLACE-001 規定rootの直接の子だけを許可する
    Given 規定root直下の正しいworktree配置がある
    When worktree配置の純粋検証を実行する
    Then worktree配置は有効である

  Scenario: SCN-UNIT-WTPLACE-002 nested path・絶対path・親参照を拒否する
    Given nested pathと絶対pathと親参照のworktree配置がある
    When 不正なworktree path群を純粋検証する
    Then 全ての不正なworktree pathが拒否される

  Scenario: SCN-UNIT-WTPLACE-003 directory名とbranch名の書式をIssue番号とslugへ拘束する
    Given directory名とbranch名がIssue番号またはslugと一致しない配置がある
    When 命名不一致のworktree配置群を純粋検証する
    Then 全ての命名不一致が拒否される

  Scenario: SCN-UNIT-WTPLACE-004 許可されないbranch typeを拒否する
    Given allowlist外のbranch typeを持つworktree配置がある
    When worktree配置の純粋検証を実行する
    Then branch type違反が拒否される

  Scenario: SCN-UNIT-WTPLACE-005 制御文字と非NFC pathを拒否する
    Given 制御文字と非NFC文字を含むworktree pathがある
    When Unicode違反のworktree path群を純粋検証する
    Then 全てのUnicode違反が拒否される

  Scenario: SCN-UNIT-WTPLACE-006 同一Issue・branch・pathの重複とcase・Unicode衝突を拒否する
    Given 同一Issueとbranchとpathの重複およびcaseとUnicode衝突がある
    When 重複する登録済みworktree群を純粋検証する
    Then 全ての重複と衝突が拒否される

  Scenario: SCN-UNIT-WTPLACE-007 対象worktreeの完全一致だけをcleanup対象と判定する
    Given cleanup対象と候補worktreeの一致パターンがある
    When cleanup対象の一致を純粋判定する
    Then pathとbranchが完全一致する候補だけが対象になる

  Scenario: SCN-UNIT-WTPLACE-008 worktree policyをoptionalのままschemaとruntimeで同じく検証する
    Given worktree policyありとなしのmanifestおよび不正値がある
    When worktree policyのschemaとruntime契約を検証する
    Then optionalの後方互換を保ち不正値だけを拒否する
