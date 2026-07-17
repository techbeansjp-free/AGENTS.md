---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "15d2b9c9-0504-4a32-a299-8813b313bde1"
---

# レビュー書: worktree 記録 commit 漏れ検知（R9 / 失敗条件 #41）

**プロジェクト名**: worktree 記録 commit 漏れ検知（issue 記録のライフサイクル管理・commit 規律）
**作成日**: 2026 年 07 月 17 日
**最終更新**: 2026 年 07 月 17 日

> **重要**: 本レビューは独立レビュー（implement-feature を実施した別エージェントの成果物を、事前結論を鵜呑みにせずゼロベースで再検証）である。全テストを再実行し、実測ログに基づいて判定した。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
> **必須参照**: [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)。レビュー深度 = **full**（新規 lib + 正本 hook 拡張 + 新規テストを含む中〜大規模）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証（受け入れ基準 SC-1〜SC-6 の充足、既存 R7/R8 の非破壊、finding-2／finding-5 の正しい反映を独立検証し、close 可否を判定する）。

### 1.2 レビュー対象（必須）

- **実装範囲**: 03_実装計画 T1〜T7。共有 lib `enforcement/lib/worktree_record_guard.sh`（環境判定・未 commit 判定・未 push 判定〈pathspec 対称〉・検知コア・reporter・バイパス）／`PreToolUse.sh` への R9（削除前ゲート）統合／`verify-and-close.md` への終了時契約（アダプタ B）追記／`enforcement/README.md` への失敗条件 #41 登録／新規テスト `test/test-worktree-record-guard.sh`／`test/run-all.sh` への登録。
- **レビュー期間**: 2026-07-17（独立レビューセッション）
- **レビュー担当者**: 独立レビューサブエージェント（選定ティア: opus。根拠: 設計・レビュー・監査＝opus）

### 1.3 前提整合（main 追随）

本ブランチ `feature/20260717_092850/wt-record-finding-design` を最新 `origin/main`（`b2d41e6` = v0.1.42、S-2 github_native 採用 PR#126 マージ済み）へ **rebase**（コンフリクト無し）済み。追跡対象の issue ドキュメント 00〜03 は新 `.gitignore` パターンでは無視されないこと（`git ls-files` で追跡継続を確認）を検証済み。

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| --- | --- | --- | --- | --- |
| T1〜T4 共有 lib | `worktree_record_guard.sh` 新規（環境判定・未 commit・未 push・検知コア・reporter・main） | 2026-07-17 | 実装エージェント | 完了 |
| T5 R9 統合 | `PreToolUse.sh` へ削除前ゲート R9 を R8 直後・allow 直前に併置 | 2026-07-17 | 実装エージェント | 完了 |
| T6 終了時契約 | `verify-and-close.md` へアダプタ B（`bash <lib> <target>` の終了コード契約）追記 | 2026-07-17 | 実装エージェント | 完了 |
| T7 登録・テスト | `enforcement/README.md` #41 登録＋新規テスト（PASS=39）＋`run-all.sh` 登録 | 2026-07-17 | 実装エージェント | 完了 |

### 2.2 実装内容の詳細（独立検証コメント付き）

#### 共有 lib `enforcement/lib/worktree_record_guard.sh`（T1〜T4）

