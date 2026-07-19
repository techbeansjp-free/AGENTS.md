---
document_id: "6e23f9fa-6d38-495b-b499-92b3a3b925a0"
---

# レビュー書: 実装前ドキュメントレビュー（review-docs）の全 issue 必須ゲート化

**プロジェクト名**: review-docs 必須化（design-feature 完了→implement-feature 着手の間の必須ゲート化）
**作成日**: 2026 年 07 月 11 日
**最終更新**: 2026 年 07 月 11 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座にこのドキュメントを更新してください。
>
> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
>
> **必須**: 本レビューは [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../../.agent-skill-chain/source/REVIEW_RULE.md) に従い実施した。レビュー深度は **full**（新規 enforcement チェック追加＋規約 5 ファイル改修のため）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認・品質保証・クローズ前最終チェック（実装前 review-docs 必須ゲート化の規約結線と enforcement #32 が、00 の SC-1〜8・01 の AC-1〜14 を満たし、既存チェック・経路を弱めていないことを独立再検証する）。

### 1.2 レビュー対象（必須）

- **実装範囲**: T1 必須ゲートの義務接続（規約 5 ファイル追記）／T2 enforcement 実装（audit.sh `check_reviewdocs_before_implement` #32 ＋ enforcement/README.md）／T3 回帰テスト（test-audit.sh に #32 の 7 シナリオ追加）／T4 整合・非新設・リンク検証。
- **レビュー期間**: 2026-07-11 ～ 2026-07-11
- **レビュー担当者**: verify-and-close ワーカー（独立監査・実装担当の自己申告を鵜呑みにせず再検証）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| -------- | -------- | ------ | ------ | ---------- |
| T1 義務接続 | run_command.md:47／design-feature.md:61,73／implement-feature.md:64／PHASE_COMMAND_MAP.md:25,26,40／PHASES.md:65 に必須ゲート義務・整合注記を参照結線 | 2026-07-11 | implement-feature | 完了 |
| T2 enforcement #32 | audit.sh に `check_reviewdocs_before_implement` を追加・登録、冒頭コメント (32) 追記、enforcement/README.md の 4 表に #32 追加 | 2026-07-11 | implement-feature | 完了 |
| T3 回帰テスト | test/test-audit.sh に #32 の 7 シナリオ（正常系/違反系/grandfather/close/DB 非採用/#29 非交差/サブ issue 深さ4）追加 | 2026-07-11 | implement-feature | 完了 |
| T4 整合・非新設 | 免除表現不在・review-docs.md 単一正本・create-pr-review-issue 経路不変・リンク解決を静的検証 | 2026-07-11 | implement-feature | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: 必須ゲートの義務接続（規約 5 ファイル）

- **実装内容**: design-feature 完了→implement-feature 着手の間に review-docs を必須で経る義務を、既存 5 正本へ参照 1〜数行で結線。review-docs.md 本文は複製せず参照表現に限定。
- **変更ファイル**: `skills/agent/run_command.md`（§Constraints 新規 1 項 :47）、`commands/design-feature.md`（§実行時の注意 :61 ＋ §DONE :73）、`commands/implement-feature.md`（§実行時の注意 :64）、`workflow/PHASE_COMMAND_MAP.md`（§補助手順 :25/:26/:40）、`workflow/PHASES.md`（§レビュー成果物の配置ルール :65）。
- **独立確認**: 各ファイルを `grep -n "review-docs"` し、必須ゲート接続行の実在を目視確認（§4.2 参照）。ADR-1（表に行追加せず義務接続）どおり、PHASE_COMMAND_MAP の表本体行は不変（後述）。

#### タスク 2: enforcement #32（`check_reviewdocs_before_implement`）

