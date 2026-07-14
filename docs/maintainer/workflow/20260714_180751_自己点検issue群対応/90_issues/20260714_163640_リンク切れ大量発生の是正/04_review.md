---
document_id: "8a27756b-944b-4f7e-82b4-bcb3293f97a6"
---

# レビュー記録: リンク切れ大量発生の是正

**プロジェクト名**: リンク切れ大量発生の是正
**レビュー日**: 2026 年 07 月 15 日
**フェーズ**: verify-and-close（opus ティア。設計・実装の最終検証）

> 本 issue は 164050（行番号相互参照の脆弱性是正）と**同一 PR・同一 worktree**（`worktree-agent-adf0b84c62a94c8b5`）で対応した。本 04 に主たる検証結果を記載し、164050 の 04 は本書を参照する。

---

## 受け入れ基準の確認（01 §4 BDD）

| シナリオ | 検証方法 | 結果 |
| --- | --- | --- |
| A: 既知の指摘箇所が解決可能 | `check-relative-links.sh .`（アンカー検査 ON） | PASS。走査 117 ファイル / リンク 438 件 / **切れ 0 件**（exit 0） |
| B: 検査スクリプトが誤検出しない | inline code / fenced code 内の `](...)` を除外実装。`自己拡張ワークフロー.md` の inline code 行が非計上 | PASS。誤検出 1 件（設計時に把握した inline code）を再現せず |
| C: CI が非ブロッキング | `self-enforce.yml` に step #9 追加（`continue-on-error: true`・`|| echo` フォールバック） | PASS。YAML 構文検証（`yaml.safe_load`）通過。既存 step と一貫 |
| D: 配備後階層変化の扱いが記録される | `.claude/skills/` へフラット単体コピーされる 4 SKILL.md（agent, write-bdd, review-architecture, review-code）の相対リンクをパス表記の非リンク誘導へ変更 | PASS。該当 4 件を変更、実行記録に反映 |

## 実装内容の確認（コードレビュー）

- **検査スクリプト新設** `.agent-skill-chain/source/scripts/check-relative-links.sh`（read-only, `set -euo pipefail`, 終了コード契約 0/1/2, `--check-anchors` 既定 ON, `--no-check-anchors` 対応）。`bash -n` 構文チェック通過。スラッグ化は GitHub 準拠（whitespace→`-`, ASCII 英数小文字化, 非 ASCII 保持, 重複 slug に `-N` 付番）で 164050 のアンカー参照と整合。
- **リンク切れ 28 件をパターン別 sed で是正**（Grp A〜F）。各 sed は「リンク文字列パターン」で特定（行番号非依存）。修正差分はリンク文字列のみで本文改変なし。
- **CI 非ブロッキング step 追加**。run ブロックに外部ドキュメント名・章節番号・追跡番号の直書きなし（`check-comment-refs.sh` 抵触なし）。
- **検証の再現**（verify-and-close で再実行）:
  - `check-relative-links.sh .`（ON）→ 切れ 0 件、`--no-check-anchors` → 切れ 0 件。
  - `test/run-all.sh` → 合計 21 / PASS 15 / FAIL 0 / SKIP 6（新規 FAIL なし）。
  - `audit.sh .` → 本 issue 由来の新規 FAIL なし（下記「境界の確認」参照）。

## 設計・境界の確認（アーキテクチャレビュー）

- **境界の一貫性**: 検査ロジックは `check-relative-links.sh` に集約し、CI とローカルで二重定義しない（既存 `check-hook-drift.sh`・`check-comment-refs.sh` と同じ集約方針）。
- **スコープ遵守**: `close/` 配下・配備物（`.claude/`・`.cursor/`・`.adapters/`）は対象外。生成物の階層問題は FR-4 の文言誘導で回避し、生成物自体は改変していない。
- **164050 との実行順依存**: `自己拡張ワークフロー.md` はパス是正（本 issue Grp A）→アンカー化（164050）の順で処理済み。競合なし。

### 敵対的観点リスト（このレビューで能動的に疑った点）

