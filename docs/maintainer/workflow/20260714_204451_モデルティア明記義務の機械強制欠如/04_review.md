---
document_id: "fef7ef1e-09ee-41e6-99de-799c906c50ea"
---

# レビュー書: モデルティア明記義務の機械強制欠如の是正

**プロジェクト名**: モデルティア明記義務の機械強制欠如の是正（Issue #73）
**作成日**: 2026 年 07 月 15 日
**最終更新**: 2026 年 07 月 15 日

> 本レビューは verify-and-close（skill chain: generate-scenarios → map-coverage → review-code → review-architecture → write-workflow-log）で作成。深度は **full**（新規の機械強制ゲート・スキーマ変更・監査層追加のため）。

---

## 1. レビュー概要

### 1.1 レビュー目的

実装内容の確認・品質保証（受け入れ基準充足）・設計整合の最終チェック。ティア明記義務を機械検証する記録層（`workflow_log` 3 カラム）＋検証層（`audit.sh #38`）が、既存方針文書を書き換えず・既存監査と非交差・対象外環境をロックアウトせずに実装されているかを検証する。

### 1.2 レビュー対象

- **実装範囲**: T1（スキーマ＋scribe 記録）・T2（audit #38）・T3（配線・README 追記）・T4（隔離テスト）。
- **レビュー期間**: 2026-07-15
- **レビュー担当者**: verify-and-close 実行エージェント（tier: opus — 設計・レビュー・監査は opus 固定・MODEL_TIER_TABLE.md）

---

## 2. 実装内容の確認（review-code）

### 2.1 実装完了タスク

| タスク | 実装内容 | ステータス |
| ------ | -------- | ---------- |
| T1 記録層 | `schema.sql` に 3 カラム（`TEXT NULL`）＋3 索引追加。`write-workflow-log.sh` に 3 env 受領・`ensure_column` 冪等追加・CHECK 再構築マイグレーションの `INSERT ... SELECT` に 3 カラム保全・`NULLIF` 挿入 | 完了 |
| T2 検証層 | `audit.sh` に `check_model_tier_recorded`（#38）を追加、末尾呼び出し列へ 1 行追加。多層ガード・grandfather・fable 例外判定・US 区切りの列崩れ防止 | 完了 |
| T3 配線・文書 | `run_command.md`・`write-workflow-log/SKILL.md` に 3 env 受け渡し契約を追記。`enforcement/README.md` に #38 を 3 表＋散文で追記（#36 の次・#37 遡及は非スコープ） | 完了 |
| T4 隔離テスト | `test/test-model-tier-gate.sh`（新規・隔離 DB）＋`run-all.sh` 登録 | 完了 |

### 2.2 実装内容の詳細（確認結果）

- **T1 記録層**: `schema.sql` の `CREATE TABLE workflow_log` に `model_tier`/`tier_rationale`/`tier_exception` を `dod_met` と `prev_hash` の間へ追加。`write-workflow-log.sh` は (i) 新スキーマ経路の `ensure_column` 群へ 3 カラムを追加、(ii) `review-docs`/`create-pr-review-issue` の CHECK 再構築マイグレーションの `workflow_log_new` 定義と `INSERT INTO workflow_log_new SELECT ...` の双方へ 3 カラムを含め（**旧テーブルから新テーブルへのコピー時のデータロスを防止**＝設計の帰結に整合）、(iii) 本 `INSERT` 文へ `NULLIF('$E_MT','')` 等で組み込む。位置引数・既存必須検証は不変で後方互換を保つ。**確認: 良好**。
- **T2 検証層**: 多層ガード (0) `MODEL_TIER_GATE_ENABLED` off → (1) sqlite3/DB/table 不在 → (2) `model_tier` カラム不在 → (3) 非空 `model_tier` 行皆無、の順に SKIP を評価（設計 ADR-5 の順序と一致）。grandfather は `issue_path` basename の `YYYYMMDD_HHMMSS_` を正規表現で抽出し `[[ "$ts" < "$cutoff" ]]`（ゼロ埋め文字列比較で妥当）で判定。判定 1/2/3（未明記／根拠欠落／無申告 fable）は設計 §3.2.2 と一致。SELECT は `char(9)/char(10)/char(13)` を空白へ正規化し US(0x1f) 区切りで 1 行 1 レコードを保証（値中の改行・タブによる列崩れを防ぐ堅牢な実装）。**確認: 良好**。
- **T3 配線**: `run_command.md` の既存「委譲時のティア明記」項へ scribe 配線（3 env 引き継ぎ）を追記。`SKILL.md` へ受け渡し契約を追記。方針文書は不変（§3 で diff 確認）。**確認: 良好**。
- **T4 テスト**: 隔離 DB（`mktemp`）で #38 の PASS/FAIL/SKIP・grandfather・大小文字 fable・env 上書きを検証。本リポの `workflow.db`・`source` を破壊しない。**確認: 良好**。