- **実装内容**: 「同一 issue（issue_path 前方一致＋basename 末尾一致）に implement-feature ログが 1 件以上あるのに review-docs ログが 0 件」を FAIL。DB/テーブル非採用 SKIP・templates/close 除外・発効日 cutoff（`REVIEWDOCS_GATE_EFFECTIVE_FROM` 既定 `20260712_000000`・env 上書き可）grandfather・read-only（SELECT のみ）。走査は `03_実装計画.md` を unbounded find（maxdepth なし＝90_issues 配下の深いサブ issue も確実に走査）。
- **変更ファイル**: `enforcement/ci/audit.sh`（関数定義＋末尾登録＋冒頭コメント (32)）、`enforcement/README.md`（必須チェック列挙 :145／対応表 :244／判定ルール一覧 :294／差し戻し先 :329）。
- **独立確認**: tmp 隔離で grandfather 5 ケース＋env override を自ら再現（§3.2）。#29 と非交差を同一 DB で確認。

#### タスク 3・4: 回帰テスト・整合検証

- **変更ファイル**: `test/test-audit.sh`（#32 の 7 シナリオ）。
- **独立確認**: `bash test/test-audit.sh` を実行し #32 の 7 シナリオ全 PASS（§3.1）。免除表現の不在・単一正本・経路不変・リンク解決を再検証（§4）。

---

## 3. テスト結果の確認

### 3.1 単体・回帰テスト（test/test-audit.sh）

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-11
- **テストファイル数**: 1（`test/test-audit.sh`）
- **テストケース数**: 28（`== 結果: PASS=26 FAIL=2 ==`）
- **成功**: 26
- **失敗**: 2
- **スキップ**: 0

#### #32 に関する結果（本 issue の実装対象・全 PASS）

| シナリオ | 結果 |
| -------- | ---- |
| #32 正常系（impl＋review-docs 両ログ）は FAIL しない | PASS |
| #32 違反系（impl のみ）で FAIL する | PASS |
| #32 grandfather SKIP（発効日前 issue は FAIL しない） | PASS |
| #32 close SKIP（close 配下 issue は FAIL しない） | PASS |
| #29/#32 非交差（各々の対象 issue で個別に FAIL） | PASS |
| #32 サブ issue（深さ4）違反系で FAIL する（maxdepth 撤廃 lock） | PASS |
| #32 DB 非採用 SKIP（sqlite3/DB 無しで FAIL しない） | PASS |

#### 失敗した 2 テストの独立調査（結論: 本 issue と無関係な既存不具合）

| テストケース | 失敗理由 | 本 issue との関係 |
| ------------ | -------- | ----------------- |
| 必須ファイル欠落でも exit 0 になった（シナリオ3） | `make_min_tree` から CORE.md を削除しても audit.sh の必須ファイル存在チェック（#1/#2・audit.sh:216-224、`AGENTS_ROOT` 配下の CORE.md/LOAD_POLICY.md/PHASES.md/TEMPLATES.md 存在判定）が FAIL しない | **無関係**。#32 は関数追加（加算のみ）で #1/#2 を一切変更していない |
| 必須ファイル未参照メッセージが無い（シナリオ3） | 上記に付随。`Missing required file` メッセージが出ない | **無関係**（同上） |

- **独立再現による裏付け**: 実装前の HEAD 版 `audit.sh`（#32 追加前）を取り出し、同一の最小ツリー（CORE.md 欠落）で実行した結果、**RC=0・`Missing required file` メッセージ無し**と、現行の作業ツリーと**完全に同一の挙動**を示した。すなわちこの 2 件は #32 追加以前から存在する既存不具合であり、本 issue の変更が原因ではない。
- **根本原因（参考）**: シナリオ3 は `.agent-skill-chain/source/boot/CORE.md` 削除で必須ファイル検知が発火する前提だが、現行 audit.sh の `AGENTS_ROOT` 解決（:83 `${AGENTS_ROOT:-.agent-skill-chain/source}`）または最小ツリー生成側の想定と検知経路がかみ合っていないためと推測される（ストーリー8 の `.agents/`→`.agent-skill-chain/source/` ネスト移行に伴う test 側の未追随の可能性）。**本 issue の範囲外**であり、別 issue としての追跡を推奨する（下記 §10.2）。

### 3.2 本リポ全体 audit（`bash .agent-skill-chain/source/enforcement/ci/audit.sh .`）

