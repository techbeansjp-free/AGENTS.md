---
document_id: "154a4094-d4f0-47a4-99f5-6799f8800d99"
---

# 04_review: 台帳・記録(ledger/scribe)の整合強化

**前のステップ**: [03_実装計画.md](./03_実装計画.md)
**対象**: 指摘 19 件（D-1〜D-7, D-9, D-10, D-13〜D-16, D-18, E-2, E-3, E-10, E-14, E-20）
**実装先 worktree**: `.worktree/bugfix/20260718_092843-台帳記録整合強化/`

---

## 1. 実装内容の確認（指摘 ID 別）

| ID | 実装 | 確認 |
| --- | --- | --- |
| D-1 | schema.md の entry_hash 説明を正確化（v1/v2 式・検証経路は audit/doctor・劣化境界を明記） | ✓ |
| D-2 | document_id を「新規記録で必須（ラッパーが exit1）／DB は NULL 許容」に統一（CONTRACT 28,66・schema.sql コメント・schema.md 列説明） | ✓ |
| D-3 | 必須キー定義を schema.md/schema.sql 正本参照へ一元化（scribe/README・CONTRACT の独自リスト縮退・created_at datetime('now') 是正・changed_files→changed_files_json） | ✓ |
| D-4 | schema.md 運用の「INSERT OR IGNORE 推奨」を「素の INSERT・OR IGNORE は用いない」へ | ✓ |
| D-5 | actor_role/delegated_by_role を「不変条件を DB 制約で固定する監査用固定値」と再定義（CHECK は維持・削除案は非採用） | ✓ |
| D-6 | dod_met を「自己申告 bit・audit は明記の有無のみ検査」と正直に明記（一律ハード制約は追加せず） | ✓ |
| D-7 | memo_ref 言及を削除（CONTRACT 29,36・schema.md の memo_ref SQL 削除） | ✓ |
| D-9 | REVIEW_RULE 外部根拠に inference_only（EVIDENCE_POLICY §節4）フォールバックを追加 | ✓ |
| D-10 | REVIEW_RULE の「全体徹底調査」を full=全体／quick・standard=影響範囲の深度スケールへ | ✓ |
| D-13 | schema.md の逐語 CREATE 写し・旧スキーマ SQL・memo_ref SQL を削除し参照へ縮退（列説明・必須表・移行手順は維持） | ✓ |
| D-14 | ドッグフーディング固有パス直書きを `.agent-skill-chain/project/` 上書き参照の抽象表現へ（CODE_COMMENT_RULES 24・DOCS_NOISE 46＋49） | ✓ |
| D-15 | HEARTBEAT/CLOSEOUT に `[機械強制]`/`[推奨・自己規律]` 二層マーカー付与（HEARTBEAT のトリガー文言・使用タイミングは不変） | ✓ |
| D-16 | DOCS_NOISE の実在しない「R-5」を「継続追随ゲート 手順 2」へ張替え | ✓ |
| D-18 | tier_rationale/tier_exception の索引削除（schema.sql・heredoc・ensure_column noindex）。model_tier 索引は維持 | ✓ |
| E-2 | entry_hash v2 新設（20 カラム＋prev_hash・hash_version 列・既存行 v1 のまま・新規行 v2） | ✓ |
| E-3 | v2 のバイト長プレフィックス枠付けで境界衝突を解消（E-2 に同梱・v1 不変） | ✓ |
| E-10 | 「DB パス固定」宣言を resolve-wf-db.sh の実挙動へ正確化（override 維持） | ✓ |
| E-14 | 移行 heredoc を if 形式化しデッドコードのエラー分岐を有効化 | ✓ |
| E-20 | to_json_array に制御文字エスケープ（json_escape_str）を追加 | ✓ |

## 2. entry_hash 移行（E-2/E-3）の実測検証

- **決定性（locale 非依存）**: `gen_entry_hash_v2` を LC_ALL=C / en_US.UTF-8 / C.UTF-8 の 3 環境で実行し、日本語パスを含む入力で**同一ハッシュ**を得た（関数内 `local LC_ALL=C LANG=C` によりバイト長で決定化）。
- **境界衝突の解消（E-3）**: `("a|b","c",...)` と `("a","b|c",...)` が**異なるハッシュ**になることを確認（長さプレフィックス枠付けで単射）。
- **往復検証（E-2 の核）**: 書込後の行を DB から再構成（NULL→空文字）し `gen_entry_hash_v2` で再計算 → 格納 entry_hash と**完全一致**（model_tier/tier_rationale/prev_hash/日本語パス投入時も一致）。検証側が同一規則で再計算可能なことを実証。
- **非破壊移行**: hash_version 列を欠く旧新スキーマ DB に対し、ensure_column が hash_version を追加し、**既存行は NULL(v1) のまま・新規行のみ hash_version=2(v2)**。tier 索引は再生成されない。
- **prev_hash チェーン**: 連続 3 行で各行 prev_hash = 直前行 entry_hash を確認。
- **E-14/E-20 実測**: review-docs/create-pr-review-issue の再作成 heredoc 経路が正常動作（hash_version 追随・tier 索引不在）。制御文字（CR/SOH/BS）入りファイル名で valid JSON（`\r`/``/`\b`）を生成。

## 3. 受け入れ基準の確認