---

## 3. テスト結果の確認（再実行・実測）

### 3.1 単体・結合テスト（本 command で再実行）

**実行日**: 2026-07-15

| テストファイル | ケース/アサーション | 成功 | 失敗 | 判定 |
| -------------- | ------------------- | ---- | ---- | ---- |
| `test/test-model-tier-gate.sh` | 15 シナリオ / 21 アサーション | 21 | 0 | PASS（`PASS=21 FAIL=0`・exit 0） |
| `test/test-audit.sh`（回帰） | 123 | 123 | 0 | PASS（`PASS=123 FAIL=0`・exit 0・非交差/回帰なし確認） |

- `test-model-tier-gate.sh` 内訳: 未明記 FAIL／明記 PASS／fable 申告あり PASS／fable 無申告 FAIL／大文字 FABLE（無申告 FAIL・申告あり PASS）／根拠欠落 FAIL／`~` 値 FAIL／grandfather 素通り／非プレフィックス素通り／全 NULL SKIP／カラム不在 SKIP／トグル off 最優先 SKIP／DB 不在 SKIP／`MODEL_TIER_GATE_EFFECTIVE_FROM` env 上書き — すべて PASS。
- `test-audit.sh` は既存 #3〜#37 の回帰（#34/#35/#36 のトグル・grandfather・SKIP 系、#25 時系列突合を含む）が全 PASS で、#38 追加による**既存チェックの挙動不変（非交差）を実証**。

### 3.2 方針不変の確認（成功基準・ストーリー 3）

`MODEL_SELECTION.md`・`MODEL_TIER_TABLE.md` は本ブランチの変更ファイル一覧（`git diff` name-status）に**含まれない**＝diff 空。方針文書は書き換えられていない。**確認: 良好**。

---

## 4. コードレビュー

### 4.1 コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | #38 は既存 #34/#35 と同一命名・ガード順・パース手順。コメントで ADR 対応を明示 | OK | AI フレンドリー設計に整合 |
| 保守性 | 対応表を audit に転記せず（ADR-3）、契約点は `workflow_log` 3 カラム名のみ | OK | 単一情報源を維持 |
| パフォーマンス | 非空存在確認 1 回＋行走査。既存 #34/#35 と同等オーダー | OK | — |
| セキュリティ | 3 カラムは `TEXT NULL`・秘匿情報は根拠/例外に含めない方針。#38 は Query のみで DB/FS へ書き込まない | OK | — |
| 後方互換 | env 未指定は `NULL`・旧スキーマ経路不変・位置引数不変 | OK | — |
| 堅牢性 | US 区切り＋改行/タブ正規化で列崩れ防止・`ts` 解析不能/空 issue_path は素通り | OK | — |

### 4.2 指摘事項

#### 指摘 A（中・対応済み）: ledger 意味正本 `schema.md` の未同期

- **指摘内容**: 実装は SQL 正本 `schema.sql` に 3 カラムを追加したが、意味・運用の正本である `schema.md` の 2 箇所（§解説写し `CREATE TABLE`・§「期待スキーマのカラム一覧（書記のスキーマ比較用）」）が 3 カラムを欠いたまま残り、実装矛盾（DOCS_NOISE_RULES）となっていた。02_設計 §2.1.1 の責務一覧が変更対象に `schema.md` を挙げていなかったこと（設計の記述漏れ）に起因する。
- **重要度**: 中（機能破壊ではないが、書記のスキーマ比較用リスト・解説写しが正本として陳腐化）。
- **対応状況**: 完了（本レビューで是正）。`schema.md` の解説写し `CREATE TABLE` に 3 カラム＋3 索引を、カラム一覧行に 3 カラムを、カラム説明に `model_tier/tier_rationale/tier_exception` の 1 項を追記し as-built 同期。値の妥当性判定が audit #38 に集約される旨も明記。
- **evidence_source**: existing_code（`schema.md` を実読し `schema.sql` 追加分と突合）。