- **04_review.md 作成・書記記録前**: FAIL 1 件（`04_review 未更新` — 本 issue に implement-feature ログがあるのに 04_review.md が未作成。これは verify-and-close で解消する想定の唯一の FAIL）。
- **#32 起因の新規 FAIL**: **0 件**。本 issue（`20260711_194044_...`）を含む 2026-07-11 以前作成の全 issue は発効日 cutoff（`20260712_000000`）未満で grandfather SKIP され、自リポ CI を破壊しない（00 §1.3 効果2／ADR-5／AC-14 の受け入れ）。
- **04_review.md 作成・書記記録後**: 本レビュー完了後（write-workflow-log で verify-and-close ログ記録後）に再実行し **FAIL 0 件（緑）** を確認する（§12.2 の証跡）。

#### grandfather 機構の独立再検証（tmp 隔離・自ら実行）

実装担当の test を鵜呑みにせず、`mktemp -d` の隔離ツリー＋自作 workflow.db で以下を独立に再現し、いずれも期待どおりであることを確認した（read-only・本番 DB 非変更）。

| ケース | 条件 | 期待 | 実測 |
| ------ | ---- | ---- | ---- |
| (a) 発効日以降・impl のみ | `20260801_*` に implement-feature のみ | #32 FAIL | **FAIL ✓** |
| (b) 発効日前・impl のみ | `20260101_*` に implement-feature のみ | grandfather SKIP | **SKIP ✓** |
| (c) close 配下・impl のみ | `close/20260801_*` に implement-feature のみ | SKIP | **SKIP ✓** |
| (a2) 発効日以降・impl＋review-docs | 両ログ | PASS | **PASS ✓** |
| (d) DB 非採用 | workflow.db を削除して実行 | SKIP（#32 FAIL 0 件） | **SKIP ✓** |
| (e) #29 非交差 | 同一 DB に「04 のみ・impl 0 件」issue を併置 | #29 発火・#32 は当該 issue で不発火 | **#29 発火／#32 不発火 ✓** |
| env override | `REVIEWDOCS_GATE_EFFECTIVE_FROM=20251231_000000` で (b) 再実行 | cutoff が早まり FAIL | **FAIL ✓（cutoff 反映）** |

---

## 4. コードレビュー（review-code）

### 4.1 コード品質

- **構文チェック**: `bash -n audit.sh` 相当（本リポ全体 audit が正常起動しており構文健全）。
- **read-only 契約**: #32 は workflow_log への SELECT のみで DB を変更しない（SQL は `SELECT 1 ... LIMIT 1`）。scribe ロール不要（#8 認証・認可の追加負荷なし）。
- **SQL エスケープ**: 単一引用符を `${v//\'/\'\'}` でエスケープ（既存 #29 と同一様式）。injection 耐性は既存関数と同等。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | #29 の `check_review_before_implement` の様式を踏襲し命名・構造が一貫 | OK | `check_reviewdocs_before_implement` と近接配置 |
| 保守性 | grandfather cutoff を env 上書き可能な関数内定数で分離 | OK | 消費者・将来運用が発効日を調整可 |
| パフォーマンス | issue 数 × 定数回の `LIMIT 1` SELECT。既存 #29/#31 と同オーダー | OK | 重い調査を新設しない |
| セキュリティ | SELECT のみ・外部アクセス無し・高リスク操作の緩和なし | OK | 証跡改ざん経路を増やさない |
| 安全側（誤 FAIL 回避） | DB/テーブル非採用 SKIP・templates/close 除外・cutoff grandfather・`2>/dev/null || true` の fail-open | OK | ADR-3（存在監査のみ）／ADR-5（grandfather）と整合 |

### 4.2 受け入れ基準の確認（map-coverage: 00 SC-1〜8／01 AC-1〜14）

いずれも独立に grep／実行して充足を確認した（実装担当の自己申告に依らない再検証）。

