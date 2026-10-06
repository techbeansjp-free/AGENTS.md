@unit @host-observer
Feature: host observerはSendMessageの再利用だけをadvisoryで警告する

  Scenario: SCN-UNIT-HOSTOBS-001 fresh handoffを既存agentへ送るとfresh mismatch警告を返す
    Given freshContextRequiredがtrueのASC handoffをmessageに含むPreToolUse(SendMessage)入力がある
    And 入力は未知のkeyを含む
    When observerを実行する
    Then exit codeは0である
    And systemMessageはfresh mismatchのowner指定文言と完全一致する
    And additionalContextはworkUnitIdと宛先agent_idを含む
    And 出力はpermissionDecision・decision・continueを含まない
    And AI_AGENTが未検証のhost versionを示す環境でも同じ警告を返す

  Scenario: SCN-UNIT-HOSTOBS-002 terminal済みWork Unitを担当したagentへの送信でterminal reuse警告を返し、両方に該当すればfresh mismatchの1件だけを返す
    Given 宛先agentのsubagent transcript先頭にterminalAfterHandbackがtrueのASC handoffがある
    When messageにASC handoffを含まないSendMessage入力でobserverを実行する
    Then systemMessageはterminal reuseのowner指定文言と完全一致する
    And exit codeは0である
    And AI_AGENTが未検証のhost versionを示す環境でも同じ警告を返す
    When messageにfresh handoffを含むSendMessage入力でobserverを実行する
    Then 警告はfresh mismatchの1件だけである

  Scenario Outline: SCN-UNIT-HOSTOBS-003 対象外・判別不能な入力には何も返さない
    Given <入力>がある
    When observerを実行する
    Then 出力は{}、exit codeは0、stderrは空である

    Examples:
      | 入力                                                                                                        |
      | messageにも宛先transcriptにもASC handoffが無いSendMessage入力                                               |
      | 宛先transcriptが存在しない、またはdirectoryで読めないSendMessage入力                                        |
      | SessionStart・SubagentStart・SubagentStop・PostToolUse・PostToolUseFailure・PreToolUse(Bash)・PreToolUse(Edit)・PreToolUse(Agent)の入力 |
      | tool_input.to・session_id・transcript_pathのいずれかが欠けhandoffを含まないSendMessage入力                  |
      | 判定中に例外が起きる型のworkUnitを持つ入力                                                                  |
      | workUnitIdが16進64桁でない、またはfreshContextRequiredが文字列のhandoffを含むSendMessage入力                |
      | 宛先transcriptの最初のuser行のdispatch promptにASC handoffが無く、後続行とtool_result blockだけにterminal handoffがあるSendMessage入力 |
      | 宛先transcriptのsession_id directoryまたはsubagents directoryがsymlinkで、その先にterminal handoffがあるSendMessage入力 |
      | 4段の入れ子それぞれに63個の未閉鎖の{を持つ7 MB超のmessageを含むSendMessage入力 |
      | 走査文字数または候補数の上限に達した後にだけfresh handoffが現れるSendMessage入力 |

  Scenario: SCN-UNIT-HOSTOBS-004 transcriptとmessageは先頭256 KiBだけを根拠にする
    Given terminal handoffが先頭256 KiB以内にあるtranscriptと256 KiBより後ろだけにあるtranscriptがある
    When それぞれを宛先としてobserverを実行する
    Then 前者だけがterminal reuse警告を返し後者は{}を返す
    When fresh handoffが先頭262144文字以内で終わるmessageと262144文字より後ろで終わるmessageでobserverを実行する
    Then 前者だけがfresh mismatch警告を返し後者は{}を返す

  Scenario: SCN-UNIT-HOSTOBS-005 malformedな入力でもexit 0で何も返さない
    Given 入力が不正JSON、空、JSON配列、数値、1 MiBの不正文字列のいずれかである
    When observerを実行する
    Then 出力は{}、exit codeは0、stderrは空である

  Scenario: SCN-UNIT-HOSTOBS-006 fresh Agent AとBを異なるhost identityとして識別する
    Given EXP-1 fixtureのcoordinatorによるAgent A・Bの起動入力と、それぞれのagentIdがある
    When 各入力でobserverを実行し、Bへfresh handoffをSendMessageする入力でも実行する
    Then A・Bの起動はどちらも{}である
    And AとBのagentIdは異なる
    And Bへの送信の警告はBのagent_idを含みAのagent_idを含まない

  Scenario: SCN-UNIT-HOSTOBS-007 A停止後のresumeをAの再利用として識別する
    Given Aのtranscript先頭にterminal handoffがある
    And EXP-1の同一session内、EXP-3のsession resume後、/compact後のAへのSendMessage入力がある
    When 各入力でobserverを実行する
    Then いずれもterminal reuse警告を返しAのagent_idを付記する

  Scenario: SCN-UNIT-HOSTOBS-008 同じworkUnitIdとhost identityを混同しない
    Given 同じpreview由来の同一workUnitIdのhandoffを渡す2件のPreToolUse(Agent)入力がある
    And 宛先agent_idがworkUnitIdと同じ文字列のSendMessage入力と異なる文字列のSendMessage入力がある
    When observerを実行する
    Then 2件のAgent起動はどちらも{}である
    And 2件のSendMessageの判定結果は同じである

  Scenario: SCN-UNIT-HOSTOBS-009 別worktreeで動くAgentがあっても今回の操作を止めない
    Given EXP-2 fixtureのisolation worktree内Agentの全event入力がある
    When 各入力でobserverを実行する
    Then すべて{}でありpermission系keyを含まない

  Scenario: SCN-UNIT-HOSTOBS-010 別sessionが存在しても止めない
    Given session_idが異なる2件の入力と、別sessionのtranscriptが置かれたdirectoryがある
    When observerを実行する
    Then 出力はpermission系keyを含まず、判定は宛先とhandoffだけで決まる

  Scenario: SCN-UNIT-HOSTOBS-011 SubagentStopが欠落しても次のWork Unitを止めない
    Given EXP-3 fixtureのSubagentStartなしのSubagentStop入力を処理した後である
    When 次のWork UnitのPreToolUse(Agent)入力でobserverを実行する
    Then 出力は{}でありexit codeは0である

  Scenario: SCN-UNIT-HOSTOBS-012 PermissionDenied後も次のWork Unitを止めない
    Given PermissionRequestとPermissionDeniedの入力を処理した後である
    When 次のWork UnitのPreToolUse(Agent)入力とhandoffの無いSendMessage入力でobserverを実行する
    Then どちらも{}である

  Scenario: SCN-UNIT-HOSTOBS-013 旧lifecycle stateや古い完了記録があってもdenyしない
    Given .agent-skill-chain配下に旧lifecycle state fileがあり、古いterminal handoffを持つtranscriptがある
    When fixture全件と警告対象入力でobserverを実行する
    Then どの出力もpermission系keyを含まない
    And 旧state fileを削除して実行した場合と出力が同一である

  Scenario: SCN-UNIT-HOSTOBS-014 同じrelative pathを別worktreeで編集しても拒否しない
    Given 2つのworktreeのcwdで同じrelative pathを対象とするPreToolUse(Edit)とPreToolUse(Write)の入力がある
    When observerを実行する
    Then すべて{}である

  Scenario: SCN-UNIT-HOSTOBS-015 observerはfileを書かず本文を出力しない
    Given fixture全件と警告対象入力がある
    When 実行前後でproject directoryとHOME相当directoryを比較する
    Then 内容は同一である
    And 出力はmessage本文とtranscript本文の文字列を含まない

  Scenario: SCN-UNIT-HOSTOBS-016 observer本体はOS非依存でworkflowから独立し3 OSのCIで実行される
    Given observer本体、workflow・review・deliveryのsource、.github/workflowsの新規workflowがある
    When importとAPI利用とworkflow定義を静的に検査する
    Then observerのimportはnode:fs、node:path、node:process、node:cryptoに限られchild_processと固定temp pathを含まない
    And workflow・review・deliveryのsourceはobserverを参照しない
    And 新規CI workflowはubuntu-latest、macos-latest、windows-latestでshellを介さずobserverのportable testを実行し、読取権限だけを持つ

  Scenario: SCN-UNIT-HOSTOBS-017 Probe fixtureとCapability Matrixが秘密を含まず再確認できる
    Given test/fixtures/host-observer/claude-code-2.1.282/の3 fileとdocs/specsのCapability Matrixがある
    When 内容を機械検査する
    Then 3 fileが存在し、絶対path・環境変数・PID・prompt本文を含まない
    And PreToolUse(SendMessage)のeventはtool_inputのkey名と型を保持しtoとmessageが文字列である
    And Matrixはhost version 2.1.282を記録している

  Scenario: SCN-UNIT-HOSTOBS-018 識別子形式外の宛先ではtranscriptを読まない
    Given tool_input.toまたはsession_idが..、path区切り、空、129文字の入力がある
    When observerを実行する
    Then transcriptを読まず出力は{}である

  Scenario: SCN-UNIT-HOSTOBS-019 REQ-WF-1546は実在しないSCNと削除済み機構を参照しない
    Given docs/specs/02_要件のREQ-WF-1546節と要件一覧の同行がある
    When 引用されたSCN IDを抽出する
    Then すべてtest/featuresに実在しSCN-INT-AGENTLIFE-を含まない