- **実装方法**: `source` 時は関数定義のみ（副作用ゼロ）、直接実行時のみ末尾ガード `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` で `_wt_record_main` を起動（02 §2.2.1 の 2 経路共有を単一正本で実現）。
- **finding-2（未 push の pathspec スコープ対称）**: `_wt_record_unpushed` が `git rev-list --abbrev-commit "${base}..HEAD" -- "$root"`（`base=@{u}`／`origin/<branch>` フォールバック）で **記録格納ルートを pathspec として付与**し、記録に無関係なコード・テスト変更のみの未 push を数えない。**独立検証**: 実スクリプトを隔離 git リポで実行し、記録外パス（`enforcement/dummy.sh`）のみの未 push コミットで `RECORD_UNPUSHED` が空、記録ファイル変更コミット追加で非空になることを確認（test RG-T3b / RG-T3a、後述 3.1）。→ **反映正しい**。
- **finding-5（パスベースのスコープ・作成時刻不参照）**: `_wt_record_env_gate` は絶対パスを `.worktree/<type>/<YYYYMMDD_HHMMSS>/<name>`（type ∈ feature/bugfix/hotfix/release/chore）へ照合するのみで、**作成時刻・baseline を一切参照しない**（コード上に時刻比較・baseline 参照が存在しないことをソース精読で確認）。導入前相当（`bugfix/20250101_000000/legacy`）の準拠パスでも `IN_SCOPE=1`。→ **反映正しい**（test RG-T1b/T1b2）。
- **fail-safe**: 非 git・git 不在・非準拠パス・upstream/origin 未解決・rev-list 失敗はすべて SKIP（allow 側）。block は「記録漏れ確証時」のみ。
- **バイパス（ADR-4）**: `ASC_WORKTREE_CLOSE_BYPASS` を A・B が同一参照。通過時は stderr へ明示警告（監査痕跡）。

#### R9 統合（T5）

- **実装方法**: R8 呼び出し（`worktree_destroy_rescue "$CMD"`）の**直後・最終 `allow` の直前**に独立ブロックとして併置。R8 本体（`worktree_untracked_rescue`／`worktree_destroy_rescue`）は**一切編集していない**（diff 上、既存関数への変更行ゼロ）。
- R9 は R8 と同一の既存ヘルパ（`_wt_effective`／`WT_ARGV`／`is_worktree_destroy`／`WT_DESTROY_PATH`）を再利用し、同一の正規化（`;`/`&`/`|` 分割）・同一のディスパッチ（`case worktree|clean`）・`WT_DESTROY_PATH` 空時の `.` 既定を用いる。**構造が R8 の `worktree_destroy_rescue` の忠実なミラー**であり、検知結果に応じ `worktree_record_reject >&2` → `exit 2`、バイパス時は警告のみで allow へ落ちる。
- fail-open: lib 不在（`-f` 判定）・関数未定義（`declare -F`）・非 git・非準拠パス・判定不能は SKIP。

#### 終了時契約（T6）・#41 登録（T7）

- `verify-and-close.md` クローズアウトへ「記録 commit・push 漏れ検知（終了時契約・アダプタ B）」を追記。A（hook）非経由抜けを完了条件で補う二重担保。同一 lib を単一正本として参照。
- `enforcement/README.md` の失敗条件レジストリへ **#41** を新規追加（#40 の次番号・重複なし）。R7（命名）・R8（物理退避）とは別レイヤーであり、既存条件と検査対象が交差しない。

---

## 3. テスト結果の確認

### 3.1 単体・結合テスト（新規: test-worktree-record-guard.sh）

#### テスト実行結果（実測）

- **実行日**: 2026-07-17（独立レビューにて再実行）
- **テストファイル**: `test/test-worktree-record-guard.sh`（隔離 tmp・ローカル bare origin・正本 hook を stdin JSON で駆動）
- **テストケース数**: 39
- **成功**: 39
- **失敗**: 0
- **スキップ**: 0
- **結果**: `PASS=39 FAIL=0 / 全テスト PASS`（実装者主張の PASS=39 を独立に再現）

主要ケースと受け入れ基準の対応（抜粋。全対応は §4 map-coverage 参照）:

| ケース | 検証内容 | 対応 SC / finding |
| --- | --- | --- |
| RG-T2a/T2b/T2c | 追跡済み変更・未追跡一式（-uall 個別展開）・90_issues.md 検知 | SC-1 / finding-1・finding-3 |
| RG-T2b2 | 既定 -unormal は未追跡ディレクトリを畳み空振り（-uall の必要性の対照実証） | finding-1 |
| RG-T2d | memo/ のみ変更は誤検知しない | SC-1 |
| RG-T3a/T3b | 記録変更未 push を検知／記録無関係コードのみ未 push は非検知 | SC-3 / **finding-2 対称** |
| RG-T3c/T3d/T3e | stale 警告付与／upstream 未設定 origin フォールバック／origin 未解決 SKIP | SC-3 / ADR-2 |
| RG-T4a/T4b | 既定 block（非 0+レポート）／明示バイパス通過（exit 0+警告） | SC-2 / ADR-4 |
| RG-T5a/T5b/T5f | R9 削除前 block／事故同型（未追跡 00〜03 の remove --force）block／バイパス痕跡 | SC-1・SC-5・SC-2 |
| RG-T5c/T5d/T5e | 漏れなし削除素通り／非削除形素通り／非準拠パス素通り | fail-open |
| RG-T1a〜T1e | 非準拠パス・非 git・git 不在・準拠パス（時期非依存）の環境判定 | SC-6 / **finding-5** |
| RG-T6a/T6b/T6c | B 経路: 記録漏れ非 0／漏れなし 0／非 git 0 | SC-1（B） |
| RG-T7reg/T7b/T7c | #41 README 登録／一般 fail-open／グランドファザリング | SC-4・SC-6 |

#### 失敗したテスト

なし（新規テストは 39/39 PASS）。

### 3.2 既存機構の非破壊テスト（SC-4）

- **test-worktree-discipline.sh**: `PASS=115 FAIL=2`。実装前後で同一集合（実装者主張と一致）。
- **独立検証（2 件の FAIL は環境依存であり本実装と無関係）**:
  - 失敗 2 件はいずれも `finding-5` 系（`root供給: repo直下 .worktree accept` / `リポジトリルート直下の絶対 .worktree path は exit 0`）。両ケースは `$REPO_ROOT/.worktree/...` を組み立てるが、本 worktree の `$REPO_ROOT` 自体が `.../.worktree/feature/20260717_092850/wt-record-finding-design`（= `.worktree` 配下）であるため、**パスが `.worktree` を二重に含み**、`validate_worktree_path`（R7・**本実装は未変更**）が「repo_root 直下の `.worktree/` に限定」する正当なセキュリティ挙動により reject する。
  - **実証**: `validate_worktree_path` を抽出し、`.worktree` を含まないクリーンな repo_root では **rc=0（accept）**、`.worktree` 配下の repo_root では **rc=1（reject）** を再現。これは nested-worktree 開発環境特有のテストフィクスチャの脆さ（REPO_ROOT が `.worktree` 配下であることを想定していない）であり、**R9／record-guard の追加とは無関係な既存の環境依存問題**。`validate_worktree_path` は本 PR で 1 行も変更していない（diff で確認）。
- **結論**: R9 は R8 の関数本体を変更せず、既存ヘルパを再利用する併置レイヤーであり、SC-4（非破壊）を満たす。

### 3.3 全体テストスイート（run-all.sh）

- **実測**: `合計=24 PASS=17 FAIL=1 SKIP=6`。
  - `test-worktree-record-guard`: **[PASS]（PASS=39 FAIL=0）**。
  - 唯一の `[FAIL]` は `test-worktree-discipline`（上記 3.2 の環境依存 2 件のみ。本実装無関係）。
  - SKIP 6 件はいずれも `npm/node_modules` 不在による依存欠如（E2E/CLI/parity 系。環境要因でありコード欠陥ではない）。
- record-guard がスイートに正しく配線され PASS することを確認。

### 3.4 audit.sh（新規 FAIL の不在）

