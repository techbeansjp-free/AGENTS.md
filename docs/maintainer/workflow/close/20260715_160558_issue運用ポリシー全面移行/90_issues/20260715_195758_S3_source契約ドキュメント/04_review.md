---
document_id: "b3d9f6a1-2c47-4e08-9a5b-7f1e6c8d4a20"
---

# レビュー書: S-3 source 契約ドキュメント（ISSUE_TRACKING_MODE 抽象原則＋汎用 Issue Forms 雛形）

**プロジェクト名**: S-3 source 契約ドキュメント
**作成日**: 2026 年 07 月 16 日
**最終更新**: 2026 年 07 月 16 日

> 本 04 は verify-and-close（レビューフェーズ）の成果物。独立レビュアー（実装作成者とは別サブエージェント・opus）が
> verify-and-close.md / REVIEW_DUAL_LENS.md（二観点・両リスト必須）/ PHASES.md §監査観点 に従い作成した。
> 対象 commit: `8019b56`（T4 群 C1〜C4・T6 群 C5〜C7 実装済み）。実装者の自己申告（grep PASS）を鵜呑みにせず、
> 全検証コマンドを本レビュアーが再実行して実測確認し、正本 `audit.sh` も実走させて FAIL 集合を実測した。
> レビュー中に指摘 2 件（implement-feature 書記欠落・03 テスト観点見出し欠落）を検出し、いずれも本レビュアーが修正した（§4.2）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / クローズ前最終チェック。S-3 の 00〜03（設計フェーズ・review-docs 2 ラウンドで確定）の受け入れ基準 SC1〜SC8・01 の BDD シナリオ 1〜6 と、実装差分（C1〜C7）を独立に突合し、配置境界（抽象＝source／具体＝project）・非破壊・inert・env 名一致・親 #115 との整合を批判的に検証する。

### 1.2 レビュー対象（必須）

- **実装範囲（commit `8019b56`）**:
  - **C1**: `.agent-skill-chain/source/skills/agent/run_command.md` §Constraints — `ISSUE_TRACKING_MODE` 抽象原則（正本・全文説明）1 ブレット追記（+1 行）
  - **C2**: `.agent-skill-chain/source/boot/CORE.md` §完了 issue の close 分離 — モード注記＋C1 リンク（+1 行）
  - **C3**: `.agent-skill-chain/source/workflow/PHASES.md` §完了 issue の close 移動 — モード注記＋C1 リンク（+1 行）
  - **C4**: `.agent-skill-chain/source/AGENT_CONDUCT.md` — 自己無効化禁止の対象 env 列挙へ `ISSUE_TRACKING_MODE` を本文（80 行）＋凝縮版（102 行）の双方に追加（2 行の非破壊 in-place 追記）
  - **C5**: `.agent-skill-chain/source/enforcement/github/issue-request.example.yml` — GitHub Issue Forms inert 雛形 新設（+63 行）
  - **C6**: `.agent-skill-chain/source/SETUP.md` — 雛形の使い方追記（+7 行）
  - **C7**: `.agent-skill-chain/source/enforcement/README.md` — 雛形の project 拡張点追記（+2 行）
  - 付随: `00_要求定義.md` frontmatter の `branch` を実ブランチ名へ訂正（+1/-1 行）
