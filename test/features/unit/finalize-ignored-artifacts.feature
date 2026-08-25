@unit
Feature: worktree finalizeのignore対象を安全に判定する

  Scenario: SCN-UNIT-FINALIGN-001 allowlist内のignore対象だけを持つworktreeを削除可能とする
    Given dist生成物だけを持つ安全なfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then finalize reportは安全である

  Scenario: SCN-UNIT-FINALIGN-002 allowlist外のignore対象があるworktreeを拒否する
    Given allowlist外の.envを持つ安全なfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then finalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-003 拒否理由へ該当pathを列挙する
    Given allowlist外の.envを持つ安全なfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then 拒否理由に.envのpathを含む

  Scenario: SCN-UNIT-FINALIGN-004 allowlist内のpathを拒否理由へ含めない
    Given dist生成物とallowlist外の.envを持つ安全なfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then 拒否理由にdistのpathを含まない

  Scenario: SCN-UNIT-FINALIGN-005 未commitの追跡対象fileがあれば拒否する
    Given 未commitの追跡対象fileを持つfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then 未commit理由でfinalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-006 未pushのcommitがあれば拒否する
    Given 未pushのcommitを持つfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then 未push理由でfinalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-007 到達不能commitがあれば拒否する
    Given 到達不能commitを持つfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then 到達不能理由でfinalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-008 stashがあれば拒否する
    Given stashを持つfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then stash理由でfinalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-009 PR未mergeなら拒否する
    Given PR未mergeのfinalize状態がある
    When ignore対象を含むfinalize reportを作成する
    Then PR未merge理由でfinalize reportは拒否される

  Scenario: SCN-UNIT-FINALIGN-010 allowlistの既定値にnode_modulesとdistが含まれる
    Given package既定のfinalize ignore allowlistがある
    When finalize ignore allowlistを解決する
    Then node_modulesとdistを含む

  Scenario: SCN-UNIT-FINALIGN-011 利用projectがallowlistを追加できる
    Given 利用projectがcache directoryをallowlistへ追加する
    When project policy manifestをruntime検証する
    Then 追加allowlistを持つmanifestは有効である

  Scenario: SCN-UNIT-FINALIGN-012 allowlistへ過度に広いpatternを宣言できない
    Given 利用projectがglob patternをallowlistへ追加する
    When project policy manifestをruntime検証する
    Then 過度に広いallowlistはschemaとruntime検証で拒否される

  Scenario: SCN-UNIT-FINALIGN-013 surveyとfinalizeが同じ判定を返す
    Given 同じignore対象を持つsurvey観測とfinalize状態がある
    When surveyとfinalizeの共通判定を実行する
    Then surveyとfinalizeの安全判定は一致する