| 基準 | 検証方法 | 結果 |
| ---- | -------- | ---- |
| SC-1/AC-1/AC-6 | PHASE_COMMAND_MAP.md:25/26/40 に必須ゲート注記＋「本表にない command 起動禁止は phase 選択経路の禁止・補助手順は対象外」。表本体（`^\|` 行）は HEAD と **9 行で同数・完全一致**（`diff` で TABLE BODY IDENTICAL） | OK |
| SC-2/AC-5 | PHASES.md:65 が「auxiliary（表に載らない）」と「実装着手前の必須ゲート・全 issue 一律」の両立を明記、「任意・省略可」を意味しないと明示 | OK |
| SC-3/AC-2 | run_command.md:47 §Constraints に「design-feature 完了後・implement-feature 委譲前に review-docs を必ず委譲（全 issue 一律・免除なし）」 | OK |
| SC-4/AC-3 | design-feature.md:61（§実行時の注意）＋:73（§DONE）に次工程＝実装着手前 review-docs 必須を接続 | OK |
| SC-5/AC-4 | implement-feature.md:64 に「実装着手の前提＝同一 issue の review-docs 完了・未実行は #32 で FAIL」 | OK |
| SC-6/AC-7/AC-8 | enforcement/README.md の 4 表（必須チェック列挙:145・対応表:244・判定ルール一覧:294・差し戻し先:329）に #32、audit.sh に関数定義＋登録の両方が実在 | OK |
| AC-9 | DB 非採用 SKIP を tmp 隔離で実測（§3.2 (d)）。冒頭 `command -v sqlite3` / `-f "$WF_DB"` / table 存在の 3 段ガード | OK |
| AC-10 | #29（impl 0 件 ∧ 04 存在）と #32（impl 1 件以上 ∧ review-docs 0 件）は implement ログ件数で排他。同一 DB で #29 発火・#32 不発火を実測（§3.2 (e)） | OK |
| SC-7/AC-11 | review-docs の Process/DoD 正本は review-docs.md のみ（本 issue で**無変更**）。5 接続ファイルは参照表現のみで複製なし | OK |
| AC-12 | create-pr-review-issue.md は**無変更**、review-docs 参照 1 件が残存（呼び出し経路不変） | OK |
| SC-8/AC-13 | 肯定的免除句（`省略してよい\|省略して良い\|免除する\|免除される\|免除対象\|軽量.*(省略\|免除)`）が変更 6 ファイルで該当 **0 件**。否定形（「免除なし」等）は適合表現で対象外 | OK |
| AC-14 | close 配下 SKIP を実測（§3.2 (c)）。加えて grandfather で in-progress 既存 issue も救済 | OK |
| リンク解決 | 02/03 の追加・変更 markdown リンクを realpath 解決し未解決 **0 件** | OK |

### 4.3 敵対的観点（adversarial・意図的に壊しにいく視点）

- **偽陰性（順序偽装）**: #32 は存在監査のみで review-docs と implement の時刻順序を見ない（ADR-3）。「implement 後に形だけ review-docs ログを足す」逆順は検知不能。→ enforcement/README.md の #32 説明に限界を正直に明記済み。最終品質は review-docs.md の DoD＋人手監査で担保する設計として妥当。**指摘化せず（設計上の既知の割り切りで、00 §1.3 効果2「機械検証可能な範囲」に合致）**。
- **偽陽性（自リポ CI 破壊）**: 素朴導入なら 2026-06/07 の既存 in-progress issue が一斉 FAIL する懸念。→ 発効日 cutoff grandfather＋close 除外で回避を実測（§3.2）。SC-8 との両立（免除でなく遡及除外）も文言で明示済み。
- **表構造の破壊（AC-6 違反）**: PHASE_COMMAND_MAP に誤って phase 行を足すと方針違反。→ 表本体行数を HEAD と diff し不変を確認。
- **二重定義（SC-7 違反）**: 接続文が review-docs.md の Process/DoD を複製する懸念。→ 変更 5 ファイルは参照表現のみ、review-docs.md 無変更を確認。
- **cutoff 異常値**: `REVIEWDOCS_GATE_EFFECTIVE_FROM` に不正値が入ると？→ basename 正規表現が固定長 14 桁前提で比較するため、異常時は過剰 SKIP 側（FAIL を増やさない安全側）に倒れる（audit.sh コメント／02 §3.2.4）。

