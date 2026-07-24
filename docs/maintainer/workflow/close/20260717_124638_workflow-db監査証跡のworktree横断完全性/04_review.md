---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "04b196db-e4ce-4ceb-96d1-36c49186c8e3"
---

# レビュー書: workflow.db 監査証跡の worktree 横断完全性（Issue #132）

**プロジェクト名**: workflow.db 監査証跡の worktree 横断完全性
**作成日**: 2026 年 07 月 17 日
**最終更新**: 2026 年 07 月 17 日

> **重要**: 本 04_review は `mode: quick` の実装完了後 verify-and-close 成果物である。quick モードは #32（review-docs）・#34（GitHub Issue 起票）を免除するが、04_review 作成義務（enforcement 失敗条件 #3）は mode に関係なく維持されるため作成する。本ドキュメントは `.gitignore:76`（`docs/maintainer/workflow/**/04_review.md`）により git 非追跡（S-2 パターン）となる見込みだが、それは ADR-132-2 (d) により**正しい挙動**である（恒久判断は既に `docs/maintainer/decisions/DECISIONS.md` の ADR-132-1／ADR-132-2 へ転記済みのため、transient な本ドラフトが非追跡でも恒久情報は失われない）。
>
> **必須**: レビュー深度は quick。実装は `.agent-skill-chain/source/` 配下のフレームワーク基盤スクリプト（配布物）と `.agent-skill-chain/project/` 規約であり、consumer 非回帰を tmp 隔離で検証した。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

implement-feature 成果物（Issue #132 問題1 の workflow.db パス解決共有ヘルパ化と問題2 の運用規約明文化）の実装内容確認・品質保証・受け入れ基準（SC-1〜SC-4）充足確認。

### 1.2 レビュー対象（必須）

- **実装範囲**: (1) 共有ヘルパ `resolve-wf-db.sh` 新設（ADR-132-1 の hint 尊重→git-common-dir 固定+sentinel ガード→CWD fail-safe）、(2) `write-workflow-log.sh` の WF_DB 導出をヘルパ経由へ差替、(3) `audit.sh` の WF_DB 導出 4 箇所を `WF_DB_CANONICAL`（ヘルパ経由）へ差替（走査用 `PROJECT_ROOT="${1:-.}"` は不変）、(4) `自己拡張ワークフロー.md` へ問題2 の運用規約（§0.1 (c) 削除前 ignored 目視確認・新規 §0.3 (d) 恒久判断 DECISIONS.md 転記完了要件・(e) enforce 再有効化のスコープ外明記）を追記。
- **レビュー期間**: 2026-07-17（implement 完了後の独立検証）
- **レビュー担当者**: verify-and-close サブエージェント（opus）。実装サブの自己申告を鵜呑みにせず独立観点で再検証。

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| 問題1: 共有ヘルパ新設 | `resolve-wf-db.sh` の `resolve_wf_db_path` を新設。ADR-132-1 の 3 段解決規則を実装 | 2026-07-17 | 実装サブ(opus) | 完了 |
| 問題1: 書記統合 | `write-workflow-log.sh` の WF_DB をヘルパ `resolve_wf_db_path` 経由へ差替（env hint） | 2026-07-17 | 実装サブ(opus) | 完了 |
| 問題1: 監査統合 | `audit.sh` の WF_DB 導出 4 箇所を `WF_DB_CANONICAL` へ差替（位置引数 hint・走査用 PROJECT_ROOT 不変） | 2026-07-17 | 実装サブ(opus) | 完了 |
| 問題2: 運用規約明文化 | `自己拡張ワークフロー.md` §0.1 (c)・新規 §0.3 (d)(e) を追記 | 2026-07-17 | 実装サブ(opus) | 完了 |

### 2.2 実装内容の詳細

#### タスク1〜3: workflow.db パス解決の共有ヘルパ化（問題1・必須コア）

- **実装内容**: `resolve_wf_db_path <hint> [workflow_dir]` を単一正本として新設。解決規則は (1) hint が非空かつ "." 以外ならその値を尊重（後方互換・明示上書き）、(2) それ以外は `git rev-parse --path-format=absolute --git-common-dir` を試行し、`dirname` で得た main root 直下に `.agent-skill-chain/` が実在する場合のみ採用（sentinel ガード）、(3) いずれも不成立なら従来の `.`（CWD 基準）へ fail-safe フォールバック。
- **変更ファイル**: `.agent-skill-chain/source/scripts/resolve-wf-db.sh`（新規）、`write-workflow-log.sh`（L20-24 でヘルパ source・env `PROJECT_ROOT` を hint に渡す）、`audit.sh`（L105-108 でヘルパ source・位置引数 `PROJECT_ROOT` を hint に渡し `WF_DB_CANONICAL` 導出。L202/302/413/485 の 4 参照を差替）。
- **実装方法**: 呼び出し規約差（write-workflow-log.sh=env / audit.sh=位置引数）を「hint を引数で受ける」ことでヘルパ側に吸収。ヘルパは source 専用（関数定義のみ・`exit`/`set -e` を持たず呼び出し元を止めない）。
- **確認事項（独立検証済み）**: 関数を実読し ADR-132-1 の 3 段規則と一致することを確認。`command_dir` 取得は `if` 条件で捕捉し `set -e` 下でも中断しない実装。sentinel ガードが consumer モノレポ回帰・bare/非標準 GIT_DIR・旧 git を同時に封じる設計。