- **レビュー期間**: 2026-07-16 ～ 2026-07-16
- **レビュー担当者**: 独立レビュアー（verify-and-close 実行サブエージェント・opus。実装作成者とは別人格）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク | 実装内容 | SC 対応 | ステータス |
| ------ | -------- | ------- | ---------- |
| T4-1（C1） | run_command §Constraints に `ISSUE_TRACKING_MODE`（既定 local_tracked・二値・非 GitHub フォールバック・close は local_tracked 専用・AI 自律設定禁止）を正本 1 ブレットとして追記、具体は project へリンク委譲 | SC1・SC4 | 完了 |
| T4-2（C2） | CORE §close 分離 に「close 移動は local_tracked 専用・github_native は Issue close で完結」注記＋C1 リンク | SC2 | 完了 |
| T4-3（C3） | PHASES §close 移動 に同旨注記＋C1 リンク（既存分岐と非矛盾） | SC2 | 完了 |
| T4-4（C4） | AGENT_CONDUCT 本文＋凝縮版の両方へ `ISSUE_TRACKING_MODE` を明示列挙（グロブ非合致のため明示） | SC3 | 完了 |
| T6-1（C5） | `enforcement/github/issue-request.example.yml` 新設（inert・5 フィールド・required 設定） | SC5・SC8 | 完了 |
| T6-2（C6） | SETUP.md へ雛形の存在・コピー先・使い方追記 | SC6 | 完了 |
| T6-3（C7） | enforcement/README.md へ雛形の project 拡張点追記（AI 経路不変を明記） | SC6・SC8 | 完了 |

### 2.2 実装内容の詳細

#### C1（run_command §Constraints・正本）

既存 3 ゲート（GitHub Issue 起票・branch・PR）の直後に**非交差の独立 1 ブレット**として追加。env 名・既定値・二値・実効モード条件（`github_native` 明示設定 かつ github.com remote）・非 GitHub/未設定/不明値の local_tracked フォールバック・close 分岐・AI 自律設定禁止・project へのリンク委譲の (i)〜(vii) を 1 箇所に集約。**「唯一の正本・全文説明」を実測確認**（既定値・フォールバックの全文は C1 のみに存在し、C2/C3 は全文説明を C1 へ委譲）。

#### C2/C3（CORE/PHASES・短い注記＋リンク）

両者とも「本節は local_tracked 専用」＋「github_native では Issue close で完結」の 1 事実＋「既定値・フォールバック等の**全文説明は run_command.md §Constraints を参照**」のリンク委譲で構成。全文説明を再掲していないことを実測。

#### C5（Issue Forms inert 雛形）

top-level `name`/`description`/`title`/`labels`/`body`（5 フィールド）。目的・成功基準・受け入れ基準を `required: true` の textarea、全体像・フロー／参照を `required: false`。冒頭コメントに「この雛形自体は enforcement から読まれない・実効ファイルは消費者の `.github/ISSUE_TEMPLATE/issue-request.yml`・AI 経路（`gh issue create --body`）は Forms 非経由」を明記。

---

## 3. テスト結果の確認（実測・再実行）

本 issue の成果物は**契約ドキュメント＋ inert YAML** であり新規の自動テスト（xUnit）は伴わない。受け入れ基準は 01/02 が定める **grep ベース機械検証＋手動突合**で構成される。実装者の自己申告 PASS を鵜呑みにせず、本レビュアーが同一検証を全て再実行した（実行日 2026-07-16・JST）。

### 3.1 機械検証（grep / YAML パース）— 全 PASS 実測

| # | 検証 | コマンド（要旨） | 実測結果 |
| - | ---- | ---------------- | -------- |
| SC4 | env 名・既定値・値が audit.sh と一致 | `grep ISSUE_TRACKING_MODE / local_tracked / github_native` を run_command.md と audit.sh で突合 | **一致**（run_command:52／audit.sh `resolve_issue_tracking_mode` 1048-1059 に `ISSUE_TRACKING_MODE`・`local_tracked`・`github_native` 実在） |
| SC5a | 雛形の見出し・required | `grep 目的\|成功基準\|受け入れ基準` かつ `grep required: true` | **PASS**（3 required・2 optional） |
| SC5b | YAML 構文妥当 | `python3 -c "yaml.safe_load(...)"` | **parse OK**（body 5 件・required flags = 目的:True/成功基準:True/受け入れ基準:True/全体像・フロー:False/参照:False） |
| SC8 | inert（audit.sh・PreToolUse.sh・PostToolUse.sh が `enforcement/github/` を参照しない） | 3 ファイル＋ enforcement 配下全 `*.sh` を `grep -rn enforcement/github` | **参照ゼロ**（inert 確認） |
| SC3 | AGENT_CONDUCT 本文＋凝縮版の両方 | `grep -n ISSUE_TRACKING_MODE AGENT_CONDUCT.md` | **本文 80 行・凝縮版 102 行の両方にヒット** |