- `bash -n` 全スクリプト構文 OK。
- schema.sql: 新規 CREATE OK・列 22（hash_version 含む）・索引に tier_rationale/tier_exception 無し・model_tier 有り。
- 全 command（requirement-discovery/design-feature/implement-feature/verify-and-close/review-docs/create-pr-review-issue）で INSERT 成功、hash_version=2。
- `--print-head` read 経路が引き続き機能。
- 正本一元化: schema.md に逐語 SQL フェンス 0・CREATE は prose 参照のみ・memo_ref SQL 削除。R-5 残存 0・target ファイルの docs/maintainer/workflow 直書き 0。

## 4. レビュー結果（敵対的観点リスト）

境界・前提崩れを攻める観点で自己レビューした。

1. **[整合] v2 ハッシュと DB 再構成の NULL 正規化が非対称にならないか** → 書込側は NULLIF 前の生値（空文字）を、検証側は DB の NULL を空文字へ戻して算入。往復検証で一致を実証。**問題なし**。
2. **[決定性] `${#f}` の locale 依存**（UTF-8=文字数／C=バイト数）→ 関数内 `local LC_ALL=C LANG=C` で bash がロケール再設定。3 ロケールで同一ハッシュを実測。**問題なし**。
3. **[整合] 再作成 heredoc への hash_version 追随漏れ** → CREATE/INSERT...SELECT 双方に hash_version を追加。create-pr-review-issue 経路の実測で列消失なし。**問題なし**。
4. **[整合] ensure_column の索引自動生成が D-18 と衝突** → noindex オプションを追加し tier_rationale/tier_exception/hash_version を索引なしで追加。移行 DB で tier 索引再生成なしを実測。**問題なし**。
5. **[破壊回避] v1 関数の不変性** → `gen_entry_hash` を 1 文字も変更せず v2 を別関数で追加。既存行の false positive を回避。**問題なし**。
6. **[E-14] if 形式化で新たな未捕捉が生じないか** → `if ! sqlite3 <<heredoc; then exit1; fi` で set -e 下でも失敗分岐に到達。正常時 exit0 も実測。**問題なし**。
7. **[E-20] awk エスケープが正常パスを壊さないか** → 通常パス（`foo/bar.py`）は素通し・後方互換。UTF-8 マルチバイトは LC_ALL=C でバイト単位素通し。日本語パスの往復一致で確認。**問題なし**。
8. **[整合] schema.md 逐語削除が列説明・移行手順を巻き込まないか** → 削除は SQL フェンスのみ。列説明・command 別必須表・移行手順・列名索引は維持（D-13 干渉なし）。**問題なし**。
9. **[波及] ledger/README の schema.md CREATE TABLE 参照が D-13 削除で宙に浮く** → schema.sql 参照へ張替え済み。**問題なし**。
10. **[スコープ] DOCS_NOISE 49 行の固有パスを D-14 指定外だが修正** → 同一欠陥クラスの半端修正回避のため line 46 と併せ抽象化（04 に明記）。**意図的**。

### must-preserve リスト（退行防止・不変条件）

後続サブ・レビューが**壊してはならない**不変条件:

- **MP-1**: `gen_entry_hash`（v1・14 フィールド `|` 連結）は 1 文字も変更しない。既存行の検証はこの式に依存する。
- **MP-2**: v2 のハッシュ対象は「entry_hash と hash_version を除く 20 カラム（末尾 prev_hash）」で、書込側と検証側が**完全に同順・同正規化（NULL→空文字・LC_ALL=C バイト長）**であること。
- **MP-3**: hash_version は既存行で NULL(v1) のまま。**遡及 UPDATE・全行再計算をしない**（追記専用台帳）。
- **MP-4**: schema.sql の CHECK 制約（actor_role='scribe'・delegated_by_role='orchestrator'・command IN(...)・dod_met IN(0,1)・length 系）を削除・緩和しない。
- **MP-5**: SQL の実体は schema.sql の 1 か所のみ。schema.md に逐語 CREATE を復活させない（正本重複禁止）。
- **MP-6**: model_tier 索引は維持（絞込に有用）。tier_rationale/tier_exception/hash_version は索引を作らない。
- **MP-7**: HEARTBEAT のトリガー文言（3 行「新しいタスク開始時・phase 遷移時・長い会話の後」）・使用タイミング節（43-47 行相当）は #143 の領域につき変更しない。
- **MP-8**: resolve-wf-db.sh の PROJECT_ROOT/WORKFLOW_DIR override（ADR-132-1 worktree 横断解決）を廃止・制限しない。

## 5. クロスパッケージ follow-up（未完・別パッケージ）

- `scripts/export-ndjson.sh` の全カラム出力（hash_version 含む）＝**ハード依存**。欠けると外部証跡検証が沈黙破綻。
- チェーン検証経路（audit.sh 追加 or doctor 新設）＝ D-1 の本質的解決。
- D-14 enforcement grep の固有パス検出の project/ 移設＝ソフト依存。

いずれも本パッケージ非所有。同一リリースで揃えることを推奨。

## 6. 反復記録

- ラウンド1: 上記敵対的観点 1〜9 を検出・全対応（実測で裏付け）。
- ラウンド2: スコープ隣接の DOCS_NOISE 49 行（観点 10）を検出・意図的に併修。
- ラウンド3: 指摘 0 件。反復終了。
