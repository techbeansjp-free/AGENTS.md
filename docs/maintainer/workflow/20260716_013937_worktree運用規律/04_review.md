---
document_id: "ac869141-ba36-4eb0-b7c0-88ef0b6dc382"
---

# レビュー書: worktree 運用規律（命名規則とライフサイクル安全化）

**プロジェクト名**: worktree 運用規律（命名規則とライフサイクル安全化）
**作成日**: 2026 年 07 月 16 日
**最終更新**: 2026 年 07 月 16 日

> 本 04 は verify-and-close（レビューフェーズ）の成果物。独立レビュアー（実装作成者とは別サブエージェント・opus）が
> REVIEW_RULE.md / PHASES.md §監査観点 / REVIEW_DUAL_LENS.md（二観点・両リスト必須）に従い作成した。
> 対象 commit: `0f1a95e`（T1〜T6 実装済み）。レビュー中に指摘 2 件を検出し本レビュアーが修正した（§4.2）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / クローズ前最終チェック（B 命名機械強制・B' 配置一元化・C 削除前退避・CI audit #39/#40 の非破壊拡張が 00〜03 の要求・要件・設計どおり実装され、既存 enforcement #1〜#38・既存 hook を破壊しないことの検証）。

### 1.2 レビュー対象（必須）

- **実装範囲**: `PreToolUse.sh`（R7 命名 Tier1 強制・R8 削除前 untracked 退避＋純関数群）／`audit.sh`（#39 find prune 規約・#40 非準拠ブランチ名事後検知）／`setup.sh`（`.worktree/.gitignore` 生成）／`worktree-gitignore.template`（新規）／`enforcement/README.md`（#39/#40 追記）／`自己拡張ワークフロー.md` §0（命名規則正本・§0.2 deny ミラー手順）／`worktree-naming-grandfather.txt`（baseline）／`test/test-worktree-discipline.sh`（単体/結合 74 件）。03 タスク T1〜T6 に対応。
- **レビュー期間**: 2026-07-16 ～ 2026-07-16
- **レビュー担当者**: 独立レビュアー（verify-and-close 実行サブエージェント・opus。実装作成者とは別）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1 B' 配置基盤（C3/C4） | `worktree-gitignore.template`（`*`＋`!.gitignore`）新規・`setup.sh` に `.worktree/.gitignore` 未存在時生成・npm-pack ガード | 2026-07-16 | implement-feature | 完了 |
| T2 B Tier1 命名強制（C1/R7） | `_wt_effective`/`git_subcommand_of`/`validate_name`/`validate_branch_ref`/`validate_worktree_path`/`_wt_extract_creation`/`worktree_name_enforce`＋R7 | 2026-07-16 | implement-feature | 完了 |
| T3 C 削除前 untracked 退避（C2/R8） | `is_worktree_destroy`/`worktree_untracked_rescue`/`_wt_purge_trash`/`worktree_destroy_rescue`＋R8 | 2026-07-16 | implement-feature | 完了 |
| T4 CI audit Tier2/prune（C5/C6） | `check_find_worktree_prune`（#39）・`check_worktree_branch_naming`（#40）＋grandfather baseline | 2026-07-16 | implement-feature | 完了 |
| T5 命名規則正本文書化（C7） | `自己拡張ワークフロー.md` §0 命名規則・§0.2 deny ミラー手順・README 失敗条件表 #39/#40 | 2026-07-16 | implement-feature | 完了 |
| T6 配備同期・回帰（ADR-1/SC-7） | 既存 #1〜#38・既存 hook テストのグリーン実測（非破壊確認） | 2026-07-16 | implement-feature | 完了 |

### 2.2 実装内容の詳細

#### タスク T2/T3: R7 命名 Tier1・R8 削除前退避（PreToolUse.sh）