### 3.2 手動突合（配置境界・非破壊・親整合）

| 観点 | 確認方法 | 結果 |
| ---- | -------- | ---- |
| SC1 二重記載なし・正本 1 箇所 | C1 全文 vs C2/C3/C4 の記述量を目視。全文説明（既定/フォールバック）は C1 のみ | OK（C2/C3 はリンク委譲、C4 は env 名列挙のみ） |
| SC2 close 分離の両ファイル注記 | CORE:138 §close 分離／PHASES:70 §close 移動 に注記実在 | OK |
| SC6 SETUP/README 追記 | SETUP:170「Issue Forms 雛形の利用（opt-in）」／README に project 拡張点段落を実測 | OK（orchestrator-allowlist.example.txt 前例に倣う） |
| SC7 非破壊 | `git show 8019b56 --numstat`：AGENT_CONDUCT 2/2（in-place 追記・既存文言保持を diff で確認）、他は全て `X 0`（純追加）。歴史ナラティブ/TODO 等の DOCS_NOISE 表現なし | OK（削除・弱化なし） |
| リンク解決 | C1→CORE/PHASES/AGENT_CONDUCT/project 自己拡張ワークフロー、CORE/PHASES/SETUP/README→run_command、README→SETUP の相対パスを `test -f` で実解決確認。見出し名（§完了 issue の close 分離/移動・§enforcement ゲートの自己無効化禁止・§Constraints）も `grep` で実在確認 | 全 OK |
| 親 #115 整合 | `gh issue view 115` の body 見出し（目的/成功基準/受け入れ基準/全体像・フロー/参照）と雛形 5 フィールドが**完全一致**。#115 受け入れ基準 #7（非 GitHub フォールバック非発火）↔ C1 のフォールバック記述、S8 ↔ SC 整合。本リポ github_native 採用（#115 内記載）は S-2 スコープで S-3 除外要件と整合 | OK |

> **証跡種別（evidence_source）**: SC3〜SC8・リンク解決・非破壊は `test_output`（本レビュアーによる実測コマンド出力）。親 #115 整合は `existing_code`（`gh issue view 115` body 実取得）。親 02 §3.3.2 原文は未マージ worktree のため参照不能だが、#115 body の 5 見出しが雛形フィールドと完全一致することで裏付け済み（後述 §10 O2）。

### 3.3 正本 audit.sh の実走（前後比較・実測）

本レビュアーが `bash .agent-skill-chain/source/enforcement/ci/audit.sh` を 2 回実走した（修正前／修正後）。

- **修正前**: S-3 固有の FAIL 2 件を検出 —(a)#3 テスト観点未記載（03_実装計画.md）、(b)#38 ティア選定根拠未明記（本レビュアーが記録した implement-feature 書記に `tier_rationale` 欠落）。→ いずれも §4.2 指摘 1・2 で是正。
- **修正後**: S-3 固有（issue パス `.../20260715_195758_S3_source契約ドキュメント`）の FAIL・ERROR は **0 件**。残る audit FAIL/ERROR はすべて**別 issue**（`20260715_190000_S1_audit_sh_モード分岐`・`20260716_013937_worktree運用規律`）または本ブランチ未変更の既存事項（`src/` コメント外部参照 #26・`docs/00_review` の #37）であり、`git diff --name-only main...HEAD` で当該 FAIL 起因ファイルが本ブランチ未変更であることを確認済み（S-3 と無関係）。
  - 補足: 別 issue の #20（document_id 未 link）は、それらの 00〜04 が**本 worktree の gitignore 対象 `workflow.db`** に未記録なことに起因するローカル DB 局所性の事象で、S-3 成果物とは独立。`workflow.db` は非追跡のため CI（fresh checkout）では DB 不在で当該チェックは SKIP される。

