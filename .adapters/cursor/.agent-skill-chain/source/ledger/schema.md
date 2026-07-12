# workflow.db スキーマ定義

**証跡の正本は workflow.db（SQLite）**。write-workflow-log capability は本スキーマを参照して記録する。**workflow.db が無ければ作成すること**（初回実行時に以下の SQL でテーブルを用意する）。workflow.db を採用しない場合は scribe/CONTRACT に従い memo のみの過渡的・例外運用となる。**memo のみは非推奨・移行モード・廃止予定**とする。

---

## 配置

- **ファイル**: プロジェクトで定めたパスに workflow.db を配置する（推奨: .agent-skill-chain/runtime/workflow.db）。
- **書込**: 書記（write-workflow-log）のみが書き込む。一意のパスをプロジェクトで定める。
- **初回**: DB ファイルが存在しなければ、sqlite3 で DB を作成し、以下の CREATE TABLE IF NOT EXISTS を実行すること。

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

- **workflow.db に実際に作られるテーブルは `workflow_log` の 1 つだけ**である。新規 DB 作成時、setup.sh（`init_workflow_db`）と write-workflow-log.sh はいずれも `ledger/schema.sql` を流すだけで、`schema.sql` が定義する実在テーブルは `workflow_log`（＋索引 7 件）のみ。
- **SQL の単一正本は [schema.sql](schema.sql)**。`workflow_log` の `CREATE TABLE` と索引定義の実体は schema.sql にのみ置く。**本ファイル（schema.md）内の SQL ブロックは実体ではなく解説・例示・移行手順であり、新規 DB 作成時には流されない。** 実在テーブルの定義を二重に持たないため、相違が生じた場合は常に schema.sql を正とする。
- 本ファイル以降に現れる SQL の区分:
  - 「推奨スキーマ完成版」の `workflow_log` … **schema.sql の写し（解説用）**。編集対象は schema.sql のみ。
  - 「旧スキーマ（移行前の参照用）」… **過去 DB の説明であり新規作成では使わない**（実在テーブルではない）。
  - 「証跡（memo）の参照」`memo_ref` … **将来案の例示。どのスクリプトも作成しない**（実在テーブルではない）。
  - 「既存 DB のマイグレーション」`ALTER TABLE` 群 … 既存 DB を schema.sql 相当へ寄せるための手順（実体は write-workflow-log.sh のマイグレーション分岐）。

## 想定テーブル（SQLite の例）

### 推奨スキーマ完成版（チェーン型証跡・順序監査対応）— schema.sql の解説用写し

**本スキーマの正本**: ログを書くのは書記のみとするため **actor_role は `scribe` のみ**、委譲元は **delegated_by_role は `orchestrator` のみ** を DB 制約で強制する。**changed_files_json は implement-feature で必須**とする。テンプレート・監査・運用方針と完全に一致させる。

**SQL の正本は schema.sql**（[schema.sql](schema.sql)）。CREATE TABLE workflow_log と索引定義の実体は schema.sql に一本化されており、setup.sh / write-workflow-log.sh は新規 DB 作成時に schema.sql を流す。本ファイルの以下の SQL は解説用の参照であり、相違が生じた場合は schema.sql を正とする。

**新規作成時に実際に流すのは [schema.sql](schema.sql) であり、以下の SQL ブロックはその内容を解説するための写しである（編集対象は schema.sql のみ。ここを書き換えても DB には反映されない）。** ログを単発イベントではなく「チェーンされた実行証跡」として扱い、`parent_entry_id` で因果関係を追える。`actor_role` / `delegated_by_role` で実行主体と委譲元を記録し、`entry_hash` で改ざん検知の土台を用意する。既存 DB がある場合は ledger/README のマイグレーション方針に従う。

```sql
CREATE TABLE IF NOT EXISTS workflow_log (
  entry_id TEXT PRIMARY KEY,
  parent_entry_id TEXT NULL,
  document_id TEXT NULL,
  ts_utc TEXT NOT NULL,
  created_at TEXT NOT NULL,

  actor_role TEXT NOT NULL,
  delegated_by_role TEXT NOT NULL,

  command TEXT NOT NULL,
  issue_id TEXT NULL,
  review_id TEXT NULL,
  issue_path TEXT NULL,
  review_path TEXT NULL,
  document_path TEXT NULL,
  changed_files_json TEXT NULL,

  summary TEXT NOT NULL,
  dod_met INTEGER NOT NULL CHECK (dod_met IN (0, 1)),

  prev_hash TEXT NULL,
  entry_hash TEXT NOT NULL,

  CHECK (length(entry_id) > 0),
  CHECK (length(ts_utc) > 0),
  CHECK (length(created_at) > 0),
  CHECK (length(actor_role) > 0),
  CHECK (length(delegated_by_role) > 0),
  CHECK (length(command) > 0),
  CHECK (length(summary) > 5),
  CHECK (actor_role = 'scribe'),
  CHECK (delegated_by_role = 'orchestrator'),
  CHECK (command IN (
    'requirement-discovery',
    'design-feature',
    'implement-feature',
    'verify-and-close',
    'review-docs',
    'create-pr-review-issue'
  ))
);

CREATE INDEX IF NOT EXISTS idx_workflow_log_ts_utc ON workflow_log(ts_utc);
CREATE INDEX IF NOT EXISTS idx_workflow_log_command ON workflow_log(command);
CREATE INDEX IF NOT EXISTS idx_workflow_log_parent ON workflow_log(parent_entry_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_path ON workflow_log(document_path) WHERE document_path IS NOT NULL;
```