#### タスク4: 問題2 の運用規約明文化

- **実装内容**: `自己拡張ワークフロー.md` §0.1 に (c) 削除前 ignored 成果物の目視確認（enforce off 時の即時運用ガード・`git status --ignored`）を追記。新規 §0.3「worktree 削除前の恒久判断保全」に (d) 恒久判断の DECISIONS.md 転記完了を worktree 削除前の完了要件とする主軸、(c) との多層防御関係、(e) enforce 再有効化の本 issue スコープ外明記（安全策要件 4 点を記録）を追加。
- **変更ファイル**: `.agent-skill-chain/project/自己拡張ワークフロー.md`
- **確認事項（独立検証済み）**: §0.x 節番号（0.1/0.2/0.3）に重複なし。追記が既存 §0.1 (C) untracked 退避と補完関係で矛盾なし。ADR-132-2 の決定と一致。

---

## 3. テスト結果の確認

### 3.1 単体テスト（BDD シナリオ・独立再実行）

実装サブの報告を鵜呑みにせず、verify 担当が tmp 隔離（`mktemp -d`）で `resolve_wf_db_path` を独立に再実行した。

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-17
- **テストケース数**: 8（標準/worktree/monorepo/非git/明示hint/bare/旧git/hint="."）
- **成功**: 8
- **失敗**: 0
- **スキップ**: 0

| シナリオ | 期待 | 結果 |
| --- | --- | --- |
| 1. 標準（main tree・hint なし） | main root の canonical DB | PASS |
| 2. worktree（cd 後・hint なし） | main root の canonical DB（git-common-dir 経由） | PASS |
| 3. monorepo（git root 直下に .asc 無し） | sentinel 不成立 → CWD フォールバック | PASS |
| 4. 非 git | git rev-parse 失敗 → CWD フォールバック | PASS |
| 5. 明示 hint（PROJECT_ROOT 指定） | hint を尊重（後方互換） | PASS |
| 6. bare リポジトリ | dirname に .asc 無し → CWD フォールバック | PASS |
| 6b. 旧 git（--path-format 非対応 stub） | rev-parse 失敗 → CWD フォールバック | PASS |
| 7. hint="."（未指定扱い） | git 解決へ進む | PASS |

### 3.2 統合テスト（書記→canonical DB・独立再実行）

`git archive HEAD | tar -x` でクリーンソースを tmp へ展開し、worktree を作成、worktree 内 CWD で `PROJECT_ROOT` 未指定のまま `write-workflow-log.sh` を実行。

- **結果**: worktree 内に `workflow.db` が生成されない（OK）／main root の canonical DB に該当行が着地（該当行数=1・OK）。本 issue 修正の効果（worktree 横断で単一 canonical DB へ集約）を実地で実証した。

### 3.3 回帰確認（audit.sh 変更前後の FAIL 集合比較・独立再実行）

`git show main:...audit.sh`（変更前）と worktree の audit.sh（変更後）を、兄弟スクリプト（`check-comment-refs.sh` 等）を揃えた同一 tmp REPO・同一引数で実行し FAIL 集合を比較。