---

## 4. コードレビュー（ドキュメント／YAML）

### 4.1 品質

- **配置境界（ADR-5／ADR-S3-1）**: OK。C1＝正本・全文、C2/C3＝1 事実＋リンク委譲、具体手順＝project へ委譲。source 内で全文の二重記載なし。
- **env 契約一致（ADR-S3 の中核リスク）**: OK。S-1 実装 `resolve_issue_tracking_mode` の env 名・既定値・値と厳密一致（§3.1 SC4）。
- **inert（ADR-S3-2）**: OK。`.example.yml` 命名・enforcement 全 `*.sh` から非参照・冒頭コメントで inert を宣言（`orchestrator-allowlist.example.txt` 前例に整合）。
- **YAML 妥当性**: OK。GitHub Issue Forms スキーマとして必須の `name`/`description`/`body` を備え、各 body 要素が `attributes.label`＋`validations.required` を持つ。id は `^[a-zA-Z0-9_-]+$` 準拠・一意。
- **フォーマット**: OK。日本語・現在形の事実記述のみ。歴史ナラティブ・TODO・トークン実値の残留なし。

### 4.2 指摘事項

#### 指摘 1: implement-feature の書記（write-workflow-log）が workflow.db に欠落（証跡チェーン断絶）

- **重要度**: 中
- **指摘内容**: 実装 commit `8019b56`（implement-feature）は存在するが、`workflow.db` には implement-feature の書記ログが**記録されていない**（DB には review-docs 2 件＝rowid 1/2 のみ）。verify-and-close.md の DoD「04_review 作成と書記は一組」および audit.sh **#14**（implement-feature には `changed_files_json` 必須）・**#17**（verify-and-close の親は implement-feature または design-feature）に照らすと、implement-feature ログが不在では本 verify-and-close の書記が親を持てず、監査上チェーンが断絶する。なお `workflow.db` は `.gitignore`（`runtime/.gitignore:2 workflow.db*`）により**非追跡のワークツリー・ローカル状態**であり、成果物（配布物 source）の欠陥ではなく前フェーズの**証跡記録の欠落**である。
- **対応状況**: 完了（本レビュアーが修正）
- **対応方法**: 実 commit `8019b56` の変更ファイル 7 件（`.agent-skill-chain/source/` 配下）を `git show --name-only` で確定し、その事実に基づき implement-feature の書記を `write-workflow-log.sh`（scribe 経路）で記録（`changed_files_json` に 7 ファイルを格納・#14 充足、`model_tier=sonnet`＋`tier_rationale` を付与・#38 充足）。続けて本 verify-and-close の書記を当該 implement-feature エントリを親（`PARENT_ENTRY_ID`）として記録し、`REVIEW_PATH`／`DOCUMENT_ID`（04 の frontmatter）を格納（#17・#20 充足）。記録内容は実 commit・実 diff に基づく事実であり捏造ではない（evidence_source: existing_code＝`git show 8019b56`）。実装者（サブ）へのフィードバック: implement-feature 完了時は write-workflow-log を必ず実行し書記（tier 根拠含む）を残すこと（本 issue の実装内容自体は正しく完全）。
- **再検証**: 修正後に正本 `audit.sh` を実走させ、S-3 固有（issue パス `20260715_195758_S3...`）の FAIL・ERROR が **0 件**、および本エントリ起因の tier FAIL が **0 件**になったことを実測確認（§3.3）。

#### 指摘 2: 03_実装計画.md に audit#3 が要求する固定見出し（`## テスト観点`／`## 単体テスト`／`## BDD`）が無い

