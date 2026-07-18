# workflow.db スキーマ定義

**証跡の正本は workflow.db（SQLite）**。write-workflow-log capability は本スキーマを参照して記録する。**workflow.db が無ければ作成すること**（初回実行時に `ledger/schema.sql` を流してテーブルを用意する）。workflow.db を採用しない場合は scribe/CONTRACT に従い memo のみの過渡的・例外運用となる。**memo のみは非推奨・移行モード・廃止予定**とする。

---

## 配置

- **ファイル**: プロジェクトで定めたパスに workflow.db を配置する（推奨: .agent-skill-chain/runtime/workflow.db）。
- **書込**: 書記（write-workflow-log）のみが書き込む。一意のパスをプロジェクトで定める。
- **初回**: DB ファイルが存在しなければ、sqlite3 で DB を作成し、[schema.sql](schema.sql) を流すこと（本ファイル内に CREATE TABLE の実体は持たない）。

---

## 排他制御・同時書き込み対策

複数エージェントが同時に workflow.db に書くと "database is locked" が発生する。並列 subagent / tool call で起きうるため、以下を守ること。

- **WAL モード**: 書記（write-workflow-log）が workflow.db に接続したら、**最初に** `PRAGMA journal_mode=WAL;` と `PRAGMA synchronous=NORMAL;` を実行すること。並列書き込み時の lock 競合を軽減する。
- **busy_timeout**: 可能な環境では `PRAGMA busy_timeout=5000;`（5 秒）を設定すること。
- 上記 PRAGMA は **DB 作成時および書き込み前**に実行する。運用の「書き込み前」から本セクションを参照すること。
- **排他（flock）**: write-workflow-log.sh は、INSERT 実行前に専用ロックファイル（`.agent-skill-chain/runtime/workflow.db.lock`。workflow.db と同じディレクトリに `workflow.db.lock` を置く）に対して `flock` で排他ロックを取得する。`flock` コマンドが利用可能な環境でのみ取得し、取得中は他プロセスは同ロックで待機する。利用不可の環境ではリトライのみで対応する。
- **SQLITE_BUSY リトライ**: sqlite3 の INSERT が "database is locked" / "SQLITE_BUSY" で失敗した場合、**最大 5 回**まで **100 ms** 間隔でリトライする。5 回を超えると終了コード 1 で終了し、標準エラーにメッセージを出す。

---

## 実在テーブルと正本の所在（最初に読むこと）

- **workflow.db に実際に作られるテーブルは `workflow_log` の 1 つだけ**である。新規 DB 作成時、setup.sh（`init_workflow_db`）と write-workflow-log.sh はいずれも `ledger/schema.sql` を流すだけで、`schema.sql` が定義する実在テーブルは `workflow_log`（＋索引）のみ。
- **SQL の単一正本は [schema.sql](schema.sql)**。`workflow_log` の `CREATE TABLE` と索引定義の実体は schema.sql にのみ置く。**本ファイル（schema.md）には SQL の実体（CREATE TABLE の逐語コピー）を持たない。** 本ファイルはカラムの意味・command 別必須規約・マイグレーション手順という「仕様の解説」を担い、実 SQL は schema.sql を参照する（正本重複の排除。[DOCS_NOISE_RULES.md (iii)](../DOCS_NOISE_RULES.md)）。相違が生じた場合は常に schema.sql を正とする。

## 想定テーブル（SQLite）

### 推奨スキーマ完成版（チェーン型証跡・順序監査対応）

**実 SQL は [schema.sql](schema.sql) を参照する（本ファイルに写しは置かない）。** 以下は当該テーブルの設計意図とカラム仕様の解説である。

**設計意図**: ログを書くのは書記のみとするため **actor_role は `scribe` のみ**、委譲元は **delegated_by_role は `orchestrator` のみ** を DB 制約（CHECK）で強制する。**changed_files_json は implement-feature で必須**とする。ログを単発イベントではなく「チェーンされた実行証跡」として扱い、`parent_entry_id` で因果関係を、`prev_hash`/`entry_hash` で改ざん検知の土台を用意する。テンプレート・監査・運用方針と完全に一致させる。既存 DB がある場合は下記マイグレーション方針に従う。

- **issue_id**: issue を一意に識別する UUID。00_要求定義.md の frontmatter の issue_id と一致する。NULL 許容（移行用）。
- **review_id**: レビュー成果物（例: 04 の document_id）を一意に識別する UUID。NULL 許容（移行用）。

### 期待スキーマのカラム一覧（書記のスキーマ比較用）