### 4.4 must-preserve（不変条件・壊してはならない既存挙動）

- review-docs.md / verify-and-close.md（本 issue 由来の変更なし＊）/ create-pr-review-issue.md の Process/DoD・呼び出し経路。
  - ＊注: verify-and-close.md に 1 行差分があるが、これは別サブ issue（システム仕様書 docs/ 継続追随ゲート・#31 関連）由来の**本ブランチ既存差分**であり、review-docs ゲートには無関係（review-docs 語を含まず、docs/00_review 継続追随の文言のみ）。本 issue の範囲外。
- 既存 audit チェック #3/#5/#9/#27/#28/#29/#31 の判定を弱めていない（#32 は関数の**加算のみ**、既存関数・登録列を改変しない）。
- 「実装前は memo・04 は実装完了後の verify-and-close のみ」ルール（#29）と矛盾しない。
- workflow_log スキーマ不変（新規カラム・新規 command 値なし。既存 `command`/`issue_path` のみ参照）。

---

## docs 更新

- 要否: 不要
- 対象: なし
- 理由: 本 issue の変更対象は `.agent-skill-chain/source/`（パッケージ実行契約＝run_command / design-feature / implement-feature / PHASES / PHASE_COMMAND_MAP / enforcement/README / audit.sh）および `test/` であり、`docs/`（システム仕様書）の記載内容に影響しない。`docs/` 配下の実体は `docs/AI_CI_CD_VISION.md`（高レベルビジョン）と `docs/maintainer/`（issue 記録）のみで、enforcement 失敗条件や workflow ゲートを**転記したシステム仕様書は存在しない**（`AI_CI_CD_VISION.md` の該当箇所は enforcement/README.md への参照リンク 1 件のみで、失敗条件一覧を複製していない＝#32 追加でリンク先が更新されても本文の追随は不要）。よって DOCS_RULES §継続追随ゲートの軽量パス（根拠付き更新不要判定 1 件）で「不要」と判定する。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 単一責務（義務＝run_command／役割分担＝PHASES／phase→command＝PHASE_COMMAND_MAP／失敗条件＝enforcement/README／実装＝audit.sh に分離、review-docs.md は無変更の葉ノード）を満たす。UNIX 哲学（既存 #29 と同型の小関数 1 つ追加・非交差・加算のみ）に沿う。
- **ディレクトリ構成・命名規則**: 既存 `check_*` 命名・enforcement/ci 配置・test/ 配置に整合。新規ディレクトリ・深い階層を作らない。
- **AI フレンドリー**: 接続点は grep 可能な参照行に限定、検知関数は既存様式踏襲で可読。

### 9.2 境界・依存の確認

- **責務の境界**: 義務接続（規約 5 ファイル）／検知の実装（audit.sh＋README）／正本無変更（review-docs.md・verify-and-close.md・create-pr-review-issue.md）が明確に分離。
- **依存関係**: 参照はすべて既存正本へ向かう一方向（run_command→review-docs／PHASES、design-feature→run_command／review-docs 等）。review-docs.md を無変更の葉として扱うため循環なし。
- **指摘・推奨**: 設計・境界に関する新規指摘なし（00〜03 の設計方針どおりに実装されている）。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| grandfather 5 ケース＋env override が期待どおり動く | test_output | tmp 隔離で自ら実行（§3.2） |
| 本リポ全体 audit で #32 起因の新規 FAIL 0 件 | test_output | `audit.sh .` 実行（§3.2・§12.2） |
| test-audit.sh の 2 FAIL は本 issue と無関係な既存不具合 | test_output | HEAD 版 audit.sh で同一挙動を再現（RC=0・メッセージ無し） |
| PHASE_COMMAND_MAP 表本体不変（AC-6） | existing_code | HEAD と `diff` で TABLE BODY IDENTICAL |
| #29 と #32 の非交差（AC-10） | existing_code / test_output | implement ログ件数で排他、同一 DB で個別発火を実測 |
| review-docs.md / create-pr-review-issue.md 無変更（AC-11/AC-12） | existing_code | `git diff HEAD --quiet` で UNCHANGED |
| 全 issue 一律必須の方針（免除条項を設けない） | human_decision | ユーザー決定 2026-07-11（00 §1.2） |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題1（本 issue 範囲外）**: `test/test-audit.sh` シナリオ3（必須ファイル欠落検知）が現行ツリーで FAIL する（PASS=26/FAIL=2）。HEAD 版 audit.sh でも同一に再現する既存不具合で、#32 とは無関係。ストーリー8 のネスト移行（`.agents/`→`.agent-skill-chain/source/`）に伴う `AGENTS_ROOT` 解決または最小ツリー生成の未追随が疑われる。
  - **影響範囲**: audit.sh の必須ファイル存在チェック（#1/#2）の回帰テストのみ。#32・本 issue の受け入れには影響しない。
  - **対応方法**: 別 issue として起票し、`AGENTS_ROOT` 解決経路と `make_min_tree` の整合を調査・修正することを推奨（サブは独断起票せず orchestrator 承認を経る）。