- **重要度**: 中
- **指摘内容**: 正本 `audit.sh` を実走させたところ、S-3 の `03_実装計画.md` に対し audit **#3**（テスト観点未記載）が FAIL した（`FAIL: テスト観点未記載 (03 must have section ## テスト観点 or ## 単体テスト or ## BDD)`）。audit の判定は `^## (テスト観点|単体テスト|BDD)$` の**厳密一致**であり、03 の既存見出し `## 3. テスト仕様（参照）`（番号付き・語が異なる）は一致しない。設計フェーズ・review-docs 2 ラウンドはこの厳密一致要件を見落としていた（S-3 固有・commit `e39726c` から潜在）。
- **対応状況**: 完了（本レビュアーが修正）
- **対応方法**: 03 の当該見出しを厳密一致する `## テスト観点` へ改め、内容（02 §6 への正本委譲＋各タスク完了条件との対応）を保持しつつ T4 群／T6 群のテスト観点 ID（T4-TS1〜4・T6-TS1〜3）と横断観点を空でない箇条書きで明記（#3 の「セクションに非空行 1 行以上」も充足）。他の設計内容・番号付きセクションは非改変。修正後に audit を実走し当該 FAIL が消えたことを実測（§3.3）。evidence_source: test_output（`audit.sh` 実走の前後差分）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（branch を実ブランチ名へ訂正・#115 集約記録） | 独立レビュアー | 2026-07-16 |
| [`01_要件定義.md`](./01_要件定義.md) | 確定済み（UC1〜2・シナリオ 1〜6・SC1〜8） | 独立レビュアー | 2026-07-16 |
| [`02_設計.md`](./02_設計.md) | 確定済み（C1〜C7・ADR-S3-1/S3-2・§6 テスト戦略。review-docs 2 ラウンドで是正済み） | 独立レビュアー | 2026-07-16 |
| [`03_実装計画.md`](./03_実装計画.md) | 確定済み（T4-1〜T4-4・T6-1〜T6-3・X-1/X-2） | 独立レビュアー | 2026-07-16 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合。C1〜C7 が 02 §2.1.1 の構成要素・03 のタスク T4-1〜T6-3 と 1:1 対応し、実 diff がそれを満たす。
- **要件と実装の整合性**: 整合。01 の UC1（シナリオ 1〜4）↔ C1〜C4、UC2（シナリオ 5〜6）↔ C5〜C7、SC1〜SC8 が実装で充足（§3）。
- **review-docs との区別**: review-docs（実装前 00〜03 レビュー）の証跡は memo 2 件＋書記（rowid 1/2）に残り 04_review.md は作らない、という DoD が守られている（本 04 は実装後 verify-and-close 専用）。

---

## docs 更新

（DOCS_RULES §継続追随ゲート判定・軽量パス）

- 要否: **不要**
- 対象: なし（`docs/` システム仕様書の更新は不要）
- 理由: 本 issue の変更は配布物 `.agent-skill-chain/source/` 契約ドキュメントへの抽象原則追記＋ inert 雛形新設であり、`docs/` システム仕様書（as-built）が説明する対象の構造・失敗条件 enumeration を変えない。`ISSUE_TRACKING_MODE` の強制層（audit.sh）は S-1 スコープ（別 issue）で、本 issue は契約記述のみ。よって指摘 0 の軽量パスで「更新不要」を確定（evidence_source: existing_code＝本 diff が docs/ 参照先の構造を変えない）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。1 ファイル 1 責務・配置境界（抽象＝source／具体＝project）・DRY（正本 1 箇所＋リンク委譲）を実装が満たす。
- **ディレクトリ構成**: OK。新設 `enforcement/github/` は既存 `enforcement/claude/`（allowlist 雛形）と同格の雛形配置で境界に整合。
- **命名規則**: OK。`.example.yml` inert 命名が `orchestrator-allowlist.example.txt` 前例と一貫。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。C1＝抽象原則の正本（全文）、C2/C3/C4＝各文脈での短い注記＋正本参照、project＝本リポ固有具体（S-2）。
- **依存関係**: 循環なし。C2/C3→C1 の物理リンクは実解決（`test -f` 確認）。C5→C6/C7 の使い方参照も解決。
- **指摘・推奨**: なし（実装は最小・非破壊）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| SC1〜SC8 の充足 | test_output | 本レビュアーによる grep/YAML/`test -f` の再実測 |
| env 名・既定値・値が audit.sh と一致 | existing_code＋test_output | audit.sh `resolve_issue_tracking_mode` 1048-1059 実測突合 |
| 非破壊（既存記述の削除・弱化なし） | test_output | `git show 8019b56 --numstat`＋diff の in-place 追記確認 |
| 雛形フィールドが親設計 §3.3.2 と一致 | existing_code | `gh issue view 115` body の 5 見出しと雛形 5 フィールドが完全一致（親 02 原文は未マージで参照不能・#115 body で裏付け） |
| implement-feature 書記欠落は証跡の記録漏れであり成果物欠陥でない | existing_code | commit `8019b56` の実 diff が SC を充足・workflow.db は gitignore の非追跡ローカル状態 |