- **実装内容**: `# >>> worktree-discipline lib (BEGIN/END)` マーカ間に純関数群を**追加のみ**で実装（既存 R1〜R6・既存関数は無改変）。R7 は `TOOL=Bash && CMD 非空` のとき作成形（`worktree add`／`switch -c/-C`／`checkout -b/-B`／`branch <name>` 作成形）と確定でき命名違反のときのみ exit 2。R8 は削除形（`worktree remove`〈--force 含む〉／`clean -x|-X`／clean が `.worktree` 対象）の前に untracked を退避先へ `cp -a` 保全（block しない・保全のみ）。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`（+358 行）
- **実装方法**: トークナイザ `_wt_effective` がラッパー（command/env/nohup/…）・VAR=val・パス付き git・グローバルオプション（space/=/結合形）をスキップし `WT_ARGV` を確定。R7/R8 双方が同じ `WT_ARGV` を再利用（CQRS: Query＝抽出、Command＝退避）。fail-open/fail-closed の非対称（作成確定＋違反のみ block、曖昧/listing/対象外/非 git は allow）。
- **確認事項**: bare `--exec-path` は `return 1`（サブコマンド無し＝allow）で実 git 2.43.0 の挙動に一致（§4.2 指摘1 で 02 記述を実装に合わせて是正）。

#### タスク T4: CI audit #39/#40（audit.sh）

- **実装内容**: #39 は追跡対象シェル（`enforcement/*.sh`・`scripts/*.sh`）のルート起点 unbounded `find "$PROJECT_ROOT" -` が `.worktree` prune を欠く行を FAIL（ベストエフォート lint・self-match 回避）。#40 は全ローカルブランチ名を列挙し grandfather baseline 未登録かつ命名規則非準拠のみ FAIL。多層 SKIP（非 git／`WORKTREE_NAMING_AUDIT_ENABLED=false`／baseline 不在）。
- **変更ファイル**: `.agent-skill-chain/source/enforcement/ci/audit.sh`（+119 行）・`enforcement/README.md`（#39/#40 行）・`worktree-naming-grandfather.txt`
- **実装方法**: 末尾 `check_*` 呼び出し列に `check_find_worktree_prune`／`check_worktree_branch_naming` を追加。#40 は `_audit_valid_branch_ref` を自己完結実装（hook の `validate_branch_ref` と同型）。
- **確認事項**: baseline 不在時 SKIP により初回導入で既存多数ブランチを誤 FAIL させない（SC-7 非破壊担保）。

#### タスク T1: `.worktree/` 配置基盤（setup.sh・template）

- **実装内容**: `.worktree/.gitignore`（`*`＋`!.gitignore` の 2 行）を未存在時のみ生成。ルート `.gitignore` は不変。テンプレ名を非 `.gitignore` にして npm-packlist の 2 階層ネスト除外を回避（`runtime/.gitignore` と同型）。
- **変更ファイル**: `setup.sh`（+22）・`worktree-gitignore.template`（新規）・`verify-npm-pack.sh`（+3 ガード）
- **確認事項**: テンプレ欠落は非致命 WARN（fail-safe）。

---

## 3. テスト結果の確認

### 3.1 単体テスト・結合テスト（本 issue 新規・実測）

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-16（本レビュー時に再実行・実測）
- **コマンド**: `bash test/test-worktree-discipline.sh`
- **テストファイル数**: 1（単体 validate_name/validate_branch_ref/validate_worktree_path/git_subcommand_of/作成形抽出・is_worktree_destroy＋結合 R7/R8/audit #39/#40）
- **テストケース数**: 74
- **成功**: 74
- **失敗**: 0
- **スキップ**: 0

> 注: 本レビューで test-worktree-discipline.sh に BDD 構造コメント（§シナリオ/Given/When/Then）を追加（§4.2 指摘2）後に再実行し、74/74 PASS を維持（コメント追加のためテスト挙動不変）。

#### 既存テスト（非破壊確認・実測）

| テストスイート | コマンド | 結果 |
| -------------- | -------- | ---- |
| PreToolUse hook（既存 R1〜R6） | `bash test/test-pretooluse-hook.sh` | **PASS=192 FAIL=0** |
| audit（既存 #1〜#38） | `bash test/test-audit.sh` | **PASS=129 FAIL=0** |
| worktree 規律（新規） | `bash test/test-worktree-discipline.sh` | **PASS=74 FAIL=0** |

#### audit.sh 自己実行（正本 audit 実測）

`bash .agent-skill-chain/source/enforcement/ci/audit.sh` を実行（EXIT=1）。FAIL は以下 5 件で、**#39/#40 は新規 FAIL を出さず**（それぞれ `[audit] checking ...` の後 FAIL 無し）、以下はいずれも本 issue 実装と無関係な既存 FAIL であることを `git diff --name-only main...HEAD` で確認済み（当該ファイルは本ブランチ未変更）:

| FAIL | 対象 | 本 issue 関連 |
| ---- | ---- | ------------- |
| 04_review 未更新 | `20260716_013937_worktree運用規律` | **本 issue 自身**（本 04 作成で解消・想定内） |
| docs 更新要否未記載 | `20260715_190000_S1_audit_sh_モード分岐/04_review.md` | 別 issue（未変更） |
| コメント外部参照禁止違反 | `src/agents-md.ts:788/811/812/826/828` | 別ファイル（未変更・既存 FAIL） |
| 実装前 04 作成 | `20260715_190000_S1_audit_sh_モード分岐` | 別 issue（未変更） |
| システム仕様書が作業用 issue 参照 | `docs/00_review/*.md` | 別ファイル（未変更・既存 FAIL） |

**結論**: #39/#40 の新規 FAIL 無し。既存 #1〜#38 の FAIL 集合は実装前と不変（FAIL 起因ファイルはすべて本ブランチ未変更）。本 04 作成により「04_review 未更新」FAIL は解消する。

### 3.2 統合テスト

R7/R8 結合は正本 hook を stdin JSON で駆動（tmp 隔離・本リポ `.claude/`・`.worktree/`・`workflow.db` 非汚染）。audit #39/#40 は tmp 隔離 git リポ・フィクスチャで正本 audit.sh を駆動。実測 74/74 PASS。

### 3.3 E2E テスト

実機 git 2.43.0 の挙動（bare `--exec-path` の終了・space 区切りグローバルオプション消費）を observed_runtime として実装・テストへ反映済み（02 §3.1 脚注・test round2）。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードスタイル

- **リント結果（audit ベストエフォート lint #39）**: 本 issue 追加コードに新規 FAIL 0 / 既存 scoped find 誤検知 0。
- **フォーマット**: 問題なし（既存 PreToolUse.sh/audit.sh の記法・コメント規約に整合。日英併記の block メッセージ・`[enforcement:block]`/`[PreToolUse:info]` prefix 区別を踏襲）。
- **型チェック**: 対象外（bash）。純関数は `LC_ALL=C` でロケール非依存・バイト長判定を保証。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 関数責務が Query（抽出）/Command（退避）/enforce（R7/R8）に分離され命名が明確 | OK | BEGIN/END マーカで lib 境界が明示され単体抽出可能 |
| 保守性 | 既存 R1〜R6・既存関数を無改変で追加のみ（ADR-1）。R7/R8 が同一トークナイザ `_wt_effective` を共有 | OK | 二重定義なし・1 ファイル 1 責務 |
| パフォーマンス | 削除前退避は untracked のみ `cp -a`・`.git` 実体除外・lazy purge。命名チェックは純 bash 文字列処理 | OK | 大量 untracked 時の閾値 WARN は将来課題（§10） |
| セキュリティ | 拡張データを source せず引数で処理。eval なし。cp/mkdir に git 由来相対パスを渡すのみ（メタ文字 eval 経路なし）。fail-closed/fail-safe を保全 | OK | 既存 hook のセキュリティ設計原則に整合 |

### 4.2 指摘事項

#### 指摘 1: 02_設計 §3.1 状態機械の `--exec-path` 記述が実装・実機挙動と不整合（既知残課題2）

- **重要度**: 中
- **指摘内容**: 02 のトークナイザ・コードブロックが `--exec-path` を「引数なし既知フラグ（`((i++))`＝1 進み）」グループに置いていた。しかし正本実装（`PreToolUse.sh` `_wt_effective`）は bare `--exec-path` を `return 1`（サブコマンド無し扱い＝allow）とし、`test/test-worktree-discipline.sh` の `git_subcommand_of "git --exec-path status" == ""` 回帰テスト・実機 git 2.43.0（git 自体がここで終了）と一致していた。実装側が正しく、02 記述側が是正候補だった。
- **対応状況**: 完了（本レビュアーが修正）
- **対応方法**: 02 §3.1 コードブロックの `--exec-path` を専用 case `--exec-path) return 1 ;;` へ分離し、脚注を「実 git の終了挙動に忠実に `return 1`＝allow とする」旨へ是正。あわせて「実装は `_wt_effective`（`WT_ARGV` を確定）へ分離し R7/R8 が再利用する」構造対応の 1 文を追記（設計と実装の構造整合を明示）。evidence_source: observed_runtime（実機 git 2.43.0）＋existing_code（PreToolUse.sh:199）＋test_output（test round2）。

#### 指摘 2: test-worktree-discipline.sh が TEST_BDD_FORMAT の per-シナリオ/GWT コメントを欠く

- **重要度**: 低〜中
- **指摘内容**: 本テストはファイル冒頭に `ユースケース:` は持つが、各テストグループ（`echo "== ... =="` 単位）に `シナリオ:`・`Given/When/Then` インラインコメントを欠いていた。同リポの `test/test-audit.sh` は TEST_BDD_FORMAT に従い 287 個の GWT コメントを持つ（確立された作法）。PHASES §監査観点・REVIEW_RULE のテストコード化フォーマット要件に対する逸脱。
- **対応状況**: 完了（本レビュアーが修正）
- **対応方法**: 表駆動 bash の性質（各 `ev`/`ee`/`assert_*` は 1 行アサーション）を踏まえ、論理テストグループ（9 セクション）単位で `# シナリオ:`＋`# Given:`/`# When:`/`# Then:` コメントブロックを追加し、各セクションを 03 の `T-B*/T-C*/T-D*` ID・01 の UC シナリオへ対応付け。コメント追加のためテスト挙動は不変（追加後も 74/74 PASS を実測確認）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ------------ | -------- | ------ | ------ |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（GitHub Issue #119 記録済み） | 独立レビュアー | 2026-07-16 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（SC-1〜10・BR-1〜16・UC1〜4） | 独立レビュアー | 2026-07-16 |
| [`02_設計.md`](./02_設計.md) | 更新済み（本レビューで §3.1 `--exec-path` 是正） | 独立レビュアー | 2026-07-16 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（T1〜T6・BDD T-* 対応表） | 独立レビュアー | 2026-07-16 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（本レビューで 02 §3.1 の `--exec-path` 記述を実装に合わせて是正した後）。
- **要件と実装の整合性**: 整合している（01 UC1〜4・SC-1〜10 が 03 BDD `T-B1〜T-N1` へ 1:1 対応し、各 T-* が 74 件のテストで検証されている）。
- **コメント**: 03 BDD セクションの Gherkin と test-worktree-discipline.sh のセクション（指摘2 対応後）が対応付く。

---

## 6. パフォーマンス確認

### 6.1 パフォーマンステスト結果

削除前退避は untracked ファイルのみを `cp -a`（`.git` 実体除外）し、lazy purge は保持期限（既定 14 日・`WORKTREE_TRASH_RETENTION_DAYS`）超過エントリのみ削除。命名チェックは純 bash 文字列処理でプロセス起動を伴わない。実用時間内に完了（SC 非機能要件充足）。

### 6.2 ボトルネックの確認

大量 untracked を含む worktree の一括退避コピー時間が理論上のボトルネックだが、copy 失敗は WARN のみで原本・削除を妨げない（fail-safe）。閾値 WARN は将来の任意強化（§10）。

---

## 7. セキュリティ確認

| 項目 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 認証・認可 | R7/R8 は ROLE 非依存で Bash 前置検査。orchestrator は R2/R3 で Bash 自体が block されるため R7/R8 到達せず（既存境界を破らない） | OK | scribe は R5 で write-workflow-log.sh 限定のため作成/削除コマンド到達せず |
| データ保護 | 削除前 untracked を copy 退避し不可逆消失（2026-07-15 事故型）を防止。move でなく copy で原本保護 | OK | SC-3/SC-4 充足 |
| 入力検証 | 拡張データを source せず引数処理。`validate_name` が危険文字・制御文字・`..`・先頭`.`/`-`・`.lock`・200 バイト超を排除。eval なし | OK | コード注入ベクタ無し（既存設計原則に整合） |
| deny バイパス防止 | `.worktree/**` の Read/Grep/Glob deny ミラーで close/** 等のネスト経由バイパスを防止 | OK（設計・文書） | settings.json は自動配布外＝手動ミラー（§0.2・下記残課題1） |

---

## docs 更新

（DOCS_RULES §継続追随ゲート判定・軽量パス）

- 要否: **不要**
- 対象: なし（`docs/` システム仕様書の更新は不要）
- 理由: 本変更の enforcement 失敗条件の**正本**は `.agent-skill-chain/source/enforcement/README.md`（本 issue で #39/#40 を追記済み・実測 lines 390-391）。システム仕様書 `docs/04_機能設計/enforcement/README.md` は失敗条件の enumeration を「失敗条件の定義と実装の所在は enforcement/README.md §失敗条件と差し戻し を正本とする」と明示委譲し、本文では代表例（`#3・#25・#31・#32 等`）のみを挙げる設計である。新規条件 #39/#40 を docs/ 側へ逐次列挙する構造ではないため、as-built 同期上の更新は発生しない。R7/R8 の命名/退避規律の運用正本は `.agent-skill-chain/project/自己拡張ワークフロー.md` §0（本 issue で追記済み）であり docs/ の対象外。よって指摘 0 の軽量パスで判定を確定する（evidence_source: existing_code＝docs/04_機能設計/enforcement/README.md:29 の委譲記述）。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。1 ファイル 1 責務・UNIX 哲学（既存機構の最小追加）。ADR-1（正本 `source/` のみ改修）・ADR-3（拡張データを source しない）・ADR-5（copy による原本保護）を実装が満たす。
- **ディレクトリ構成**: OK。worktree 一元配置 `.worktree/`・退避先 `.claude/.worktree-trash/`・baseline は `.agent-skill-chain/project/`（project 具体は project 側）でコア/project 境界に整合。
- **命名規則**: OK。`<type>/<YYYYMMDD_HHMMSS>/<固有名>`（type 5 種）が hook・audit・文書で一貫。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。Query（`git_subcommand_of`/`_wt_extract_creation`/`is_worktree_destroy`）と Command（`worktree_untracked_rescue`/`_wt_purge_trash`）と enforce（`worktree_name_enforce`/`worktree_destroy_rescue`＋R7/R8）が分離。
- **依存関係**: 意図しない依存・循環なし。R7/R8 は既存 R1〜R6 の後段に追加のみで、既存判定順（scribe 最優先→subagent→orchestrator）を変更しない。orchestrator の Bash は R3 で block されるため R7/R8 は subagent worker にのみ実効。
- **指摘・推奨**: hook 非経由の削除（別プロセス/別ツール）は捕捉外（残余リスク・01 §5 で開示済み・隠さない誠実な限界開示）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| #39/#40 が新規 FAIL を出さず既存 #1〜#38 の FAIL 集合が不変 | test_output＋existing_code | 正本 audit.sh 実測＋`git diff --name-only main...HEAD`（FAIL 起因ファイル未変更） |
| 既存 hook・audit 非破壊 | test_output | test-pretooluse-hook 192/192・test-audit 129/129・test-worktree-discipline 74/74 実測 |
| bare `--exec-path` は return 1 が正 | observed_runtime＋test_output | 実機 git 2.43.0＋round2 回帰テスト |
| settings.json deny 非適用が妥当（残課題1） | existing_code＋human_decision | 03 ADR-6・自己拡張ワークフロー.md §0.2（自動配布外・手動ミラー・既存 close/** と同型） |
| 命名 -b 必須（`worktree add` 無 -b で basename が非準拠→reject）が意図的 | existing_code | 03 T-B2・test line 93/118 と整合（DWIM basename は単一階層で validate_branch_ref を通らない） |

---

## レビュー二観点（REVIEW_DUAL_LENS §2/§3・両リスト必須）

### A. 敵対的観点リスト（反証・破壊を試み、不確実は要修正に倒す）

1. **bare `--exec-path` の状態機械が実機と食い違うのでは** → 食い違いは 02 記述側にあり実装は正しい。02 を是正（指摘1）。結論: 是正済み。
2. **`worktree add` を `-b` 無しで準拠 path に打つと誤 reject では** → 実 git は path basename を DWIM ブランチ名にするため、単一階層 basename は命名規則（3 階層）に非準拠→reject が**設計意図どおり**（03 T-B2・test line 93）。結論: 問題なし（意図的仕様）。
3. **compound コマンド（`cd x && git worktree add badname`）で検知漏れでは** → `worktree_name_enforce`/`worktree_destroy_rescue` が `;`/`&`/`|` でセグメント分割し各セグメントを `_wt_effective` に通すため検知。結論: 問題なし。
4. **R8 退避が実削除の前に走る保証は** → PreToolUse はツール実行前フックであり、退避（copy・block しない）後に本来の削除コマンドが実行される。copy のため原本も残り退避失敗が原本を壊さない。結論: 問題なし。
5. **fail-safe の破れ（対象外/内部エラーで誤 block・ロックアウト）** → 非 git・曖昧・listing・退避失敗・date 非 GNU（purge スキップ）はすべて allow 側／WARN。作成確定＋命名違反のみ block。test line 121-126 が listing 誤 block ゼロを実証。結論: 問題なし。
6. **既存 #1〜#38・既存 hook を壊すのでは** → 追加のみ（BEGIN/END lib・末尾 check_* 追加）。test 192/129/74 全 PASS・audit の既存 FAIL 集合不変を実測。結論: 非破壊確認。
7. **`clean -xf`（path 省略）が CWD 全 untracked を退避し肥大化** → 検知対象だが block せず WARN 止まり・lazy purge で肥大抑制。設計許容（00 §7.1・SC-5）。結論: 残余として許容（§10 に将来強化）。
8. **#40 が初回導入で既存多数ブランチを誤 FAIL** → baseline 不在時 SKIP＋grandfather 救済＋gate（`WORKTREE_NAMING_AUDIT_ENABLED`）の三重 fail-open。test line 162-167 で SKIP を実証。結論: 問題なし（SC-7 担保）。
9. **テストが BDD フォーマット要件を満たさない** → per-シナリオ/GWT を欠いていた（指摘2）。是正済み。結論: 是正済み。
10. **注入ベクタ（拡張データ source・eval）** → 拡張は引数処理のみ・eval/source なし・厳密文字種/危険文字排除。結論: 問題なし。

### B. must-preserve リスト（壊してはならない不変条件と保持確認）

1. **既存 R1〜R6 の判定順・振る舞い**（scribe 最優先→subagent→orchestrator、sqlite3 全ロール block、orchestrator Bash/Edit block）→ 無改変・追加のみ。保持（test-pretooluse-hook 192/192）。
2. **既存 audit #1〜#38 の FAIL/PASS 集合** → 末尾に #39/#40 を追加のみ。既存 check 関数無改変。保持（test-audit 129/129・実 audit の既存 FAIL 集合不変）。
3. **fail-open の非対称**（listing/曖昧/対象外は誤 block しない）→ 保持（過去の過剰 block ロックアウト事故を再発させない・test line 121-126）。
4. **ルート `.gitignore` 不変**（`.worktree/` 追跡除外は `.worktree/.gitignore` 自身で完結）→ 保持（setup.sh はルート .gitignore を touch しない・SC-8）。
5. **worktree 必須運用（自己拡張ワークフロー.md §0）** → §0 に命名規則を追記（拡張）し既存運用を破壊しない。保持。
6. **既存 close/** deny の手動維持パターン** → `.worktree/**` deny も同型の手動ミラー（§0.2）で既存パターンと一貫。保持。
7. **hook のセキュリティ設計原則**（拡張を source せずデータ処理・fail-closed/fail-safe）→ 追加コードが同原則に整合。保持。
8. **document_id 不変性**（既存 00/01/02/03 の document_id を変更しない）→ 02 本文のみ是正し frontmatter document_id は不変。保持。

> ラウンド継承（§6）: 本レビューは指摘 2 件を検出→修正し、修正後に上記 must-preserve（特に #1/#2/#3＝既存非破壊・fail-open）が退行していないことを 74/192/129 の再実測で確認。指摘 0 へ収束。

---

## 10. 課題と改善点

### 10.1 発見された課題（本 issue の残余・派生。独断での issue 起票はしない）

- **課題1（残課題1・判断）**: `.claude/settings.json` の `.worktree/**` deny（3 エントリ）はメイン作業ツリー直接編集禁止・かつ settings.json が git 追跡外/配布外のため未適用。→ **判断: 実装として妥当**。03 ADR-6・自己拡張ワークフロー.md §0.2 が「setup/enforce は settings.json を管理しない＝手動ミラー」と明記し、既存 `close/**` deny も同じ手動維持パターン。本レビュアー（サブ・メイン作業ツリー編集不可）の対応範囲外。**残作業**: 進行役/ユーザーが本リポ `.claude/settings.json` へ 3 エントリを手動追記（現状 grep 一致 0＝未適用）。これは git 追跡下の成果物の欠陥ではなく運用手順であり、close を妨げない。
- **課題2（残課題2・対応済み）**: 02 §3.1 `--exec-path` 記述の実装不整合 → 本レビューで 02 を是正済み（指摘1）。

### 10.2 改善提案（任意・将来）

- **改善1**: 大量 untracked の退避コピーに閾値 WARN（件数/容量）を追加。効果: 肥大化・遅延の早期可視化（現状も fail-safe で機能は担保）。
- **改善2**: `_wt_purge_trash` の日付解釈が GNU `date -d` 依存（非 GNU では purge スキップ）。効果: BSD/macOS でも保持期限パージを効かせる（現状は fail-safe で原本・削除は非影響）。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

- 「docs 更新」節（上記）のとおり、`docs/` システム仕様書の更新は**不要**（enforcement 失敗条件の正本委譲構造・軽量パス判定・指摘 0）。

### 11.2 システム仕様書の更新状況

- 更新が不要な項目: `docs/04_機能設計/enforcement/README.md`（失敗条件 enumeration を source 正本へ委譲する構造のため #39/#40 の逐次追記は不要）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（既存機構の最小・非破壊拡張。Query/Command/enforce の責務分離・fail-safe 全経路・注入ベクタ無し）。
- **テスト品質**: 良好（単体/結合 74 件で作成形/削除形/audit/非破壊を網羅。01 UC↔03 T-*↔テストの追跡可能。BDD フォーマット是正済み）。
- **ドキュメント品質**: 良好（00〜03 テンプレート必須セクション充足・document_id 完備・02 の実装不整合を是正）。
- **総合評価**: **合格**（指摘 2 件はいずれも本レビューで修正済み・指摘 0 へ収束。既知残課題1 は運用手順として妥当で close を妨げない）。

### 12.2 承認状況

- **レビュー承認者**: 独立レビュアー（verify-and-close・opus）
- **承認日**: 2026-07-16
- **承認コメント**: SC-1〜SC-10 の受け入れ基準を実装・テストで確認。#39/#40 新規 FAIL 無し・既存 #1〜#38 FAIL 集合不変・既存 hook/audit グリーンを実測。トップレベル issue の close 判断（close/ 移動）は本 command 完了後に進行役が別途行う。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- 正本: `.agent-skill-chain/source/enforcement/README.md`（#39/#40）・`.agent-skill-chain/project/自己拡張ワークフロー.md` §0/§0.2
- 実装: `PreToolUse.sh`（R7/R8）・`audit.sh`（#39/#40）・`setup.sh`・`worktree-gitignore.template`・`test/test-worktree-discipline.sh`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ（実装は implement-feature で完了）

## 15. 次のステップ

- 本 04_review 承認後、トップレベル issue の完了確認とクローズ（`docs/maintainer/workflow/close/` への移動）は**進行役が別途判断・確定**する（GitHub 連携時は PR 経由・direct push 禁止）。本レビュアーはここで verify-and-close を完了とする。