- **実測**: `audit.sh .` は AUDIT_EXIT=0（非ブロッキング運用）。出力 FAIL/ERROR は **本実装のコード変更に起因しない**ことを独立に検証。
  - 本 worktree には `workflow.db` が存在するため DB 系チェックが実行される。ベースライン（`b2d41e6` を detached worktree でチェックアウト）は `workflow.db` 不在で DB 系が全 SKIP となり、差分の大半は **workflow.db 存在有無に起因**する（コード差分ではない）。
  - 本 worktree で観測される FAIL/ERROR はすべて **他 issue・他ファイル**由来（#26 `src/agents-md.ts` コメント外部参照＝本 PR 未変更／#29 S1・S3 issue／#37 `docs/00_review/`／#20 親ワークフロー `20260716_013937` の 00〜04 document_id）で、いずれも本実装の追加ファイル（lib・test・R9・#41）を指さない。
  - 本 issue に関する唯一の audit 行は「04_review 未更新（implement-feature ログありで 04 無し）」であり、これは **本レビューで 04_review 作成＋書記記録により解消される想定の状態**。
- **結論**: 実装コードは新規 audit FAIL を導入していない（ベースライン差分は workflow.db 有無・他 issue に帰着）。

---

## 4. コードレビュー

### 4.1 コード品質

- **リント/型**: 対象は bash（型システム無し）。`set -uo pipefail`／`local` 徹底／`[[ ]]`／`printf` 使用など既存 R7/R8 lib と一貫。構文エラーなし（全テスト実行で確認）。
- **フォーマット**: 問題なし。既存 PreToolUse.sh のコメント体裁・命名（`_wt_*`／`worktree_record_*`）に整合。
- **BDD インラインコメント**: 新規テストは `# ユースケース:`・`# シナリオ:`・`# Given/When/Then` を各ケースに付与（TEST_BDD_FORMAT 準拠。142 箇所の該当コメントを確認）。

#### コードレビュー観点

| 観点 | 確認内容（1 文） | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | 各関数に責務・ADR/finding 対応をヘッダコメントで明示 | OK | 追随容易 |
| 保守性 | 検知ロジックを単一 lib に集約し A/B が共有（メッセージ・バイパス乖離を防止） | OK | ADR-1 の意図どおり |
| パフォーマンス | `git status`／`git rev-list` はローカル参照のみ・fetch 非依存 | OK | 過大遅延なし |
| セキュリティ | lib はパッケージ所有ソース（PreToolUse.sh と同一信頼レベル・PR レビュー対象）。未信頼データの source ではない | OK | ADR-3 注記と整合 |

### 4.2 指摘事項

#### 指摘 1: 未 push 判定のスコープ粒度がディレクトリ単位（basename 述語まで絞らない）

- **重要度**: 低（非ブロッキング・設計上許容済み）
- **指摘内容**: `_wt_record_uncommitted` は basename 述語（`_wt_record_scope`: `0[0-4]_*.md`/`90_issues.md`・`memo/` 除外）で厳密に絞るが、`_wt_record_unpushed` は `git rev-list -- <走査ルート>` のディレクトリ単位 pathspec のみで、走査ルート配下の**非記録ファイル**（例: 追跡された `memo/` 外の `README.md` 等）を変更した未 push コミットも「記録変更」として計上しうる。finding-2 が是正した「走査ルート外のコード変更」の非対称は解消済みだが、**走査ルート内のディレクトリ vs basename の粒度差**が残余として残る。
- **対応状況**: 対応不要（設計上の意図的許容）
- **対応方法**: 02_設計 §3.4 は本件を **basename 粒度の二次絞り込みを「任意（既定走査ルートでは実質同値）」**と明記し実装対象外としている。方向は fail-safe（過剰 block 側＝記録喪失防止に資する）であり、バイパスで通過可能。既定走査ルート `docs/maintainer/workflow` 配下の追跡物は実質的に記録ドキュメントであるため実害は限定的。**設計判断と整合しており修正不要**。将来精密化が必要になれば §3.4(5) の `diff-tree --name-only` 二次絞り込みを追加すればよい（申し送り）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| 00_要求定義.md | 更新済み（finding-2/5 反映・branch 記録） | 独立レビュー | 2026-07-17 |
| 01_要件定義.md | 更新済み（SC-3 finding-2・SC-6 finding-5 精緻化） | 独立レビュー | 2026-07-17 |
| 02_設計.md | 更新済み（ADR-2/ADR-3 改訂・§3.2〜3.8 契約） | 独立レビュー | 2026-07-17 |
| 03_実装計画.md | 更新済み（T1〜T7・BDD 1:1・#41 採番） | 独立レビュー | 2026-07-17 |