- **結果**: 変更前 FAIL 533 件＝変更後 FAIL 533 件、`diff` 完全一致（**回帰なし**）。
- **補足（誤検出の排除）**: 初回比較で `CODE_COMMENT_RULES`（#26）の差分が 1 件現れたが、原因は変更前 audit.sh を兄弟スクリプト無しの単独ファイルとして抽出したため #26 が SKIP されたハーネス由来のアーティファクトと特定。指摘対象 `src/agents-md.ts:788,811,812,826,828` は main にも存在する**既存**違反であり本 issue 変更ファイル（未変更の `src/agents-md.ts`）とは無関係。兄弟スクリプトを揃えて再比較したところ完全一致した。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント/型**: シェルスクリプト。`set -e` 下で command 置換失敗が中断を招かないよう `if` 条件捕捉を採用。ヘルパは source 専用で `exit`/`set -e` を持たず呼び出し元を汚染しない。問題なし。
- **旧パターン取りこぼし**: `$PROJECT_ROOT/$WORKFLOW_DIR/workflow.db` パターンを scripts/・audit.sh で grep 再確認。スコープ対象 2 ファイル（write-workflow-log.sh・audit.sh）に取りこぼしなし。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | ヘルパの解決規則コメントが ADR-132-1 と 1:1 対応 | OK | 段番号付きで追える |
| 保守性 | read/write 双方が単一ヘルパを source（規則の二重定義なし） | OK | §3.4 の論点を解消 |
| パフォーマンス | 解決は git rev-parse 1 回のみ（数十 ms） | OK | §3.1 要件充足 |
| セキュリティ | 任意 SQL 面の追加なし・パス解決のみ | OK | §3.2 要件充足 |
| 後方互換 | 明示 PROJECT_ROOT・WORKFLOW_DIR 上書きは維持 | OK | audit 走査用 PROJECT_ROOT 不変 |

### 4.2 指摘事項

#### 指摘 1: `export-ndjson.sh` は旧 CWD 基準のまま（非ブロッキング・スコープ外の申し送り）

- **重要度**: 低
- **指摘内容**: `.agent-skill-chain/source/scripts/export-ndjson.sh:25` は `WF_DB="${PROJECT_ROOT}/${WORKFLOW_DIR}/workflow.db"`（CWD 基準）のまま。worktree から引数なしで実行すると worktree ローカル DB を読むという同種の潜在挙動が残る。
- **対応状況**: 本 issue では対応しない（スコープ外）。
- **対応方法（判断根拠）**: ADR-132-1 §帰結が実装対象を「`write-workflow-log.sh:17` と `audit.sh` の WF_DB 導出」に明示限定しており、`export-ndjson.sh` は設計スコープ外。read 専用の可視化エクスポータで `[dir]` を明示引数で受ける対話ツールであり、書記/監査のクリティカルパス（SC-1/SC-2 の対象）ではない。取りこぼしではなく意図的な非スコープ。将来の一貫性向上のフォローアップ候補として進行役へ申し送る（サブは独断起票しない）。

#### 指摘 2: §0.1 の (C)/(c) ラベル重なり（非ブロッキング・字句のみ）

- **重要度**: 低
- **指摘内容**: `自己拡張ワークフロー.md` §0.1 の既存「削除前 untracked 退避（C）」と新規「削除前 ignored 成果物の目視確認（C）」がともに大文字 (C) ラベル。§0.3 では同項目を小文字 (c) で参照。
- **対応状況**: 非対応（許容）。
- **対応方法**: 文脈から対応関係は一意に読み取れ矛盾はない。字句上の軽微な不統一に留まり、機能・規約解釈への影響なし。修正は任意（進行役判断）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| `00_要求定義.md` | 更新済み（§A.1 に設計フェーズ決定を反映） | verify サブ | 2026-07-17 |
| `DECISIONS.md`（ADR-132-1/132-2） | 更新済み（PR #134 でマージ・恒久判断の正本） | verify サブ | 2026-07-17 |
| `自己拡張ワークフロー.md` | 更新済み（§0.1 (c)・§0.3 (d)(e)） | verify サブ | 2026-07-17 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合（resolve-wf-db.sh の 3 段規則が ADR-132-1 と一致・sentinel ガード実装）
- **要件と実装の整合性**: 整合（SC-1〜SC-4 を §受け入れ基準で個別確認・下記）
- **frontmatter branch（#35 ゲート）**: 00_要求定義.md の `branch: bugfix/20260717_215309-issue132-workflow-db-integrity` が実ブランチと一致・記録済み

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本変更はフレームワーク基盤スクリプト（`.agent-skill-chain/source/scripts/`・`enforcement/ci/`）の内部パス解決実装と `.agent-skill-chain/project/` 運用規約の変更であり、システム仕様書（`RULES.md`・`README.md` 等の公開仕様の記述）が説明する外部契約・利用者向け挙動を変えない（書記/監査の DB 参照先が worktree 横断で canonical に揃うのは内部整合性の改善で、利用者から見た write-workflow-log.sh の I/F・後方互換は不変）。恒久的な設計判断は `docs/maintainer/decisions/DECISIONS.md`（追跡）の ADR-132-1／ADR-132-2 へ転記済み。DOCS_RULES.md §継続追随ゲートの軽量パス（根拠付き「不要」判定 1 件）で充足。

---

## 受け入れ基準（00 §6 成功基準 SC-1〜SC-4）の充足確認

