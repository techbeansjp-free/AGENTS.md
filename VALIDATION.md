# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-642
target_sha: 11bdeaa8306dc11ea9f58009b178dba8fa0b7dce

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/issue-lifecycle.test.ts::segment start (ISSUE-642 AC-1/AC-6): 全4ロールのcontract末尾に既存条件を保った完了報告手順を付加する"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8): opt-in＋Claude Code判定時はcontract本文を出さずexit 4で監査メタデータを返す（claude分岐のdispatchプロンプトへの報告指示文言・最終応答限定指示の両立を検証）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-647 AC-1/AC-2, ISSUE-609 AC-1): Codexコマンドは対象worktreeへのcdから始まり、別cwdから実行しても対象worktree内でCodexを起動する（codex分岐のdispatchプロンプトへの同旨文言を検証）"
      - "本Issue自体のworker dispatch実行時に配達されたcontract（本validation_workerが実際に受け取ったdispatchプロンプト）に、成果物commit・push後にreport-status.shでcompleted投稿してから最終応答する旨の指示と、既存の最終応答限定指示の両方が含まれていることを実地確認した（本番dispatch経路でのdogfooding確認）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5): 未報告・古い報告・今回の不一致を分離し、今回の一致だけを通す（今回サイクルのcompleted一致ケースがRC=0になることを検証）"
      - "test/integration/worker-adapters.test.ts::claude launch_worker (ISSUE-470 AC-4): 明示opt-out時にWORKER_CMDが成果物commit+push+report completedまで行った場合、exit 0でlease解放・完了確認される（既存成功経路の非回帰）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5): 未報告・古い報告・今回の不一致を分離し、今回の一致だけを通す（staleケース: created_atがDISPATCH_STARTED_ATより前の報告を不合格にすることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-642 AC-4/AC-5): dispatch開始前のcompleted報告を採用せず契約不履行としてblockedへ倒す"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-642 AC-4): DISPATCH_STARTED_AT欠落は監査証跡不備としてblockedへ倒す"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "blocked_reasonの3分岐（未報告/古い報告のみ・今回サイクルのstatus/target_sha不一致・合格）が文言レベルで取り違えを誘発しないことは、自動テストのassert.match/assert.doesNotMatchで機械検証済みだが、文言全体が意図通り『契約不履行の可能性』と『診断的な報告内容の不一致』を一意に区別する自然文になっているかは実装コードの目視確認で最終確認する"
      procedure: |-
        .agent-skill-chain/adapters/claude.sh の _verify_worker_completion_report 関数の3分岐
        （report latest失敗時、created_atが比較基準時刻より前の時、status/target_sha不一致の時）を
        grep -n で列挙し、(a) 「未報告/古い報告のみ」の2分岐がいずれも「workerがreportを投稿して
        いません（契約不履行の可能性）」を含む同系統の文言であり報告済みSHA・現在HEADへの言及を
        含まないこと、(b) 「今回サイクルの不一致」分岐のみが報告status・報告target_sha・現在HEADの
        具体値を含む診断文言であること、(c) 両者が明確に異なる文言であり取り違えを誘発しないことを
        確認した。
      executor: validation_worker (claude)
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5)（staleケースでassert.doesNotMatch(stale.stdout, /報告target_sha=/)、mismatchケースでassert.match(mismatch.stdout, /報告target_sha=old-sha/)を検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-642 AC-4/AC-5)（assert.doesNotMatch(result.stderr, /報告target_sha=/)を検証）"
      - ".agent-skill-chain/adapters/claude.sh の _verify_worker_completion_report 目視確認（3分岐の文言分離、行番号非依存の確認）"

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: "既存completion条件（config/roles.yaml・worker-report.schema.yaml等の構造保持）はAC-IDと1対1対応する自動テストでは検証しづらく、変更差分の直接確認が最も確実であるため"
      procedure: |-
        git diff（本Issue着手直前のmain: 61d0445d8 と実装完了時点: 11bdeaa83 の間）を
        .agent-skill-chain/config/roles.yaml・.agent-skill-chain/schemas/worker-report.schema.yaml・
        .agent-skill-chain/config/agent-skill-chain.yaml の3ファイルに限定して確認し、差分0行
        （変更なし）であることを確認した。あわせて、既存のcommit+push・Draft PR作成条件に依存する
        既存テスト（claude launch_worker成功経路系列、Agent tool dispatch系列）が本Issueの変更後も
        全件成功することを確認した。
      executor: validation_worker (claude)
    evidence:
      - "git diff 61d0445d8..11bdeaa83 -- .agent-skill-chain/config/roles.yaml .agent-skill-chain/schemas/worker-report.schema.yaml .agent-skill-chain/config/agent-skill-chain.yaml （差分0行）"
      - "test/integration/issue-lifecycle.test.ts::segment start (ISSUE-642 AC-1/AC-6): 全4ロールのcontract末尾に既存条件を保った完了報告手順を付加する（各roleのexistingCompletion文言が維持されていることをassert.matchで検証）"

regression:
  executed: true
  evidence:
    - "npm run build (tsc, 成功)"
    - "npm test (node --import tsx --test、test/unit全件＋test/integration全件を対象。1168 tests,
      1168 pass, 0 fail, 0 cancelled, 0 skipped で全件成功を確認した。ISSUE-642固有の新規テスト
      （test/integration/issue-lifecycle.test.ts 1件、test/integration/worker-adapters.test.ts 3件、
      test/integration/report.test.ts 2件のcreated_at出力アサーション追加分）と、本Issueが変更した
      launch_worker/worker-launch-verify.shの既存判定ロジックに依存する既存テスト群（ISSUE-448/
      ISSUE-470/ISSUE-609/ISSUE-647系列を含む）の両方が回帰なく成功することを確認した)"