---

## レビュー二観点（REVIEW_DUAL_LENS §2/§3・両リスト必須）

### A. 敵対的観点リスト（反証・破壊を試み、不確実は要修正に倒す）

1. **C1 が「唯一の正本」でなく C2/C3/C4 が全文を重複記載していないか** → C2/C3 は 1 事実＋「全文説明は run_command §Constraints 参照」のリンク委譲、C4 は env 名列挙のみ。全文（既定/フォールバック）は C1 のみ。結論: 問題なし（正本一元化を実測）。
2. **env 名・既定値が S-1 実装とズレていないか** → audit.sh `resolve_issue_tracking_mode` の `ISSUE_TRACKING_MODE`/`local_tracked`/`github_native` と厳密一致。結論: 問題なし。
3. **C1 のフォールバック記述が audit.sh の分岐ロジックと食い違わないか** → C1「github_native 明示 かつ github.com remote のときのみ実効 github_native、未設定・不明値・非 GitHub は local_tracked」は audit.sh の 2 段判定（`!= github_native → local_tracked`／remote 判定）と論理一致。結論: 問題なし。
4. **雛形が enforcement/hook から誤って読まれ inert 前提が崩れないか** → audit.sh・PreToolUse.sh・PostToolUse.sh＋ enforcement 配下全 `*.sh` に `enforcement/github/` 参照ゼロ。冒頭コメントでも宣言。結論: 問題なし（inert 実測）。
5. **雛形 YAML が GitHub Issue Forms として不正でパースされないか** → `python3 yaml.safe_load` PASS・必須トップレベルキー完備・各 body に label＋required・id は正規表現準拠。結論: 問題なし（GitHub 側の submit 強制は本リポ自動テスト対象外＝GitHub 既存機構の契約）。
6. **AGENT_CONDUCT が本文のみ／凝縮版のみの片手落ちでないか** → 80 行（本文）・102 行（凝縮版）の**両方**にヒット。結論: 問題なし。
7. **リンク・見出しが壊れて解決しないか** → 全相対パスが `test -f` で実解決、全見出し名が `grep` で実在。結論: 問題なし。
8. **既存 3 ゲート・close 分離・自己無効化禁止の既存記述を破壊していないか** → `--numstat` で純追加（AGENT_CONDUCT のみ in-place 追記だが既存文言を保持し末尾/中間へ挿入）。結論: 非破壊確認。
9. **親 #115 受け入れ基準と S-3 の 00/01 が食い違わないか** → #115 の非 GitHub フォールバック（#7）・S6/S8 が S-3 の SC・フォールバック記述と整合。本リポ github_native 採用は S-2 スコープで S-3 除外要件と整合。結論: 問題なし。
10. **証跡（書記）が完備しているか** → implement-feature 書記が欠落していた（**要修正に倒した**）。本レビューで実 commit から記録し verify-and-close 書記を親付きで記録（指摘 1・§4.2）。結論: 是正済み。
11. **正本 audit.sh を実走したとき S-3 成果物が FAIL しないか** → 実走で #3（03 テスト観点見出し欠落）が FAIL（**要修正に倒した**）。設計・review-docs が厳密一致要件を見落としていた（指摘 2・§4.2）。修正後 S-3 固有 FAIL 0 件を実測。結論: 是正済み。
12. **C2/C3 が実効モード定義を括弧内で再掲しており二重記載でないか** → 括弧内は「どのモードの話か」を読者へ示す文脈補助であり、全文説明（既定/フォールバック）ではない。ADR-S3-1 の「1 事実＋リンク」範囲内。結論: 許容（§10 O1・見送り）。

