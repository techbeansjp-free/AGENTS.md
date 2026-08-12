# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-671
target_sha: 1167a10391f029ddd4271efac37e2d1bcb149124

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告祖先判定 (ISSUE-671 AC-1〜AC-4): 子孫だけを通し、別系統と判定不能は理由を分けて拒否する（started_shaの祖先でない別系統commit（unrelatedSha、`git commit-tree`で作成）をtarget_shaとする報告がstatus=1・『祖先ではありません（rollback・履歴書き換えの可能性）』になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-671 AC-1/AC-2/AC-4): unrelatedはblocked＋lease解放へ倒す（worker-launch-verify.sh経由でexit 2・stderrに『祖先ではありません（rollback・履歴書き換えの可能性）』・worker reportがstatus=blocked/human_escalation_requested=true・writer leaseファイル削除済みであることを実地検証）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告祖先判定 (ISSUE-671 AC-1〜AC-4)（AC-1と同一の`git merge-base --is-ancestor`不成立分岐を共有する。unrelatedSha（started_shaを含まない別系統の新規履歴）を用いたケースで検証、rebase/amend後の非祖先SHAと機械的に同一の判定経路であることをDESIGN.mdの設計要素対応表で確認）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-671 AC-1/AC-2/AC-4)（同上、unrelatedケースを共有）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告祖先判定 (ISSUE-671 AC-1〜AC-4)（started_shaの子孫commitをtarget_shaとするdescendantケースがstatus=0で通過することを検証）"
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-642 AC-3/AC-4/AC-5)・完了報告鮮度判定 (ISSUE-658 AC-1/AC-2/AC-3)（いずれもadvanceWorkerHead()で得たstartedSha/headを明示的に渡す形へ本Issueで是正済みの回帰ケース。started_shaの正当な子孫commitに対する既存の完了確認成功パスが本Issue適用後も維持されることを検証）"
      - "test/integration/worker-adapters.test.ts::Agent tool dispatch系列・worker-launch (ISSUE-448/ISSUE-609/ISSUE-642/ISSUE-644/ISSUE-647/ISSUE-658/ISSUE-661/ISSUE-665系列)（started_shaの上に1つ以上commitが積まれた既存の正当な完了報告ケースが、本Issueが追加した祖先関係検証ブロックの新設後もexit 0のまま回帰しないことをnpm test全体で確認）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告祖先判定 (ISSUE-671 AC-1〜AC-4)（started_shaに実在しないobject（'0'を40桁繰り返した文字列）を渡すunavailableケースがstatus=1・『祖先関係を判定できませんでした』になることを検証）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-671 AC-1/AC-2/AC-4)（missing-objectケースがworker-launch-verify.sh経由でexit 2・stderrに『祖先関係を判定できませんでした』・blocked＋lease解放を実地検証）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts::完了報告共通判定 (ISSUE-644 AC-1〜AC-5): 着手時SHAと同じcompletedは明示的な無変更理由がある場合だけ通す（reported_sha == started_shaの既存no_change判定ケース群が本Issue適用後も従来通りの結果（undeclared=RC1・declared=RC0・missingReason=RC1）を維持することを回帰確認。本Issueの祖先関係検証ブロックはreported_sha != started_shaの`else`側にのみ追加されており、この分岐には到達しない）"
      - "test/integration/worker-adapters.test.ts::worker-launch-verify (ISSUE-644 AC-1/AC-2/AC-3)（同上、worker-launch-verify.sh経由の無変更completed判定が本Issue適用後も回帰しないことを実地検証）"

regression:
  executed: true
  evidence:
    - "npm run build (tsc, 成功)"
    - "npm test（package.jsonのtestスクリプト。node --importでtsxを読み込むnode --testランナーで
      test/unitとtest/integration配下の全*.test.tsを実行。1184 tests, 1184 pass, 0 fail,
      0 cancelled, 0 skipped, duration_ms 829462.606049 で全件成功。本Issue固有の新規テスト
      （test/integration/worker-adapters.test.ts『完了報告祖先判定 (ISSUE-671 AC-1〜AC-4)』・
      『worker-launch-verify (ISSUE-671 AC-1/AC-2/AC-4)』の2グループ・計4アサーションブロック）と、
      本Issueが変更した_verify_worker_completion_report（.agent-skill-chain/adapters/claude.sh）に
      依存する既存テスト群（ISSUE-448/ISSUE-462/ISSUE-609/ISSUE-642/ISSUE-644/ISSUE-647/ISSUE-658/
      ISSUE-661/ISSUE-665系列を含む）を含め、リポジトリ全体の回帰が無いことを確認した"
    - ".agent-skill-chain/ci/verify-doc-length.sh （SPEC.md/DESIGN.md/PLAN.md/ADR-0063の文書量制約検査、成功）"
    - ".agent-skill-chain/scripts/lint-references.sh SPEC.md DESIGN.md PLAN.md
      docs/adr/ADR-0063-worker-completion-report-ancestor-verification.md （陳腐化しうる参照の検査、成功）"
    - ".agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0063-worker-completion-report-ancestor-verification.md （ADR形式検査、成功）"
    - "既知の懸案（AC非対応・自動passにはしていない）: .agent-skill-chain/scripts/lint-vocab.sh
      SPEC.md DESIGN.md PLAN.md docs/adr/ADR-0063-worker-completion-report-ancestor-verification.md
      を実行すると、DESIGN.md:69 と ADR-0063:98 に禁止語『作業ディレクトリ』（正: worktree、
      docs/GLOSSARY.md）の混入が検出される（exit 1）。lint-vocab.shのCI既定対象
      （defaultVocabFileRoots）はSPEC/DESIGN/PLAN/docs/adr/を含まないためPRのCheck Run
      『lint-vocab』はこの混入を検出せず成功しているが、本Issueの成果物として事実を記録する。
      本Issueのvalidation workerはSPEC.md/DESIGN.md/PLAN.mdの編集を禁じられており（contract.md
      forbidden）、この語法問題はAC-1〜AC-5のいずれにも対応しない設計文書の用字選択に閉じるため
      修正を行わず、進行役への引き継ぎ事項として記録するに留めた"