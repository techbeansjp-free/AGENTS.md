# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-470
target_sha: 2bc5266a3a6e764775553bbdd8aa8612c2a38f97

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/config.test.ts:38（loadConfig (AC-6)テストで config.worker.agent_tool_dispatch.enabled === true を確認）"
      - "test-run: node --import tsx --test $(find test/unit test/integration -name '*.test.ts') → tests 885, pass 885, fail 0"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/worker-selection.test.ts:87-91（resolveWorkerSelection (ISSUE-448 AC-8): agent_tool_dispatch.enabled=trueをtrueとして解決する）"
      - "test/integration/worker-adapters.test.ts:257-320（Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8): opt-in＋Claude Code判定時はcontract本文を出さずexit 4で監査メタデータを返す。setWorkerAgentToolDispatch(true)明示設定だが分岐ロジック自体は変更されておらず新既定値と同一の解決結果に到達することを検証）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts:516-560（claude launch_worker: WORKER_CMD未指定時の既定起動は...(ISSUE-183 AC-1/AC-2)。setupWorkerIssue()は本リポジトリの実効config（agent_tool_dispatch.enabled: true）をそのまま複製し、envはCLAUDECODE/ASC_ORCHESTRATOR_SESSION_OVERRIDE未設定のためClaude Code CLIセッション判定はfalseとなり、既定trueのままheadless起動が選択されることを実証）"
      - "test/integration/worker-adapters.test.ts:226-240（Claude Codeセッション判定 (ISSUE-448 AC-7）: CLAUDECODE未設定はfalseへ倒す、が変更なしのまま維持されていることを確認）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/worker-selection.test.ts:80-85（resolveWorkerSelection (ISSUE-448 AC-8): agent_tool_dispatch.enabled=falseをfalseとして解決する。厳密等価比較ロジックが既定値変更と独立していることを純粋関数レベルで確認）"
      - "test/integration/worker-adapters.test.ts:413-450（claude launch_worker (ISSUE-470 AC-4): 明示opt-out時にWORKER_CMDが成果物commit+push+report completedまで行った場合、exit 0でlease解放・完了確認される。新設）"
      - "test/integration/worker-context.test.ts:127-137（worker context (ISSUE-470 AC-4): 明示opt-outをagent_tool_dispatch=falseとして常に出力する。新設、CLI出力経由の回帰確認）"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "schema例示文とMarkdown手順書の記述整合は構造化バリデーション対象外（config.schema.yamlのtype: boolean自体は変更しておらず自動検証済み）であり、文意が実効設定の新既定値と矛盾しないことの確認は人手の読解を要する。"
      procedure: ".agent-skill-chain/schemas/config.schema.yaml のexamples[0]・examples[1]内 `agent_tool_dispatch: {enabled: true}` が実効設定 .agent-skill-chain/config/agent-skill-chain.yaml の値と一致することを目視確認。.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md の目的・前提節が「既定値false」から「既定値true・明示falseでopt-out可能」という記述へ更新され、AC-4の挙動（明示false時は引き続きheadless）と矛盾しないことを目視確認。"
      executor: validation_worker（Claude Sonnet 5）
    evidence:
      - "commit 2bc5266a: .agent-skill-chain/schemas/config.schema.yaml examples[0]/[1] を agent_tool_dispatch: {enabled: true} へ更新"
      - "commit 2bc5266a: .agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md の既定値記述を true へ更新（3・12行目）、明示false時のフォールバック説明は保持"
      - "grep -n 'agent_tool_dispatch' .agent-skill-chain/schemas/config.schema.yaml .agent-skill-chain/config/agent-skill-chain.yaml → 全箇所 true で一致（矛盾なし）"

regression:
  executed: true
  evidence:
    - "npm run typecheck（tsc --noEmit -p tsconfig.test.json）→ エラー無し"
    - "npm run build（tsc）→ エラー無し"
    - "test-run: node --import tsx --test $(find test/unit test/integration -name '*.test.ts') → tests 885, suites 0, pass 885, fail 0, cancelled 0, skipped 0"
    - ".agent-skill-chain/ci/verify-doc-length.sh → exit 0"
    - ".agent-skill-chain/scripts/adr-lint.sh check → exit 0"
    - ".agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0035-agent-tool-dispatch-default-enabled.md → exit 0"
    - "既知の恒久赤（本Issueのスコープ外・PR #475コメントで報告済み）: .agent-skill-chain/scripts/lint-vocab.sh が src/lib/review-light.ts:60 の gh(['issue','view',...]) を禁止語誤検知で失敗する。mainから継承した既存の問題であり、当該ファイルは本Issueの変更差分に含まれない（git log -- src/lib/review-light.ts の最新変更は#460由来でISSUE-470と無関係）。"
