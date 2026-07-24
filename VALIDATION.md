# 正本: AGENTS.md §不変条件I7
#
# 検証対象: Issue #228「release bump の既存ブランチ再利用が、main 基準で内容を作り直さず
# マージ不能なコンフリクトを生む」の修正（commit a3ceeac）。
#
# 検証手順の概要（実施内容）:
# 1. `git show a3ceeac --stat` および diff を読み、DESIGN.md/PLAN.md の設計要素
#    （detectBumpBaseDivergence / rebuildBumpBranchToMain / bump()既存ブランチ枝への配線）
#    が実装通りに存在することを確認した。
# 2. `npm run build`（tsc）が0エラーで完走することを確認した。
# 3. `npm test`（node --test、test/unit + test/integration 全件）を2回フル実行し、
#    506 tests / 506 pass / 0 fail をいずれの回でも確認した（flaky再現なし）。
# 4. `node --import tsx --test --test-name-pattern="Issue #228" test/integration/release.test.ts`
#    で追加テスト2件を単独実行し、いずれも pass することを確認した。
# 5. 追加テストのアサーション内容をコード読解で確認した：
#    - 乖離ありテストは `release/bump-v0.2.7^`（再構築後コミットのparent）が
#      再取得した `origin/main` の rev-parse 結果と一致することを直接検証しており、
#      「再構築コミットのparentが現行mainであること」を実際に検証している。
#      差分内容（0.2.6→0.2.7）も `git show <sha>:package.json` の version 比較で検証している。
#    - 乖離なしテストは `git ls-remote` で取得したブランチ先端SHAが再実行前後で不変であることを
#      検証しており、再生成・force pushが発生していないことを直接検証している
#      （加えて mergeCalls が2回のみ・prCreateCallsが1回のみであることも検証）。
#    - 乖離ありテストは main を 0.2.5→0.2.6 へ進め target を 0.2.7 としており、
#      実障害（0.2.5→0.2.7のまま main が0.2.6へ進んだ）と同一の版数系列を再現している。
# 6. 実装の else 分岐（乖離検知・再構築の呼び出し）を一時的に no-op コメントへ置換し、
#    再ビルド後に追加テスト2件を再実行した。乖離ありテスト（AC-1/AC-3）は
#    `base乖離時はブランチが再構築され force push で SHA が変化すること` で red になり、
#    修正が実際に効いていることを独立に確認した。乖離なしテスト（AC-2）は
#    元々「再生成が起きないこと」を検証するテストであり、乖離あり枝の無効化では
#    挙動が変わらないため red にならないのは想定通り（乖離なし枝は無変更のため）。
#    確認後、Edit操作を取り消して実装を原状復帰し、`npm run build` 成功・
#    `git status` clean（差分ゼロ）を確認した。
# 7. `git show a3ceeac -- src/commands/release.ts` の diff は追加行のみで構成されており、
#    `checkBumpPrScope`・`findOpenBumpPr`・`gh pr merge --admin` 呼び出し・
#    `!branchExists` 新規作成枝には一切変更が無いことを確認した（AC-4の直接根拠）。
# 8. AC-4（既存挙動の非回帰）は、新規作成テスト・スコープ違反human_requiredテスト・
#    自己修復冪等テスト・identity系テスト（Issue #198）を含む既存 bump 系テストが
#    フルテスト実行（506/506 pass）に包含され、いずれも失敗していないことで確認した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-228
target_sha: a3ceeacc60e45c1dd4c592c4e136777b6332a4ba

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 'release bump base乖離あり (Issue #228 AC-1, AC-3): 既存bumpブランチのbaseが古いmain基準のとき、現行main基準の正しい差分へ作り直してマージする'"
      - "src/commands/release.ts: detectBumpBaseDivergence, rebuildBumpBranchToMain"
      - "red確認: else分岐を一時no-op化した状態で当該テストが 'base乖離時はブランチが再構築され force push で SHA が変化すること' で失敗することを再現し、原状復帰後にnpm run build成功・git status cleanを確認した"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 'release bump base乖離なし (Issue #228 AC-2): 既存bumpブランチのbaseが現行mainと一致するときは再生成・force pushを行わずマージ再試行のみ'"
      - "src/commands/release.ts: detectBumpBaseDivergence が diverged=false を返すとき rebuildBumpBranchToMain を呼ばない分岐"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 乖離ありテスト内で main を 0.2.5→0.2.6 へ進め target=0.2.7 とし、実障害と同一版数系列（0.2.5→0.2.6→0.2.7）を再現し、再構築後の差分が0.2.6→0.2.7へ是正されることを検証している"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（node --test、test/unit + test/integration 全件）: 506 tests / 506 pass / 0 fail を2回のフル実行いずれでも確認（flaky再現なし）"
      - "git show a3ceeac -- src/commands/release.ts の diff が追加行のみで構成され、checkBumpPrScope・findOpenBumpPr・gh pr merge --admin 呼び出し・!branchExists新規作成枝に変更が無いことを確認"

regression:
  executed: true
  evidence:
    - "npm test 1回目: tests 506, pass 506, fail 0, duration_ms 211819.741025"
    - "npm test 2回目: tests 506, pass 506, fail 0, duration_ms 216503.151465"