#### 指摘 B（低・受容／docs 是正済み）: 索引が設計の想定範囲を超過

- **指摘内容**: `schema.sql` は `model_tier`・`tier_rationale`・`tier_exception` の 3 索引を追加したが、02_設計 §4.1 は「`model_tier` に部分索引を任意で付与してよいが必須ではない（少数行の EXISTS で足りる）」とし、`tier_rationale`/`tier_exception` への索引は言及していない。両者は自由記述の根拠/例外文字列で WHERE/JOIN の対象にならず、索引の照会経路が無い（`model_tier` 索引は段階 4 の EXISTS を裏付けるため妥当）。
- **重要度**: 低（機能・性能への実害なし。ほぼ NULL の TEXT 索引は極小）。
- **対応状況**: 受容（コードは変更しない）。理由: 索引は無害であり、除去は churn かつスコープ外（除外要件「過剰な追加実装は避ける」の趣旨に照らし、削る改修も同様に最小フットプリント原則で見送る）。将来の最小化候補として §10.2 に改善提案として記録。副次的に生じた `docs/03_データ設計/README.md §3.5`「索引 7 件」の陳腐化は as-built（10 件）へ是正済み（§9 継続追随ゲート）。
- **evidence_source**: existing_code（`grep -c 'CREATE INDEX' schema.sql` = 10）＋ 02_設計 §4.1。

#### 指摘 C（情報・受容）: `enforcement/README.md` の #37 番号飛び

- **指摘内容**: README 失敗条件表は #36 の次に #38 を追記し #37 が欠番。これは本 issue と無関係の既存ギャップ（03_実装計画 §2.2.2 に明記済み）であり、#37 の遡及追記は本 issue のスコープ外。**受容**（設計・計画の判断どおり）。
- **evidence_source**: existing_code（03_実装計画 §2.2.2 の番号整合注記）。

---

## 5. 受け入れ基準の確認（generate-scenarios / map-coverage）

01 の BDD／ストーリー ⇔ 03 のテストケース ⇔ 実際のテスト結果の対応。**全シナリオがテストコード化され PASS**。

| 01 の BDD / ストーリー | 03 テストケース | 実テスト（test-model-tier-gate.sh） | 結果 |
| ---------------------- | --------------- | ----------------------------------- | ---- |
| UC1-S1 ティア未明記 FAIL | §2.2.4 Scenario 1 | 「未明記行は FAIL する」 | PASS |
| UC1-S2 ティア明記 PASS | §2.2.4 Scenario 2 | 「明記済み行は FAIL しない」 | PASS |
| UC2-S1 fable 申告あり PASS | §2.2.4 Scenario 3 | 「fable 申告あり行は FAIL しない」（大文字含む） | PASS |
| UC2-S2 fable 無申告 FAIL | §2.2.4 Scenario 4 | 「fable 無申告行は FAIL する」（大文字含む） | PASS |
| UC3-S1 対象外 SKIP | §2.2.4 Scenario 5 | 全 NULL／カラム不在／トグル off／DB 不在で SKIP・exit 0 | PASS |
| ストーリー 3 方針不変 | §2.3.4 | `git diff` name-status に 2 方針ファイルなし（diff 空） | PASS |
| grandfather（ADR-6） | §2.4.4 Scenario 1 | 「grandfather 対象行は遡及 FAIL しない」＋env 上書きで境界可動 | PASS |
| 非交差（非機能 3.3） | §2.4.4 Scenario 2 | `test-audit.sh` 123 件回帰 PASS | PASS |
| ティア記録（前提・T1） | §2.1.4 | write-workflow-log.sh 記録経由で #38 が値を読む結合ケース | PASS |
| 根拠欠落（追加境界） | §2.2.3 | 「根拠欠落行は FAIL する」 | PASS |

**未達シナリオ: なし**（全シナリオがテストコード化され PASS）。テストコード化しない項目（例: fable 例外理由の内容妥当性）は設計 ADR-3/ADR-4 で「機械検知外＝人手/AI レビュー」と明記され、テスト化しない理由が文書化済み。

---

## 6. 二観点レビュー（REVIEW_DUAL_LENS §2・§3）

### 6.1 敵対的観点リスト（反証・破壊を試みた観点と結論）