書記（write-workflow-log）が PRAGMA table_info の結果と比較する際の期待カラム名（順序は問わない。schema.sql 由来の比較用名称索引であり、CREATE の複製ではない）:

entry_id, parent_entry_id, document_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, document_path, changed_files_json, summary, dod_met, model_tier, tier_rationale, tier_exception, prev_hash, entry_hash, hash_version

- **entry_id**: 1 レコードを一意に識別。UUID 推奨。
- **parent_entry_id**: 親ログの entry_id。requirement-discovery → design-feature → implement-feature → verify-and-close の流れを追う。
- **actor_role**: 実際にログを書いた役割。DB 制約で `scribe` のみ許可。これは自由記録欄ではなく、「ログを書けるのは書記のみ」という**不変条件を DB 制約で固定する監査用の固定値**である（単一値であることは情報量ゼロではなく、制約違反の書込を弾く意図的な設計）。
- **delegated_by_role**: 誰の委譲で実行したか。DB 制約で `orchestrator` のみ許可。actor_role と同様、「委譲元は orchestrator のみ」という**不変条件を固定する監査用の固定値**であり、自由記録欄ではない。
- **review_path**: verify-and-close 時に必須。例: `.agent-skill-chain/runtime/20260310_xxx/04_review.md`。
- **changed_files_json**: 変更ファイル一覧の JSON 配列文字列。implement-feature で必須。
- **document_id**: 対応する成果ドキュメント（00/01/02/03/04）の UUID。frontmatter の document_id と一致させる。DB スキーマ上は NULL 許容（既存行・移行互換）。**新規記録での必須性は DB 制約ではなくラッパー（write-workflow-log.sh）が担保する**（空の DOCUMENT_ID を exit 1 で拒否）。**不変**: 同一 document_path に対して既に記録された document_id は変更・上書き禁止（RULES.md §document_id 不変）。audit.sh および write-workflow-log.sh で検証する。
- **document_path**: 成果ドキュメントのパス（プロジェクトルート相対、例: `.agent-skill-chain/runtime/xxx/00_要求定義.md`）。document_id 不変チェック用。NULL 許容（記録時に指定した場合のみ設定）。
- **dod_met**: DoD 達成の自己申告 bit（0/1）。**audit は明記の有無（0/1 が入っているか）のみを検査し、達成の真偽は検証しない**。DoD 達成の真偽の完全な機械化は LLM 駆動作業では本質的に不能なため、既存の command 別必須（implement-feature=changed_files_json, verify-and-close=review_path/parent_entry_id）で実質的な artifact 参照を担保する（全 command 一律の根拠パス必須制約は課さない）。
- **model_tier / tier_rationale / tier_exception**: 委譲時に選定したモデルティア（`opus`/`sonnet`/`haiku`/`fable` 等）・その根拠 1 行（`MODEL_TIER_TABLE.md` 該当行の引用）・fable 使用時の例外申告（ユーザー最重要指定の記録）。いずれも `TEXT NULL`（非 tier ランタイム・既存行は NULL）。値の妥当性はスクリプト層では検証せず、記録の有無を audit.sh #38（`check_model_tier_recorded`）が検査する（明記の有無のみ・対応表とは照合しない）。tier_rationale / tier_exception は自由文のため索引を作らない（絞込に有用な model_tier のみ索引を持つ）。
- **prev_hash / entry_hash / hash_version**: 改ざん検知用のチェーン。算出の**正本は [scripts/gen-entry-hash.sh](../scripts/gen-entry-hash.sh)** であり、本ファイルは式を二重定義しない。`hash_version` が版を示す（NULL=レガシー v1、2=v2）。
  - **v1（hash_version=NULL・既存行のみ・不変）**: 14 フィールド（entry_id, parent_entry_id, document_id, ts_utc, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, changed_files_json, summary, dod_met）を `|` 連結して sha256。**prev_hash を含まないため、行の削除・並べ替え・prev_hash 書換をチェーンとしては検知できない**（個別行のハッシュ検証は可能だが、チェーン保護されない劣化区間）。
  - **v2（hash_version=2・新規行）**: entry_hash と hash_version を除く全 20 カラム（prev_hash を含む）を、`LC_ALL=C` 下のバイト長プレフィックス枠付け（`<バイト長>:<値>` の連結）で並べて sha256。長さプレフィックスにより値に `|`・改行・制御文字が含まれてもフィールド境界の衝突が原理的に起きない。DB の NULL は空文字列に正規化して算入する。prev_hash を算入するため、行の削除・並べ替え・prev_hash 書換のいずれも再計算なしにはチェーン検証を通過できない。
  - **検証経路**: entry_hash / prev_hash の**チェーン検証は検証側（audit/doctor 等）が担う**。検証側は各行の hash_version に応じて v1/v2 を選び gen-entry-hash.sh で再計算し、prev_hash の連結を照合する（本パッケージは算出側の正本のみを定義し、検証スクリプトは所有しない）。**移行境界の劣化**: 既存 v1 区間は遡及的にはチェーン強化されない。切替時点以降の v2 区間のみが改ざん耐性チェーンとなる（この境界を「検証済み」と誤認しないこと）。