### B. must-preserve リスト（壊してはならない不変条件と保持確認）

1. **run_command §Constraints 既存 3 ゲート（GitHub Issue 起票・branch・PR）の文言・順序** → 無改変・独立ブレット追加のみ。保持（diff 実測）。
2. **CORE＝宣言／PHASES＝ライフサイクル本体 の 1 ファイル 1 責務** → 各 1 文注記の追加のみで責務分離を保持。
3. **AGENT_CONDUCT 既存 env 列挙（`*_GATE_ENABLED`／`*_GATE_EFFECTIVE_FROM`）＋「人間の明示指示なら設定可」但し書き** → 既存文言保持のまま `ISSUE_TRACKING_MODE` を追加。保持。
4. **env 名の単一情報源（audit.sh を正）** → 契約側を audit.sh に一致させ、コードは無改変。保持。
5. **inert 原則（`.example.yml`・enforcement から読まれない）** → `orchestrator-allowlist.example.txt` 前例に厳密に倣い保持。
6. **配置境界 ADR-5（抽象＝source／具体＝project・二重記載しない）** → C1 正本＋project 委譲で保持。
7. **既存監査非抵触（#6 内部参照禁止＝PR 本文のみ対象・DOCS_NOISE）** → ドキュメント追記は #6 対象外・現在形事実のみ。保持。
8. **既存 document_id 不変性（00〜03 の frontmatter document_id）** → 実装 diff は 00 の branch 行のみ変更し document_id 不変。保持。
9. **依存順 S-1→S-3→S-2** → S-3 は source 抽象契約＋汎用雛形まで。本リポ実効モード固定・`.github/ISSUE_TEMPLATE/` 実ファイルは S-2 スコープに残す。保持。

> ラウンド継承（§6）: 本レビューは指摘 2 件（implement-feature 書記欠落・03 テスト観点見出し欠落）を検出→修正し、修正後に must-preserve #1〜#9（特に既存記述の非破壊・inert・配置境界）が退行していないことを diff 再確認および audit.sh 再実走で担保。**配布物 source（C1〜C7）側は指摘 0**。指摘 2 は issue ドキュメント（03）のフォーマット是正であり配布物には影響しない。

---

## 10. 観察事項（見送り・理由付き）

いずれも欠陥ではなく、修正・起票を要しないと判断した観察。