1. **列崩れ攻撃**: `tier_rationale` に改行・タブを含めたら行走査が崩れるか？ → SELECT で `char(9)/10/13` を空白へ正規化＋US(0x1f) 区切りのため崩れない。**問題なし**。
2. **grandfather バイパス**: 非プレフィックス／空 `issue_path` で未明記行を素通りさせ検知逃れできるか？ → 素通りは安全側（誤 FAIL 回避）の設計判断（ADR-8）で、正規の issue（`YYYYMMDD_HHMMSS_` プレフィックス）は必ず判定対象。実運用の worker command 行はプレフィックス付き。**設計どおり・受容**。
3. **ブートストラップ検知漏れ**: 初回委譲で非空 model_tier 行が皆無なら段階 4 で全 SKIP し未明記を見逃すか？ → 見逃す。ただし ADR-5 が明記する意図的な安全側 fail-open。**既知の弱点・受容**（自己言及境界ケースの裏面＝§7）。
4. **fable 大小文字/空白**: `FABLE`・` fable ` で無申告バイパスできるか？ → `${mt,,}` で小文字化し `fable` 判定。テストで `FABLE` の無申告 FAIL・申告 PASS を確認。空白のみの `tier_exception` は `NULLIF` 経由の空／`-z` で FAIL。**問題なし**。
5. **CHECK 再構築マイグレーションのデータロス**: `review-docs`/`create-pr-review-issue` 記録時の `workflow_log_new` 再構築で新カラムが落ちないか？ → `workflow_log_new` 定義と `INSERT ... SELECT` の双方に 3 カラムを含めており保全される。**問題なし**（当初リスク箇所を実装が正しく処理）。
6. **既存チェック退行**: #38 追加で #3〜#37 の判定が変わるか？ → `test-audit.sh` 123 件回帰 PASS で不変を実証。**問題なし**。
7. **対象外環境ロックアウト**: 非 Claude／DB 非採用でチェックが exit 1 を出すか？ → 全ガードで SKIP＋exit 0 をテストで確認。**問題なし**。
8. **正本の陳腐化**: スキーマ変更に追随しない正本が残るか？ → `schema.md`・`docs/03` の未同期を発見・是正（指摘 A/B）。**是正済み**。

### 6.2 must-preserve リスト（壊してはならない不変条件と保持確認）

1. **既存 audit #3〜#37 の挙動・SKIP 条件** → 回帰 123 件 PASS で不変を確認。**保持**。
2. **write-workflow-log.sh の後方互換**（位置引数・必須検証・旧スキーマ経路・env 未指定時 NULL） → diff で不変を確認・全 env 任意。**保持**。
3. **`workflow_log` の append-only ハッシュチェーン**（`prev_hash`/`entry_hash`・書記単独 INSERT） → カラム追加のみで INSERT 経路・hash 計算は不変。**保持**（§7 の受容判断の根拠でもある）。
4. **方針文書（MODEL_SELECTION.md / MODEL_TIER_TABLE.md）の不変** → diff 空。**保持**。
5. **fable 例外規定**（ユーザー最重要指定時のみ許容・日常運用化しない） → 申告ありは PASS・無申告のみ FAIL で例外規定を壊さない。**保持**。
6. **対象外環境の非ロックアウト**（既存 enforcement のフォールバック原則） → 多層 SKIP で保持。**保持**。
7. **単一情報源**（対応表を audit に二重管理しない） → #38 は明記の有無のみ検査。**保持**。

いずれの是正（指摘 A/B・docs 同期）も上記不変条件を壊していない（退行なし）。

---

## 7. grandfather 自己言及的境界ケースの判断（重要判断）

### 7.1 事象（実測確認）

本 issue の scribe 配線（T3）完了**前**に記録された先行フェーズのログ 4 行（`design-feature` ×2・`review-docs` ×2）は `model_tier=NULL`。これらの `issue_path` プレフィックス `20260714_204451` は grandfather cutoff `20260714_000000` **以降**のため遡及除外されない。さらに本 issue の `implement-feature` 行（`model_tier=sonnet`）が ADR-5 段階 4「非空 model_tier 行が 1 件以上」を満たすため #38 が SKIP から実働へ転じ、当該 4 行が「ティア未明記」で FAIL する。

**実測（実プロジェクト `workflow.db` に対する #38 行走査の再現）**:

```
WOULD-FAIL(未明記): cd0c90ca design-feature ts=20260714_204451
WOULD-FAIL(未明記): 484b77fd design-feature ts=20260714_204451
WOULD-FAIL(未明記): 68488df5 review-docs   ts=20260714_204451
WOULD-FAIL(未明記): e3e5744b review-docs   ts=20260714_204451
PASS:               01f32e62 implement-feature mt=sonnet
```

これは #38 が genuinely 未記録の行を正しく検出した結果であり、誤検知（false positive）ではない。02_設計 ADR-6 の「既存 issue の一斉 FAIL は起きない」は**他の**既存 issue を想定した記述で、本 issue 自身の先行ログという自己言及ケースは射程外だった（設計の記述漏れ・実装バグではない）。

### 7.2 判断: 受容する（対処実装は行わない）

**根拠**:

- **(a) 本リポでは実害なし**: #38 は DB 系チェックであり、`workflow.db` は Git 非追跡かつ `self-enforce.yml` が audit を `continue-on-error`（非ブロッキング）で呼ぶため、本リポ CI では #38 は inert（常時 SKIP／緑を阻害しない）。02 §9.3 の申し送りと同一射程（evidence_source: existing_code＝`enforcement/README.md` の CI 限界記述・02 §9.3）。
- **(b) remediation の方が高リスク**: 既存 4 行を遡及 backfill するには append-only ハッシュチェーン（`prev_hash`/`entry_hash`・書記単独 INSERT）へ UPDATE を要し、チェーン不変性を壊す。除外要件「方針の書き直し・具体実装の後付け確定は対象外」の趣旨に反する過剰改修（evidence_source: existing_code＝`schema.sql`・`write-workflow-log.sh`）。
- **(c) cutoff では分離不能**: 5 行が同一 `issue_path` プレフィックスを共有するため、grandfather cutoff で先行 4 行のみを除外できない。cutoff を `20260714_204451` 超へ上げると implement 行も除外され、#38 が本 issue に一切適用されず自己検証性を失う（本末転倒）。

本ケースは ADR-5 帰結が既に明記する「ブートストラップ時は段階 4 で SKIP に倒れる＝安全側の弱点として許容」の**裏面**（初回の非空記録が本 issue 自身の implement 行である瞬間）に相当する既知の事象。**02_設計 ADR-6 帰結に本境界ケースと受容判断を追記済み**。

- **evidence_source**: observed_runtime（実 `workflow.db` に対する #38 行走査の再現・上記実測）＋ existing_code（ハッシュチェーン列・scribe 単独 INSERT）＋ 02 §9.3（CI inert の申し送り）。inference_only 単独ではない（実測＋既存コードで裏付け）。

---

## 8. 設計・境界の確認（review-architecture）

### 8.1 設計の確認

- **設計原則の準拠**: UNIX 哲学（`check_model_tier_recorded` は「記録有無の検査」1 事のみ）・単一責務（記録面/記録主体/検査主体/対応表の 4 分離）・CQRS（記録=Command／監査=Query・副作用なし）に準拠。**OK**。
- **命名・配置**: 既存 #34/#35 と同一命名規則（`check_*`・`*_GATE_ENABLED`・`*_GATE_EFFECTIVE_FROM`）。**OK**。

### 8.2 境界・依存の確認

- **責務の境界**: 契約点は `workflow_log` の 3 カラム名のみ。`write-workflow-log.sh` と `audit.sh #38` は互いを呼ばず、`MODEL_TIER_TABLE.md` はどちらからも内容転記されない。**OK**。
- **依存関係**: orchestrator → scribe → `workflow_log`（書込）／`audit.sh #38` → `workflow_log`（読取）。循環なし。**OK**。
- **非交差（ADR-7）**: #38 の検査対象カラム（新設 3 カラム）は既存 #3〜#37 のいずれとも重ならず、回帰テストで挙動不変を実証。**OK**。
- **指摘・推奨**: 02_設計 §2.1.1 責務一覧に `schema.md`（意味正本）を変更対象として含めるべきだった（指摘 A の根本）。本レビューで as-built 同期済み。