### command ごとの必須カラム規約（ラッパー・audit で保証）

| command | 必須にすべきカラム |
|---------|---------------------|
| requirement-discovery | entry_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_path, summary, dod_met, entry_hash |
| design-feature | 上記 + issue_path |
| implement-feature | issue_path, changed_files_json（空配列でなく実体） |
| verify-and-close | issue_path, review_path, parent_entry_id（親は implement-feature または design-feature）。review_id は任意（review_path と併用可）。 |
| review-docs | issue_path, summary, dod_met（対象 00/01/02/03 の document_id は任意） |
| create-pr-review-issue | issue_path（90_issues 配下）, summary, dod_met |

### 既存 DB のマイグレーション

既存の workflow_log に対して、不足しているカラムを追加する（write-workflow-log.sh の `ensure_column` が定義順に冪等実行する）。新規作成時は schema.sql の CREATE TABLE を使う。マイグレーションで追加する主なカラム順は document_id → issue_id → review_id → document_path → model_tier → tier_rationale → tier_exception → hash_version。tier_rationale / tier_exception / hash_version は索引を作らない（自由文・低カーディナリティのため）。`hash_version` は既存行では NULL のまま（v1 判定）とし、遡及的な再計算・UPDATE は行わない（追記専用台帳の原則）。

### 旧スキーマ（移行前の参照用）— 実在テーブルではない（説明のみ）

過去の DB は「1 実行 = 1 行、`id INTEGER PRIMARY KEY AUTOINCREMENT`、`UNIQUE(command, ts_utc)`、素の `command/issue_path/summary/changed_files/dod_met/created_at` 列」という単純な形だった場合がある。これは過去 DB の説明であり、**新規作成では schema.sql の `workflow_log` のみを使う**（旧スキーマの SQL は実在テーブルではない）。既存 DB が旧形の場合は推奨スキーマへのマイグレーションを検討する。

### 証跡（memo）の参照 — 実在テーブルではない（採用されていない将来案）

memo を DB から参照したくなった場合の将来案として `memo_ref` テーブルが議論されたことがあるが、**現状どのスクリプトも作成しない実在しないテーブル**である。DB テーブルとしての memo 参照は存在せず、memo は思考メモとしてファイルで扱う。採用する場合は schema.sql に追記してから（schema.sql を唯一の正本として）使うこと。

---

## 運用

- **書記による書き込み経路の一本化（必須）**: workflow.db を採用する場合、記録は **必ず** .agent-skill-chain/source/scripts/write-workflow-log.sh 経由で行うこと。sqlite3 を直接許可せず、**専用ラッパー 1 本**（.agent-skill-chain/source/scripts/write-workflow-log.sh）のみを許可し、その内部でのみ workflow_log へ INSERT させる。ラッパーは次を強制すること: 書き込み先は解決済み canonical DB、workflow_log テーブルのみ、INSERT のみ、必須カラム未指定なら失敗、1 回 1 レコード、UPDATE/DELETE/任意 SQL 禁止。これにより「書記以外の sqlite3」を hook で判別せず経路で解く。
- スキーマを変更する場合は、schema.sql（正本）と本ファイルの解説を更新し、既存 DB がある場合はマイグレーションをプロジェクトで行う。
- **書き込み前**: 排他制御・同時書き込み対策のとおり、接続直後に PRAGMA（journal_mode=WAL, synchronous=NORMAL, 推奨 busy_timeout）を実行する。
- **重複防止と挿入方式**: 重複防止は `entry_id PRIMARY KEY` が担う。挿入は**素の INSERT** を用い、エラー時は失敗扱いとする。**`INSERT OR IGNORE` は用いない**（CHECK 違反も黙殺して 0 行挿入のまま正常終了し、証跡のサイレント欠落を招くため）。正規経路（write-workflow-log.sh の新スキーマ）は既に素の INSERT を使う。
- workflow.db を採用しない場合は、memo ファイル（YYYYMMDD_HHMMSS_ プレフィックス）と 04_review で証跡を残す。