| 基準 | 内容 | 検証方法 | 結果 |
| --- | --- | --- | --- |
| **SC-1** | 複数 worktree で並行委譲した command 実行がすべて単一 canonical workflow.db に記録される | 統合テスト（§3.2）: worktree 内 CWD・PROJECT_ROOT 未指定で書記実行→main root の canonical DB に着地（該当行数=1）・worktree 内 DB 不生成を実地確認。BDD シナリオ2（worktree→main canonical）PASS | **充足** |
| **SC-2** | 「実装・レビュー済みなのに implement/verify ログ 0 件」型の誤 FAIL が出ない | 回帰確認（§3.3）: audit.sh の DB 参照が canonical に揃い、read/write が同一 DB を指すため誤 FAIL の機序が除去。変更前後で FAIL 集合完全一致（533=533・回帰なし）。書記記録が canonical へ集約されることで #3/#29 の実装前 04 誤検知が解消する構造 | **充足** |
| **SC-3** | gitignore 対象の重要監査成果物が削除前に確認・警告される、または gitignore 対象にしない/必ず commit する設計 | ADR-132-2 (d) 恒久判断の DECISIONS.md 転記完了を worktree 削除前の完了要件化（機構非依存）＋ (c) 削除前 `git status --ignored` 目視確認を `自己拡張ワークフロー.md` §0.3/§0.1 に運用規約として明文化。恒久判断は追跡ファイルで永続化されるため transient な 04 喪失があっても恒久情報は失われない（いずれか一方で可の要件を (d) 単独でも充足） | **充足** |
| **SC-4** | git 非管理環境・worktree 非使用の従来運用で挙動が回帰しない（フォールバック機能） | BDD（§3.1）: 非git/monorepo/bare/旧git の全フォールバックケース PASS。sentinel ガードで consumer モノレポの別 DB 新規作成を防止。明示 PROJECT_ROOT 尊重で後方互換。audit 走査用 PROJECT_ROOT 不変。回帰確認 FAIL 集合一致 | **充足** |

**総合判定**: SC-1〜SC-4 すべて充足。ブロッキング指摘なし（指摘1・2 はいずれも非ブロッキングの申し送り）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: DB パス解決ロジックを共有ヘルパ 1 箇所へ集約（重複排除・単一正本）。UNIX 哲学（source 専用・副作用なし・パスのみ返す）に準拠。
- **ディレクトリ構成**: `scripts/resolve-wf-db.sh` は既存 scripts/ 配下の共有ヘルパ群と同居。適切。
- **命名規則**: `resolve_wf_db_path`・`WF_DB_CANONICAL` は用途が明瞭。

### 9.2 境界・依存の確認

- **責務の境界**: write（write-workflow-log.sh）・read（audit.sh）双方がヘルパを source し同一規則を使用。呼び出し規約差はヘルパ引数で吸収。走査用 PROJECT_ROOT（audit.sh の $1）と DB パス解決を明確に分離（走査は不変・DB 導出のみ差替）。
- **依存関係**: 循環・意図しない依存なし。問題2 の退避ロジック本体は既存 issue `20260716_013937` の責務として本 issue で再実装せず（スコープ線引き遵守）。
- **指摘・推奨**: なし（境界は健全）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| resolve_wf_db_path が ADR-132-1 を正確実装 | existing_code | ヘルパ関数の実読・3 段規則の 1:1 照合 |
| BDD 8 シナリオ全 PASS | test_output | tmp 隔離での独立再実行（§3.1） |
| worktree→canonical DB 集約が機能 | observed_runtime + test_output | git archive による統合テスト（§3.2） |
| audit.sh 変更に回帰なし | test_output | 兄弟スクリプトを揃えた FAIL 集合完全一致（§3.3） |
| export-ndjson.sh はスコープ外 | existing_code | ADR-132-1 §帰結の実装対象限定を根拠 |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題1（フォローアップ候補）**: `export-ndjson.sh` の CWD 基準解決。
  - **影響範囲**: read 専用エクスポータ（可視化・診断ツール）。書記/監査のクリティカルパス外。
  - **対応方法**: 将来一貫性向上として共有ヘルパへ寄せる余地あり。進行役の判断で別 issue 化を検討（本 issue スコープ外）。

### 10.2 総括

問題1（必須コア）は共有ヘルパ化と sentinel ガードにより実測で SC-1/SC-2/SC-4 を満たし、worktree 横断の記録分散という root 原因を機構的に除去した。問題2 は ADR-132-2 の (d) 主軸（DECISIONS.md 転記完了要件・機構非依存）＋ (c) 即時運用ガードで SC-3 を運用規約として充足した。ブロッキング指摘はなく、PR 化・Issue #132 close の前提条件を満たす。
