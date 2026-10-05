@integration
Feature: lifecycleの競合を担当worktreeへ隔離する
  他のworktreeの停止確認を要求せず、競合する制御資源への書込みだけを排他する。

  Scenario Outline: SCN-INT-LIFEISO-001 他worktreeの状態を担当起動のblockerにしない
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When 先行sessionに"<状態>"を残して"<対象>"worktreeの担当を起動する
    Then lifecycle隔離判定は"<結果>"になる

    Examples:
      | 状態 | 対象 | 結果 |
      | 書込み中 | 別 | allow |
      | 起動待ち | 別 | allow |
      | subagent実行中 | 別 | allow |
      | 古い未完了記録 | 別 | allow |
      | 書込み中 | 同じ | deny |
      | subagent実行中 | 同じ | allow |

  Scenario Outline: SCN-INT-LIFEISO-002 hostの完了証拠で予約を回収する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When "<通知>"で拒否されたツールの予約を回収する
    Then lifecycle隔離判定は"allow"になる

    Examples:
      | 通知 |
      | PermissionDenied |
      | PostToolBatch |

  Scenario: SCN-INT-LIFEISO-003 競合資源だけを保留し無関係な編集を継続する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When 制御資源の競合と安全な並行操作を検査する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-004 不明なpeer状態の影響を制御状態更新へ限定する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When peerの状態を壊して読取と編集の継続範囲を検査する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-005 foreign handoffを無効とせず実行contextの確立を求める
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When foreign handoffの妥当性とhost実行能力を分けて検査する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-006 各worktreeの並行編集とforeign mutationを区別する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When 各workerの編集とforeign worktreeへの直接変更を区別する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-007 stale worktreeが変更先の隔離判定を壊さない
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When 未pruneのworktreeと一覧取得失敗に対する変更先判定を検査する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-008 state異常時もworkerは結果を返却できる
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When active workerのstate破損とlock競合で連絡と結果返却を検査する
    Then lifecycle隔離判定は"allow"になる

  Scenario: SCN-INT-LIFEISO-009 foreign cwdではread分類のGit commandも拒否する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When read分類のGit commandを"別"worktreeの明示実行先で検査する
    Then lifecycle隔離判定は"deny"になる

  Scenario: SCN-INT-LIFEISO-010 自worktreeではread分類のGit commandを継続できる
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When read分類のGit commandを"同じ"worktreeの明示実行先で検査する
    Then lifecycle隔離判定は"allow"になる