- **document_id 整合**: 00〜03 いずれも document_id を保持し、本レビューで新規上書き・改変されていないことを確認（04 は本レビューで新規付与）。

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（lib のヘッダコメント・関数名が 02 §3.1〜3.8 の契約・ADR-1〜4・finding-2/5 と一致）。
- **要件と実装の整合性**: 整合している（SC-1〜SC-6 が全てテストで検証済み。§受け入れ基準の確認を参照）。

---

## docs 更新

- 要否: **不要（軽量パス）**
- 対象: `docs/00_review/20260717_110041_review.md`（本 issue の継続追随ゲート軽量パス記録）
- 理由: システム仕様書のうち enforcement を扱う `docs/04_機能設計/enforcement/README.md` は F03.2 で強制事項を**抽象度でのみ俯瞰**し、F03.3 で「失敗条件の定義と実装の所在は `enforcement/README.md` を正本とする」と明記して**個別失敗条件番号（#NN）・個別 R ルール（R7/R8/R9）を列挙しない**。R9/#41 の正本反映は source 側 `enforcement/README.md`（本 PR で更新済み）で完結し、docs system spec の記述対象（Layer2 hook の存在・目的）は不変。二重モード機構を導入した S-1/S-3 も docs を更新しておらず前例と整合（evidence_source: existing_code）。指摘 0 件・as-built 加筆不要。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: UNIX 哲学（単機能の共有 lib＋薄い 2 アダプタ）・fail-safe 優先（判定不能は allow）・既存 hook の「拡張データは source せず read」原則との区別（本 lib はパッケージ所有コードで別物）を満たす。
- **ディレクトリ構成**: `enforcement/lib/` 新設は `.agent-skill-chain/source/` 配下でパッケージ同梱・`$AGENTS_ROOT` 解決可能（02 §2.2.1 の配布・信頼境界と整合）。
- **命名規則**: `_wt_record_*`／`worktree_record_*` は既存 R7/R8（`_wt_*`／`worktree_*`）と一貫。テストブランチ・worktree パスは R7 準拠形。

### 9.2 境界・依存の確認

- **責務の境界**: 検知コア（純関数・副作用なし）／2 アダプタ（A=hook source、B=bash 実行）／reporter（文面集約）が明確に分離。R8（物理退避）とは別レイヤーで併存し参照・置換しない。
- **依存関係**: 循環なし。R9 は R8 のヘルパを一方向に再利用するのみ。lib は git CLI 以外に外部依存なし・ネットワーク非依存。
- **指摘・推奨**: §4.2 指摘 1（未 push スコープ粒度）は設計許容済み・非ブロッキング。派生課題としての将来精密化のみ申し送り。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| --- | --- | --- |
| 新規テスト 39/39 PASS を独立再現 | test_output | `bash test/test-worktree-record-guard.sh` → PASS=39 FAIL=0 |
| finding-2（未 push pathspec 対称）が正しく実装 | test_output / existing_code | RG-T3b（記録外のみ未 push→非検知）・RG-T3a／lib L158 `rev-list ... -- "$root"` |
| finding-5（パスベースのスコープ・時刻不参照） | existing_code / test_output | lib `_wt_record_env_gate`（時刻/baseline 参照コード不在）・RG-T1b2 |
| R8 非破壊（SC-4） | existing_code / test_output | diff 上 R8 本体変更ゼロ・R9 はヘルパ再利用の併置。discipline 115 PASS |
| discipline の FAIL 2 件は環境依存（本実装無関係） | observed_runtime | クリーン repo_root で accept・`.worktree` 配下 repo_root で reject を再現 |
| 実装コードが新規 audit FAIL を導入しない | observed_runtime | ベースライン差分は workflow.db 有無・他 issue に帰着 |
| docs 継続追随＝更新不要（軽量パス） | existing_code | `docs/04_機能設計/enforcement/README.md` F03.3 が個別条件を source README へ委譲 |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1（低・派生・申し送り）**: 未 push 判定の basename 粒度二次絞り込み（02 §3.4(5)）は未実装（設計上「任意」）。既定走査ルートでは実質同値のため実害限定。将来、走査ルート直下に非記録 md が混在する運用が生じた場合の精密化候補。
  - **影響範囲**: 走査ルート内の非記録ファイルのみを変更した未 push コミットに対する過剰 block の可能性（fail-safe 方向・バイパス可）。
  - **対応方法**: 必要時に `diff-tree --name-only` + `_wt_record_scope` 二次絞り込みを追加。**本 issue では対応不要**。

