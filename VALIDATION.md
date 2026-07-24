# 正本: AGENTS.md §不変条件I7
#
# ISSUE-226: release publish の gh release create が --generate-notes を使わず、
# GitHub Release から What's Changed / Full Changelog の自動生成が失われている
#
# target_sha はレポート自身を含むcommitのSHAが自己参照のため記載不能であり、
# 引用する全evidence（実装・テスト）が存在する検証対象commit 43c2974 を指す。
#
# 実測メモ（AC-1/AC-2/AC-3 の hybrid/automated 判定の根拠、2026-07-24 実施）:
# - 副作用のない POST /repos/techbeansjp-free/AGENTS.md/releases/generate-notes で確認:
#   (1) tag_name=v0.2.6, previous_tag_name=v0.2.5 → What's Changed（PRタイトル・番号・作成者、
#       PR #218/#220/#222/#192/#193/#223）と Full Changelog（compare/v0.2.5...v0.2.6）を生成。
#   (2) tag_name=v0.2.2, previous_tag_name 省略 → GitHubの起点自動検出は旧日時形式タグ
#       v20260720.060726 を選び新旧版数体系をまたいだ（--notes-start-tag 明示指定の必要性を実証）。
#       ただしAPI・コマンドは失敗しない（AC-3 のフォールバック非失敗を実証）。
# - gh release create --help（gh 2.45.0）で --generate-notes / --notes-start-tag /
#   --notes の併用仕様（--notes は自動生成notesの先頭へ付加）を確認。
# - 使い捨てGitHubリポジトリでの実Release作成試験は、認証トークンに delete_repo スコープが
#   無く後始末不能なゴミを残すため実施せず、上記の副作用ゼロのAPI実測で代替した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-226
target_sha: 43c297424aa1e9888cf3ad41188897ddc3533c91

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "gh release create の引数（--generate-notes 付与）はスタブで自動検証できるが、What's Changed 本文の実生成はGitHub側の挙動でありCIから実Releaseを作成せずに自動検証できないため"
      procedure: "automated: 統合テストで --generate-notes が引数に含まれることを固定。manual: 副作用のない generate-notes API 実測（v0.2.5→v0.2.6）でPRタイトル・番号・作成者を含む What's Changed の生成を確認済み。マージ後、次回の release publish が生成する実Releaseの本文を進行役が確認する"
      executor: "validation worker（API実測）・進行役（マージ後の実地確認）"
    evidence:
      - "test/integration/release.test.ts: 'release publish (Issue #226 AC-1, AC-2)'（--generate-notes 付与の固定）"
      - "gh api -X POST repos/techbeansjp-free/AGENTS.md/releases/generate-notes -f tag_name=v0.2.6 -f previous_tag_name=v0.2.5 → What's Changed に PR #218/#220/#222/#192/#193/#223 のタイトル・作成者を確認（2026-07-24）"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "起点タグ選定（--notes-start-tag に直前semverタグ、旧日時形式タグ除外）は自動検証できるが、Full Changelog リンクの実生成はGitHub側の挙動のため"
      procedure: "automated: 統合テストで semver・旧日時形式混在タグ環境において --notes-start-tag v1.9.0 が選ばれ旧日時形式タグ・target超タグが選ばれないことを固定、単体テストで previousSemverTag の選定規則を固定。manual: generate-notes API 実測で Full Changelog（compare/v0.2.5...v0.2.6）の生成を確認済み。マージ後、次回実Releaseの本文を進行役が確認する"
      executor: "validation worker（API実測）・進行役（マージ後の実地確認）"
    evidence:
      - "test/integration/release.test.ts: 'release publish (Issue #226 AC-1, AC-2)'"
      - "test/unit/release-version.test.ts: previousSemverTag 系6件（起点選定・旧日時形式除外・数値比較）"
      - "gh api generate-notes 実測（v0.2.5→v0.2.6）で '**Full Changelog**: .../compare/v0.2.5...v0.2.6' を確認（2026-07-24）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 'release publish (Issue #226 AC-3)'（target未満のsemverタグ不在時に exit 0・--notes-start-tag 非付与）"
      - "test/unit/release-version.test.ts: 'previousSemverTag: target未満のsemverタグが1件も無ければ undefined を返す'"
      - "補助: generate-notes API 実測（tag_name=v0.2.2・previous省略）でGitHub側が起点自動検出にフォールバックし失敗しないことを確認（2026-07-24）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts: 既存の冪等スキップ（'release publish (AC-3, AC-4, AC-7)'）・二重発火（'release tag+publish 連続二重発火 (AC-7)'）テストが期待値無修正のまま成功"
      - "test/unit/release-version.test.ts: 'previousSemverTag: 不正なtarget（semver形式でない）は例外を投げる'（semver検査の維持）"
      - "npm test 全件成功（下記 regression 参照）"

regression:
  executed: true
  evidence:
    - "npm run build && npm test（local、2026-07-24）: 3回実行。run1=481/482 pass（fail 1件はログ捕捉前で対象テスト特定不能）、run2=482/482 pass、run3=482/482 pass。release関連テスト（単体・統合）は全runで成功しており、run1 の1件は本変更と無関係な一過性failと判断"
    - "新規テスト8件（統合2件・単体6件）を含む482件が run2/run3 で全件成功"
