# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。
#
# 注意: src/commands/verify.ts の acCoverage() は本ファイル全体を単一の
# YAML文書として readYamlFile() で読み込む。Markdown見出しや複数の
# ```yaml``` フェンスを混在させると parse() が失敗するため、本ファイルは
# 常に純粋なYAMLとして記述し、見出し相当の情報はコメント（#）で表現する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-487
target_sha: b6446262f7b09e0e1b783fb1b8b56ef18ae70cd4

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 文字列リテラル内のコメント記号を無視し、実コメントだけをコメント開始と判定する（Issue #487 AC-1〜AC-4）' の cleanCases['comment-marker-in-string.ts'] ケース（URL文字列リテラル内の`//`後方にある配列要素`'issue'`が誤検出されないことを確認、exit code 0・stderr空）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 'lint vocab: 非散文ファイルの単一行コメント中にある禁止語リテラルを検出する（Issue #484 AC-1・AC-2）'（既存テスト、非退行として無変更のまま合格）"
      - "test/integration/lint.test.ts: 同AC-1〜AC-4テストのmixedケース後半（'quoted-literal-before-comment.ts'の実コメント中の禁止語 'issue' が引き続き違反として報告されることを確認）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 同AC-1〜AC-4テストのmixedケース（'quoted-literal-before-comment.ts': コード値リテラル`['issue']`は除外・後続の実コメント中の`'issue'`のみ1件報告されることをstderr行数1で確認）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/lint.test.ts: 同AC-1〜AC-4テストのcleanCases['comment-marker-in-string.sh'/'comment-marker-in-string.yaml'/'comment-marker-in-string.yml']ケース（`#`を含むURLフラグメント文字列リテラル後方のコード値リテラルが誤検出されないことを確認、各exit code 0・stderr空）"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "修正前後のコミット間でのリポジトリ全体の禁止語違反件数比較は、単発の自動テストケースではなく歴史的コミットのビルド・実行を伴う横断比較であり、既存の自動テストスイートの対象外のため手動実行で担保する。"
      procedure: "1) 一時worktree（/tmp/wt-487-before）を修正直前commit（b6446262の親、2b98e423design）にcheckoutしnpm ci && npm run buildで構築。2) 当該worktreeで.agent-skill-chain/scripts/lint-vocab.shを実行しexit code・違反件数を記録（修正前）。3) 本worktree（target_sha b6446262、修正後）でも同スクリプトを実行しexit code・違反件数を記録（修正後）。4) 両者を比較し、修正後に新規の禁止語違反が増えていないことを確認。5) 一時worktreeをgit worktree remove --forceで削除。"
      executor: validation_worker
    evidence:
      - "修正前（commit 2b98e423, /tmp/wt-487-before）: exit code 0, 違反0件（/tmp/lint-before.txt、0行）"
      - "修正後（commit b6446262、本worktree）: exit code 0, 違反0件（/tmp/lint-after.txt、0行）"
      - "test/integration/lint.test.ts: 既存の全lint関連テスト（Issue #178/#187/#283/#469/#484含む）が非退行で合格（`node --import tsx --test test/integration/lint.test.ts` 実行結果: tests 20, pass 20, fail 0）"

regression:
  executed: true
  evidence:
    - "npm run typecheck: 成功（tsc --noEmit -p tsconfig.test.json、エラー0件）"
    - "node --import tsx --test test/integration/lint.test.ts: tests 20, pass 20, fail 0"
    - "npm test（本worktree全体のunit/integration自動テストスイート）: tests 900, pass 900, fail 0（duration_ms 446903.757814）"
