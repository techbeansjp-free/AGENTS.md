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

  Scenario: SCN-UNIT-FINALIGN-014 schemaのpatternとruntime述語が同じ入力集合を受理する
    Given schema fileから読み取ったfinalize ignore allowlistのpatternと代表入力集合がある
    When 各schema patternとruntime述語で代表入力集合を判定する
    Then 受理と拒否を含む代表入力集合の判定は全件一致する

  Scenario: SCN-UNIT-FINALIGN-015 ./をschemaとruntimeの双方が拒否する
    Given "./"をfinalize ignore allowlistの入力にする
    When 各schema patternとruntime述語で入力を判定する
    Then schemaとruntimeの双方が入力を拒否する

  Scenario: SCN-UNIT-FINALIGN-016 cache/./をschemaとruntimeの双方が拒否する
    Given "cache/./"をfinalize ignore allowlistの入力にする
    When 各schema patternとruntime述語で入力を判定する
    Then schemaとruntimeの双方が入力を拒否する

  Scenario: SCN-UNIT-FINALIGN-017 2つのschema fileが同一のpatternを持つ
    Given 2つのschema fileからfinalize ignore allowlistのpatternを読み取る
    When 2つのschema patternを比較する
    Then 2つのschema patternは同一である

  Scenario: SCN-UNIT-FINALIGN-018 temporaryArtifactsが配列でないとき拒否する
    Given temporaryArtifactsが配列でないcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-019 temporaryArtifactsが配列でないときの理由が状態不明を示す
    Given temporaryArtifactsが配列でないcleanup入力がある
    When worktree cleanupを計画する
    Then 拒否理由は一時資産があるか状態不明であることを示す

  Scenario: SCN-UNIT-FINALIGN-020 registeredが配列でない既削除入力を拒否する
    Given registeredが配列でない既削除cleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-021 ignoredArtifactsが配列でないとき拒否する
    Given ignoredArtifactsが配列でないcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-022 不正なuntrackedをconsumerAssetsで空配列へ置換しない
    Given untrackedがnullでconsumerAssetsが空のcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-023 不正なtrackedChangesをcleanから安全と推定しない
    Given trackedChangesがnullでcleanなcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-024 不正なignoredPathAllowlistを既定値へ置換しない
    Given ignoredPathAllowlistがnullのcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-025 stashesが配列でないとき拒否する
    Given stashesが配列でないcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-026 remoteBranch不明をpushedから安全と推定しない
    Given remoteBranchが不明でpushed済みのcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-027 不正なtargetAbsentを対象ありへ置換しない
    Given targetAbsentがbooleanでないcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-028 不正なcleanをtrackedChangesがあっても拒否する
    Given cleanがbooleanでなくtrackedChangesがfalseのcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される

  Scenario: SCN-UNIT-FINALIGN-029 不正なconsumerAssetsをuntrackedがあっても拒否する
    Given consumerAssetsが配列でなくuntrackedが空のcleanup入力がある
    When worktree cleanupを計画する
    Then worktree cleanupは拒否される