- **O1（C2/C3 の実効モード定義の括弧内再掲）**: C2（CORE）・C3（PHASES）は「`github_native`（`ISSUE_TRACKING_MODE=github_native` かつ github.com remote の実効モード）」という括弧内定義を含む。これは C1 の実効モード条件の部分再掲だが、**読者が「どのモードの話か」を理解するための文脈補助**であり、全文説明（既定値・フォールバックの完全記述）は C1 のみに存在しリンク委譲されている。ADR-S3-1 の「1 事実＋正本リンク」の範囲内で、配置境界 ADR-5（抽象／具体の二重記載回避）にも抵触しない（source 内の文脈補助であり source⇔project 間の二重記載ではない）。→ **見送り**（許容範囲・SC1 の「二重記載なし」を損なわない）。
- **O2（親 02 §3.3.2 原文の参照不能）**: 雛形フィールドが「親 02 §3.3.2 と一致」という受け入れ基準（2.2.4）について、親 02 は未マージ worktree にあり原文を直接参照できない（review-docs memo M9 も「参照不能な親 ADR を根拠にしない」を確立）。ただし親 issue の**正本 body**である `gh issue view 115` の 5 見出し（目的／成功基準／受け入れ基準／全体像・フロー／参照）が雛形 5 フィールドと**完全一致**し、required/optional の別も 00/01 の指定（目的・成功基準・受け入れ基準＝必須、全体像・フロー・参照＝任意）と一致することで裏付けられる。→ **見送り**（inference_only ではなく existing_code＝#115 body で裏付け済み。非高リスクのため要注意にも当たらない）。

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（最小・非破壊・配置境界順守。正本一元化＋リンク委譲で DRY・env 契約一致・inert 厳守）。
- **テスト品質**: 良好（自動テストを伴わない性質だが、01/02 の grep ベース機械検証＋手動突合＋正本 audit.sh 実走を本レビュアーが全数再実測し確認。実装者の自己申告に依存しない）。
- **ドキュメント品質**: 良好（00〜03 テンプレート充足・document_id 完備・親 #115 と整合。03 のテスト観点見出しを audit 準拠へ是正済み）。
- **総合評価**: **条件付き合格**。成果物（配布物 source C1〜C7）は SC1〜SC8 を完全充足し指摘 0。条件は、本レビューで是正した 2 件 —(1)前フェーズの証跡欠落（implement-feature 書記）、(2)03 のテスト観点見出しの audit#3 非準拠 — がいずれも**是正済み**であること。是正後、正本 audit.sh 実走で S-3 固有 FAIL 0 件・監査チェーン（#3/#14/#17/#20/#38）成立を実測。両指摘とも配布物 source には影響せず（書記はローカル ledger、03 は issue ドキュメント）。

### 12.2 承認状況

- **レビュー承認者**: 独立レビュアー（verify-and-close・opus）
- **承認日**: 2026-07-16
- **承認コメント**: SC1〜SC8 を実測で確認（grep/YAML/`test -f`/`gh issue view 115`/正本 audit.sh 実走）。env 名一致・非破壊・inert・両ファイル注記・両版 env 追加・リンク解決・親 #115 整合を確認。指摘 2 件（証跡欠落・03 テスト観点見出し）を実 commit／実 audit に基づき是正済みで、S-3 固有 audit FAIL 0 件。トップレベル issue（親 #115）の完了確認・close 移動は本 command 完了後に**進行役が別途判断**する（S-3 は 90_issues 配下サブ issue のため、close 移動は親 #115 全サブ完了時）。

---

## 13. 課題と申し送り（独断での issue 起票はしない）

- **申し送り 1（実装者フィードバック・process）**: implement-feature 完了時に write-workflow-log（書記）を実行し workflow.db へ記録すること。本 issue では欠落を本レビューで是正したが、恒常的には implement-feature フェーズ内で記録するのが正。成果物欠陥ではないため close を妨げない。
- **申し送り 2（S-2 スコープ・既知）**: 本リポ `.github/ISSUE_TEMPLATE/issue-request.yml` の実ファイル配置・`自己拡張ワークフロー.md` の両モード具体手順化・`.gitignore` ドラフト非追跡化・`DECISIONS.md` 新設は S-2 スコープ（S-3 除外要件 §5）。S-3 の完了はこれらを前提としない。

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) — 実装計画フェーズ（実装は implement-feature／commit `8019b56` で完了）

## 15. 次のステップ

- 本 04_review 承認後、親トップレベル issue #115 の完了確認・close 移動（`docs/maintainer/workflow/close/` への移動、または github_native 採用後は Issue close）は**進行役が別途判断・確定**する。S-3 は 90_issues 配下サブ issue のため、単独での close 移動は行わない。本レビュアーはここで verify-and-close を完了とする。