### 10.2 改善提案

- なし（現状の実装は設計・受け入れ基準を満たす）。

---

## 11. システム仕様書の更新

### 11.1 システム仕様書の確認結果

- **実装した機能**: worktree 削除前・close 前の記録 commit/push 漏れ検知（R9 / #41）。
- **実装した API**: 実行時 API なし。契約は (a) PreToolUse hook の exit code（0 allow / 2 block）＋stderr、(b) `bash <lib> <target>` の終了コード＋stdout レポート。

#### システム仕様書との整合性確認

- **機能設計**: `docs/04_機能設計/enforcement/README.md` は Layer2 hook（PreToolUse.sh）で違反を exit 2 する旨を抽象記述済み。R9 はその Layer2 の一具体であり、抽象記述の範囲内で不変。個別失敗条件は source `enforcement/README.md` を正本として委譲済み。

### 11.2 システム仕様書の更新状況

#### 更新が不要な項目

- enforcement 系統仕様（F03）: 個別 R ルール・失敗条件番号を列挙しない抽象仕様のため、R9/#41 追加による更新不要（詳細は §docs 更新・`docs/00_review/20260717_110041_review.md`）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計契約・ADR・finding-2/5 に忠実。単一正本・fail-safe・非破壊）。
- **テスト品質**: 良好（39 ケースが SC-1〜SC-6 と BDD 1:1 対応・正本 hook を実駆動・隔離 tmp・破壊防止ガード付き）。
- **ドキュメント品質**: 良好（00〜03 と実装が整合・document_id 保持）。
- **総合評価**: **承認（close 可）**。ブロッキング指摘なし。§4.2 指摘 1 は設計許容済みの非ブロッキング。

### 12.2 承認状況

- **レビュー承認者**: 独立レビューサブエージェント（opus）
- **承認日**: 2026-07-17
- **承認コメント**: SC-1〜SC-6 の全受け入れ基準を独立に再検証し充足を確認。既存 R7/R8 非破壊。新規 audit FAIL なし。透明性報告のあった実装中の誤 commit 未遂は本 worktree の commit 履歴・成果物に不整合を残していないことを確認（tree clean・6 実装/文書コミットのみ・test 内 `_assert_tmp` ガードで再発防止）。close を承認する。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md)
- [`01_要件定義.md`](./01_要件定義.md)
- [`02_設計.md`](./02_設計.md)
- [`03_実装計画.md`](./03_実装計画.md)

### 13.2 その他の参考資料

- 正本: [enforcement/README.md](../../../../../../.agent-skill-chain/source/enforcement/README.md) §失敗条件と差し戻し（#41）
- 実装: `.agent-skill-chain/source/enforcement/lib/worktree_record_guard.sh`・`.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`（R9）
- テスト: `test/test-worktree-record-guard.sh`
- docs 継続追随: `docs/00_review/20260717_110041_review.md`

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 外部設定不要のため最終確認チェックリストはスキップ。本レビュー承認後、進行役が PR 作成（push は進行役が実施）。