### 8.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| grandfather 自己言及境界ケースの受容 | observed_runtime + existing_code | §7・実 `workflow.db` #38 再現＋ハッシュチェーン列 |
| #38 が既存監査と非交差（退行なし） | test_output | `test/test-audit.sh` PASS=123 FAIL=0 |
| 全 BDD シナリオのテスト化・PASS | test_output | `test/test-model-tier-gate.sh` PASS=21 FAIL=0 |
| 方針文書不変 | existing_code | `git diff` name-status に 2 ファイルなし |
| CHECK 再構築でのデータロス防止 | existing_code | `write-workflow-log.sh` の `workflow_log_new` 定義＋`INSERT ... SELECT` 双方に 3 カラム |
| schema.md/docs/03 の as-built 同期 | existing_code | 本レビューで是正・§9 |

---

## 9. docs 更新（継続追随ゲート・DOCS_RULES §継続追随ゲート）

- **要否**: 要（`docs/` 採用リポ・実装変更あり）。
- **対象**: `docs/03_データ設計/README.md`（§3.4 主要カラム俯瞰へ 3 カラム追記・§3.5 索引件数 7→10 是正）。レビュー記録: [`docs/00_review/20260715_000910_review.md`](../../../00_review/20260715_000910_review.md)（指摘 2→0）。
- **理由**: `workflow_log` に 3 カラム＋3 索引を追加したため、俯瞰と索引件数の as-built 同期が必要だった。`docs/04_機能設計/enforcement/README.md` は失敗条件を source 正本へ委譲し「等」で非網羅列挙のため #38 追加で更新不要（根拠付き不要判定）。
- 併せて ledger 意味正本 `schema.md`（システム仕様書ではないが正本）も指摘 A として同期済み。

---

## 10. 課題と改善点

### 10.1 発見された課題

- 指摘 A（schema.md 未同期・**対応済み**）／指摘 B（索引超過・**受容**）／指摘 C（#37 欠番・**受容/非スコープ**）。§4.2 参照。

### 10.2 改善提案

- **改善 1（低・将来）**: `tier_rationale`/`tier_exception` の索引は照会経路が無く最小化候補。将来のスキーマ整理時に `idx_workflow_log_model_tier` のみ残す選択肢を検討（本 issue では受容・非対応）。
- **改善 2（申し送り）**: 本リポで #38 を実効化（workflow.db の CI 追跡・`continue-on-error` 除去）するかは #35/#36 と同じ申し送りで別 issue／ユーザー判断（02 §9.3）。

---

## 11. システム仕様書の更新

- 継続追随ゲート結果は §9 のとおり。`docs/03_データ設計/README.md` を as-built 同期（指摘 2→0）。レビュー記録は `docs/00_review/20260715_000910_review.md`、索引は `docs/00_review/README.md` に追記済み。
- **実装したデータ構造**: `workflow_log` に `model_tier`/`tier_rationale`/`tier_exception`（`TEXT NULL`）＋対応索引 3 件。
- **実装した機能**: `audit.sh #38`（`check_model_tier_recorded`）。
- システム概要・画面設計・機能設計（enforcement 俯瞰）は本変更で as-built を偽にしない（更新不要・根拠は §9）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計 ADR に忠実・堅牢なパース・後方互換・非交差を実証）。
- **テスト品質**: 良好（全 BDD シナリオをテスト化・21/21＋回帰 123/123 PASS・隔離実行）。
- **ドキュメント品質**: 良好（指摘 A/B の正本同期・継続追随ゲート通過後）。
- **総合評価**: **承認可**。ブロッキング指摘なし。指摘 A は本レビューで是正済み、指摘 B/C は受容（根拠記録済み）、grandfather 自己言及境界ケースは受容判断＋ADR-6 追記で決着。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close 実行エージェント（opus）
- **承認日**: 2026-07-15
- **承認コメント**: DoD 充足。close へ遷移可（commit/push は次フェーズでメインが実施）。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md)・[`01_要件定義.md`](./01_要件定義.md)・[`02_設計.md`](./02_設計.md)・[`03_実装計画.md`](./03_実装計画.md)
- [.agent-skill-chain/source/enforcement/ci/audit.sh](../../../../.agent-skill-chain/source/enforcement/ci/audit.sh)（#38）・[ledger/schema.sql](../../../../.agent-skill-chain/source/ledger/schema.sql)・[ledger/schema.md](../../../../.agent-skill-chain/source/ledger/schema.md)
- [docs/00_review/20260715_000910_review.md](../../../00_review/20260715_000910_review.md)（継続追随ゲート記録）

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md)

---

## 15. 次のステップ

- 外部設定不要のため issue 完了（close）。commit/push は次フェーズでメインが実施。
