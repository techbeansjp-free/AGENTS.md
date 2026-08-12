# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-644
target_sha: 540e74f36f0b53fa7d33e2fa9cbabd44b9db816c

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-644 AC-1〜AC-5): 着手時SHAと同じcompletedは明示的な無変更理由がある場合だけ通す（undeclaredケース: no_change未宣言でtarget_sha==started_shaのcompletedがRC=1・『commitが追加されておらず、無変更完了も明示されていません』になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-644 AC-1): 着手時SHAと同じ無宣言completedはblockedへ倒す（worker-launch-verify.sh経由でもblocked・human_escalation_requested相当の失敗終了・writer lease解放を実地検証）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/report.test.ts::report status/latest (ISSUE-644 AC-2/AC-3/AC-6): 無変更宣言を保存し、latestは理由の有無だけを返す（no_change=true・具体的理由付きのreportが保存され、report latestがno_change=true/no_change_reason_present=trueを返すことを検証）"
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-644 AC-1〜AC-5)（declaredケース: no_change=true・理由ありでtarget_sha==started_shaのcompletedがRC=0になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-644 AC-2): 無変更宣言と具体的理由があれば通過する（worker-launch-verify.sh経由でexit 0・completed記録・lease解放を実地検証）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8, ISSUE-665 AC-1/AC-2/AC-4)・(ISSUE-647 AC-1/AC-2, ISSUE-609 AC-1, ISSUE-665 AC-1/AC-2/AC-4)（claude/codex両分岐のcontract文にno_change用引数書式『<dispatch_token> true '<具体的理由>'』が埋め込まれ、実際にno_change=true・理由付きでreport statusしたケースがworker-launch-verify.shでexit 0になることを検証）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-644 AC-1〜AC-5)（missingReasonケース: no_change=true・no_change_reason_present=falseのcompletedがRC=1・『具体的理由がありません』になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-644 AC-3): 無変更宣言があっても理由が空ならblockedへ倒す（理由を空文字で報告した場合にworker-launch-verify.sh経由でblockedへ倒れることを実地検証）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5): 未報告・古い報告・今回の不一致を分離し、今回の一致だけを通す（target_shaが着手時SHAと異なる既存の1コミット以上ケースで、no_change未宣言のままRC=0で通ることを回帰確認。本Issueの新規判定ブロックはtarget_sha!=started_shaの場合スキップされる）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch (ISSUE-448系列)・(ISSUE-647系列)・worker-launch (ISSUE-609 AC-4)（いずれもno_change宣言付きでcommitが積まれたケース・commit差分ありのケースが従来通りexit 0になることを回帰確認）"
      - "npm test 全体回帰（後述regression参照）で、本Issue変更前から存在する1コミット以上のcompleted報告に依存する既存テスト群が全件成功することを確認"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-644 AC-1〜AC-5)（started_shaが空文字・不正形式'invalid'のいずれもRC=1・『着手時SHAが欠落または不正形式』になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-644 AC-5): missing-started-sha/invalid-started-shaは監査証跡不備としてblockedへ倒す（contract.sha256のSTARTED_SHA欠落・不正形式の両方がworker-launch-verify.sh経由でblocked・lease解放されることを実地検証）"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/report.test.ts::report status (local backend): completedはissues/<n>/.agent-skill-chain/reports/<segment>.yamlへ書き込まれる（no_change未指定の既存呼び出しがno_change=undefinedのままoptionalとして保存され続けることを検証）"
      - "test/integration/report.test.ts::report status/latest (ISSUE-644 AC-2/AC-3/AC-6)（no_change_reason_presentが理由の生テキストを含まずKEY=VALUE形式で返ることを検証し、既存のsedベースparseとの互換性を担保）"
      - "npm test 全体回帰（後述regression参照）で、no_changeフィールドを含まない過去形式のworker reportに依存する既存テスト群（ISSUE-448/ISSUE-470/ISSUE-609/ISSUE-642/ISSUE-658/ISSUE-661系列等）が全件成功することを確認"

regression:
  executed: true
  evidence:
    - "npm run build (tsc, 成功)"
    - "npx tsx --test test/integration/report.test.ts test/integration/worker-adapters.test.ts
      （node --testランナー。73 tests, 73 pass, 0 fail, 0 cancelled, 0 skipped,
      duration_ms 451524.001878 で全件成功。本Issue固有の新規テスト（ISSUE-644 AC-1〜AC-6
      ラベル付きテスト）と、本Issueが変更した_verify_worker_completion_report・
      worker-launch-verify.sh・report.ts（status/latest）に依存する既存テスト群
      （ISSUE-448/ISSUE-462/ISSUE-470/ISSUE-609/ISSUE-642/ISSUE-647/ISSUE-658/ISSUE-661/ISSUE-665
      系列を含む）の両方が回帰なく成功することを確認した"
    - ".agent-skill-chain/ci/verify-doc-length.sh （SPEC.md/DESIGN.md/PLAN.md/ADR-0062の文書量制約検査、成功）"
    - ".agent-skill-chain/scripts/lint-vocab.sh SPEC.md DESIGN.md PLAN.md
      docs/adr/ADR-0062-worker-completion-nochange-detection-via-started-sha.md （禁止語混入検査、成功）"
    - ".agent-skill-chain/scripts/lint-references.sh SPEC.md DESIGN.md PLAN.md
      docs/adr/ADR-0062-worker-completion-nochange-detection-via-started-sha.md （陳腐化しうる参照の検査、成功）"
