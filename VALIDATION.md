# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-661
target_sha: 81e77e50f9445eb415fe253584cfa572a88c0cac

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-661 AC-1): 別dispatchサイクルは一致しないトークンを発行する（同時に開始した2つのdispatchサイクルのDISPATCH_TOKENが不一致になることを検証。headless経路（launch_worker）も同一のmktemp基盤の一意性保証を再利用しており、生成箇所の実装は共通のプリミティブに依拠する）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8): opt-in＋Claude Code判定時はcontract本文を出さずexit 4で監査メタデータを返す（claude分岐のprompt:行に『今回のdispatchトークンは<値>』『completed <push済みHEAD> \\'\\' \\'\\' <値>』が含まれ、既存のreport-status.sh実行指示・最終応答限定指示が維持されたままであることを検証）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-647 AC-1/AC-2, ISSUE-609 AC-1): Codexコマンドは対象worktreeへのcdから始まり、別cwdから実行しても対象worktree内でCodexを起動する（codex分岐のprompt:行への同旨のトークン埋め込みを検証）"
      - "test/integration/worker-adapters.test.ts::claude launch_worker (ISSUE-470 AC-4): 明示opt-out時にWORKER_CMDが成果物commit+push+report completedまで行った場合、exit 0でlease解放・完了確認される（headless経路でworkerへ渡るcontract本文にworker_completion_dispatch:／dispatch_token:行が追記されていることを検証）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/report.test.ts::report status/latest (ISSUE-661 AC-3/AC-8, local backend): dispatch_tokenを欠落・改変なく保存して出力する"
      - "test/integration/report.test.ts::report status (github backend): Issueコメントとして固定スキーマのworker reportを投稿する（Issueコメント本文へのdispatch_token保存、report latestでの読み出しを検証）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5): 未報告・古い報告・今回の不一致を分離し、今回の一致だけを通す（今回サイクルのトークンと一致するcompleted報告のみRC=0になることを検証）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8)・(ISSUE-647 AC-1/AC-2, ISSUE-609 AC-1)（claude分岐・codex分岐とも一致するトークンでreport completed後にworker-launch-verify.shがexit 0で通ることを実地検証）"
      - "test/integration/worker-adapters.test.ts::claude launch_worker (ISSUE-470 AC-4)（headless経路でも一致するトークンでexit 0となることを検証）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-661 AC-5/AC-6): 同一HEADの過去サイクルcompleted報告をトークン不一致でblockedへ倒す（target_shaが変化していない状態で前サイクルのdispatch_tokenを含むcompleted報告が存在しても、新サイクルのトークンと不一致のためblocked判定となることを検証）"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-661 AC-6): DISPATCH_TOKEN欠落は監査証跡不備としてblockedへ倒す"
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5)（dispatch_token=空文字の報告がRC=1・『dispatchトークン不一致』文言になることを検証）"

  - ac_id: AC-7
    verification:
      mode: manual
      result: pass
      reason: "既存completion条件（config/roles.yamlのrole_contracts.*.completion、worker-report.schema.yamlの既存requiredフィールド）が変更・弱化されていないことは、AC-IDと1対1対応する専用の自動テストでは検証しづらく、変更差分の直接確認が最も確実であるため"
      procedure: |-
        本Issueのbranch分岐元（origin/mainのmerge-base: 93b8499f6）と実装完了時点（81e77e50f）
        の間のgit diffを、.agent-skill-chain/config/roles.yaml・.agent-skill-chain/config/
        agent-skill-chain.yaml・.agent-skill-chain/schemas/worker-report.schema.yamlの3ファイルに
        限定して確認した。roles.yaml・agent-skill-chain.yamlは差分0行（変更なし）。
        worker-report.schema.yamlはdispatch_tokenプロパティの追加のみで、既存のrequired配列
        [schema_version, issue_id, role, segment, status, target_sha]は変更されていないことを
        確認した。あわせて、dispatch_token未指定の既存呼び出しが引き続き有効であること
        （report.test.tsの回帰テスト）、既存のcommit+push・完了報告に依存する既存成功経路
        （ISSUE-448/ISSUE-470/ISSUE-609/ISSUE-647系列のテスト）が本Issueの変更後も全件成功する
        ことを確認した。
      executor: validation_worker (claude)
    evidence:
      - "git diff 93b8499f6..81e77e50f -- .agent-skill-chain/config/roles.yaml .agent-skill-chain/config/agent-skill-chain.yaml （差分0行）"
      - "git diff 93b8499f6..81e77e50f -- .agent-skill-chain/schemas/worker-report.schema.yaml （dispatch_token追加のみ、requiredフィールドは非変更）"
      - "test/integration/report.test.ts::report status (local backend): completedはissues/<n>/.agent-skill-chain/reports/<segment>.yamlへ書き込まれる（dispatch_token未指定の既存呼び出しは引き続き有効であることを検証）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/report.test.ts::report status/latest (ISSUE-661 AC-3/AC-8, local backend): dispatch_tokenを欠落・改変なく保存して出力する（ローカルモードの1 segment 1 file構造でのdispatch_token保存・読み出しを検証）"
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5)（_verify_worker_completion_reportはCoordination Backendの種別を意識せずreport latestの出力のみを判定するため、本テストの検証はローカル・GitHub両モードへ等しく適用される）"

regression:
  executed: true
  evidence:
    - "npm run build (tsc, 成功)"
    - "npm test (node --import tsx --test、test/unit全件＋test/integration全件を対象。1173 tests,
      1173 pass, 0 fail, 0 cancelled, 0 skipped, duration_ms 733827.587515 で全件成功。
      test-execution.log（gitignore対象、ローカル保存）に実行結果を保存した。
      本Issue固有の新規テスト（test/integration/worker-adapters.test.ts の ISSUE-661 AC-1/AC-5/
      AC-6ラベル付きテストおよびISSUE-448/ISSUE-647系列テストへのdispatch_tokenアサーション追加、
      test/integration/report.test.ts の ISSUE-661 AC-3/AC-8ラベル付きテスト）と、本Issueが変更
      した_verify_worker_completion_report・worker-launch-verify.sh・report.tsに依存する既存
      テスト群（ISSUE-448/ISSUE-470/ISSUE-609/ISSUE-642/ISSUE-647/ISSUE-658系列を含む）の両方が
      回帰なく成功することを確認した"