- **sed 過修正リスク**: パターン置換が意図外の箇所を書き換えていないか → `git diff main..HEAD` で差分がリンク文字列のみであることを確認。本文・見出し・コードは不変。
- **アンカー検査の偽陰性**: `--check-anchors` が壊れたアンカーを見逃していないか → verify で既存の壊れアンカー（DESIGN.md#…）を実際に検出できることを確認（下記スコープ判断参照）。修正後 0 件へ。
- **CI 二重赤化リスク**: 非ブロッキング step が既存の blocking step を巻き込まないか → `continue-on-error: true` + `|| echo` の二重フォールバックで独立。YAML 構文も検証済み。
- **配備後解決不能の見落とし**: `.claude/skills/` 以外にも階層が変わる配備先がないか → 対象 SKILL.md 群のみが該当と確認、他は正本内で相対解決可能。

### must-preserve リスト（変更してはならない不変条件・維持を確認）

- リンク先ファイル本体（`run_command.md`・`TEMPLATES.md`・`IO_CONTRACT.md`・`REVIEW_DUAL_LENS.md`・`DESIGN.md` 等）の**見出し・本文は不変**（アンカー参照が指す内容が変わらないこと）。→ 維持を確認。
- 既存の blocking CI step（audit・check-comment-refs 等）の挙動。→ 非ブロッキング step 追加のみで不変。
- `close/` 配下の Read/Grep/Glob deny 設定と整合（close 配下を検査対象・修正対象にしない）。→ 維持。

## スコープ判断: DESIGN.md アンカー参照の扱い

実装フェーズの申し送りにあった `enforcement/README.md`（`DESIGN.md §系統D` へのアンカー参照）の誤りを再確認した。

- **事実**: リンク末尾のアンカーが `#…設計思想agents-project-優先` となっていたが、参照先見出し `## 系統D: hooks overlay 配備の設計思想（.agent-skill-chain/project/ 優先）` の正しい GitHub 準拠 slug は `#…設計思想agent-skill-chainproject-優先`。`check-relative-links.sh`（アンカー検査 ON）で唯一の残存「切れ 1 件」として検出されていた。
- **判断**: 28 件（相対パスの実在切れ＝ファイル欠落）とは別カテゴリ（ファイルは実在しアンカーのみ不一致）だが、**本 issue のリンク健全性ゴール（FR-1/FR-2）に直接資する軽微修正**であり、申し送りが「軽微であればついで直し可」と明示していたため、verify フェーズで修正した。修正後、アンカー検査 ON でも**切れ 0 件**を達成（本カテゴリの残存ゼロ）。

## docs 更新

- 要否: 必要（本 issue が docs=正本 Markdown のリンク健全性そのものを対象とするため）。
- 対象: `.agent-skill-chain/source/DOCS_RULES.md` に検査スクリプトによる継続検査の一文を追記（164050 と共同）。正本群のリンク切れ 28 件是正・`enforcement/README.md` のアンカー 1 件是正・4 SKILL.md の配備後案内文言化を実施。システム仕様書（`docs/00_review/` 等）への波及なし。

## 境界の確認（監査再現）

- `test/run-all.sh`: FAIL 0（新規リグレッションなし）。
- `audit.sh .`: 本 issue 由来の新規 FAIL なし。`163640/03_実装計画.md`・`164050/03_実装計画.md` の「テスト観点」セクションを固定見出し（`## テスト観点`）へ整え、audit #2（テスト観点必須）を充足。既存の他 issue（163531/163129/163502 等）の FAIL は main 由来で本 PR のスコープ外。workflow.db 非採用に伴う #29/#31/#32/#33/#34/#35 の SKIP は本リポの既知事象（別 issue で対応済み）。
- **workflow.db 証跡記録について**: 本 worktree の `.agent-skill-chain/runtime/workflow.db`（gitignore 対象・PR 非追跡）は空であり、`write-workflow-log.sh` の verify-and-close 記録は `PARENT_ENTRY_ID`（先行 implement-feature エントリ）を必須とするが、先行フェーズのエントリが本 DB に存在しない。検証不可能な過去フェーズのタイムスタンプ・親エントリを捏造しない方針（前例 163833・163330系・163206 の教訓）に従い、DB への記録は行わず、本 04_review.md 群を確定した証跡とする。

## 次のステップ

- 進行役へ返却（PR 作成済み・マージは行わない）。`90_issues.md` の最終更新は進行役が一括で実施する。
