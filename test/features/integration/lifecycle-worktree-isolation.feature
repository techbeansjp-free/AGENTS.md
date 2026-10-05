@integration
Feature: lifecycleの競合を担当worktreeへ隔離する
  他のworktreeの停止確認を要求せず、同じworktreeの書込みだけを排他する。

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
      | subagent実行中 | 同じ | deny |

  Scenario Outline: SCN-INT-LIFEISO-002 hostの完了証拠で予約を回収する
    Given lifecycle隔離用の2つのGit worktreeとsessionがある
    When "<通知>"で拒否されたツールの予約を回収する
    Then lifecycle隔離判定は"allow"になる

    Examples:
      | 通知 |
      | PermissionDenied |
      | PostToolBatch |