- **issue_id**: issue を一意に識別する UUID。00_要求定義.md の frontmatter の issue_id と一致する。NULL 許容（移行用）。
- **review_id**: レビュー成果物（例: 04 の document_id）を一意に識別する UUID。NULL 許容（移行用）。

### 期待スキーマのカラム一覧（書記のスキーマ比較用）

書記（write-workflow-log）が PRAGMA table_info の結果と比較する際の期待カラム名（順序は問わない）:

entry_id, parent_entry_id, document_id, ts_utc, created_at, actor_role, delegated_by_role, command, issue_id, review_id, issue_path, review_path, document_path, changed_files_json, summary, dod_met, prev_hash, entry_hash

- **entry_id**: 1 レコードを一意に識別。UUID 推奨。
- **parent_entry_id**: 親ログの entry_id。requirement-discovery → design-feature → implement-feature → verify-and-close の流れを追う。
- **actor_role**: 実際にログを書いた役割。DB 制約で `scribe` のみ許可（本則を強制）。
- **delegated_by_role**: 誰の委譲で実行したか。DB 制約で `orchestrator` のみ許可（原則を強制）。
- **review_path**: verify-and-close 時に必須。例: `.agent-skill-chain/runtime/20260310_xxx/04_review.md`。
- **changed_files_json**: 変更ファイル一覧の JSON 配列文字列。implement-feature で必須。
- **document_id**: 対応する成果ドキュメント（00/01/02/03/04）の UUID。frontmatter の document_id と一致させる。NULL 許容（既存行・未対応運用との互換）。**不変**: 同一 document_path に対して既に記録された document_id は変更・上書き禁止（RULES.md §document_id 不変）。audit.sh および write-workflow-log.sh で検証する。
- **document_path**: 成果ドキュメントのパス（プロジェクトルート相対、例: `.agent-skill-chain/runtime/xxx/00_要求定義.md`）。document_id 不変チェック用。NULL 許容（記録時に指定した場合のみ設定）。
- **prev_hash / entry_hash**: 改ざん検知用。entry_hash = hash(entry_id|parent_entry_id|ts_utc|...)。

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

既存の workflow_log に対して、不足しているカラムを追加する。**実行順序を守ること**。新規作成時は上記推奨スキーマの CREATE TABLE を使う。

1. **document_id の追加**（document_id が無い場合のみ）

```sql
ALTER TABLE workflow_log ADD COLUMN document_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_log_document_id ON workflow_log(document_id);
```

2. **issue_id の追加**（issue_id が無い場合のみ）

```sql
ALTER TABLE workflow_log ADD COLUMN issue_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_log_issue_id ON workflow_log(issue_id);
```

3. **review_id の追加**（review_id が無い場合のみ）

```sql
ALTER TABLE workflow_log ADD COLUMN review_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_log_review_id ON workflow_log(review_id);
```

### 旧スキーマ（移行前の参照用）— 実在テーブルではない（説明のみ）

既存 DB が次のテーブルを持っている場合は、推奨スキーマへのマイグレーションを検討する。**新規作成では schema.sql の `workflow_log` のみを使う。次の SQL は過去 DB の説明であり、新規作成時には流さない。**

```sql
-- 旧: 1 実行 = 1 行。UNIQUE(command, ts_utc)
CREATE TABLE IF NOT EXISTS workflow_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  command TEXT NOT NULL,
  issue_path TEXT,
  summary TEXT,
  changed_files TEXT,
  dod_met INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(command, ts_utc)
);
```

### 証跡（memo）の参照 — 実在テーブルではない（将来案の例示）

次の `memo_ref` は memo を DB から参照したくなった場合の将来案の例示にすぎず、**現状どのスクリプトも作成しない**。実在テーブルに含めない。採用する場合は schema.sql に追記してから（schema.sql を唯一の正本として）使うこと。

```sql
CREATE TABLE IF NOT EXISTS memo_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 運用

- **書記による書き込み経路の一本化（必須）**: workflow.db を採用する場合、記録は **必ず** .agent-skill-chain/source/scripts/write-workflow-log.sh 経由で行うこと。sqlite3 を直接許可せず、**専用ラッパー 1 本**（.agent-skill-chain/source/scripts/write-workflow-log.sh）のみを許可し、その内部でのみ workflow_log へ INSERT させる。ラッパーは次を強制すること: 書き込み先は .agent-skill-chain/runtime/workflow.db 固定、workflow_log テーブルのみ、INSERT のみ、必須カラム未指定なら失敗、1 回 1 レコード、UPDATE/DELETE/任意 SQL 禁止。これにより「書記以外の sqlite3」を hook で判別せず経路で解く。
- スキーマを変更する場合は、本ファイルを更新し、既存 DB がある場合はマイグレーションをプロジェクトで行う。
- **書き込み前**: 排他制御・同時書き込み対策のとおり、接続直後に PRAGMA（journal_mode=WAL, synchronous=NORMAL, 推奨 busy_timeout）を実行する。
- 同一 (command, ts_utc) の重複を防ぐため、**INSERT OR IGNORE** または **INSERT ... ON CONFLICT(...) DO NOTHING** を推奨する。
- workflow.db を採用しない場合は、memo ファイル（YYYYMMDD_HHMMSS_ プレフィックス）と 04_review で証跡を残す。