### 10.2 改善提案

- **改善1**: 将来、review-docs と implement の時刻順序監査（ADR-3 で見送り）が必要になった場合は、`ts_utc` の信頼性向上（単調増加保証等）とセットで再検討する。現時点では存在監査で目的を満たすため不要。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（00〜03 の設計・ADR どおり実装。既存 #29 様式を踏襲し非交差・安全側）。
- **テスト品質**: 良好（#32 の 7 シナリオ全 PASS。grandfather 5 ケース＋env override を独立再現）。
- **ドキュメント品質**: 良好（enforcement/README の 4 表に #32、限界を正直に明記）。
- **総合評価**: **合格（クローズ可）**。00 SC-1〜8・01 AC-1〜14 をすべて独立検証で充足。既存チェック・経路を弱めていない。残る唯一の audit FAIL は「04_review 未更新」で、本レビュー成果物の作成＋書記記録で解消する。test-audit.sh の 2 FAIL は本 issue と無関係な既存不具合（別 issue 追跡を推奨）。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close ワーカー
- **承認日**: 2026-07-11
- **承認コメント**: 指摘 0 件（本 issue 範囲）。04_review.md 作成後、write-workflow-log で verify-and-close ログを記録し、`bash .agent-skill-chain/source/enforcement/ci/audit.sh .` を再実行して FAIL 0 件（緑）を確認する。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md)・[`01_要件定義.md`](./01_要件定義.md)・[`02_設計.md`](./02_設計.md)・[`03_実装計画.md`](./03_実装計画.md)
- [.agent-skill-chain/source/enforcement/ci/audit.sh](../../../../../../../.agent-skill-chain/source/enforcement/ci/audit.sh) `check_reviewdocs_before_implement`（#32）・[enforcement/README.md](../../../../../../../.agent-skill-chain/source/enforcement/README.md) §失敗条件と差し戻し
- [.agent-skill-chain/source/skills/agent/run_command.md](../../../../../../../.agent-skill-chain/source/skills/agent/run_command.md)・[commands/design-feature.md](../../../../../../../.agent-skill-chain/source/commands/design-feature.md)・[implement-feature.md](../../../../../../../.agent-skill-chain/source/commands/implement-feature.md)・[review-docs.md](../../../../../../../.agent-skill-chain/source/commands/review-docs.md)
- [.agent-skill-chain/source/workflow/PHASES.md](../../../../../../../.agent-skill-chain/source/workflow/PHASES.md)・[PHASE_COMMAND_MAP.md](../../../../../../../.agent-skill-chain/source/workflow/PHASE_COMMAND_MAP.md)
- [.agent-skill-chain/source/REVIEW_RULE.md](../../../../../../../.agent-skill-chain/source/REVIEW_RULE.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 本レビュー承認により実装 phase の成果物確認が完了。トップレベル issue（agentsOS 汎用化・ポリシー統合）配下のサブ issue として、親の完了判定に接続する（close 移動は親のトップレベル完了時にまとめて実施）。
