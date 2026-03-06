# SCRIBE CONTRACT - 書記契約（ログ保存の唯一の正本）

書記は「**ログのみ**」を書く。ログは **1 回の呼び出しで 1 件のみ**。

**ログの書き方・ペイロード形式は本 CONTRACT にのみ従う。** 他ファイルは本 CONTRACT を参照し、別の形式（省略形・別名・任意項目の必須化）で定義してはならない。

**ログとそれ以外の memo の区別**: ログとして扱う記録は、workflow.db に記録されたもの、または本 §5 形式の memo のみとする。それ以外の memo（作業メモ等）はトレーサビリティの証跡には用いない。

---

## 1. ログ保存先（固定）

- **workflow.db（SQLite）のみ**。`.workflow/**/logs/` は廃止・使用禁止。
- 書記未使用時の暫定記録は §5 のフォーマットにのみ従う。

---

## 2. メイン→書記に渡すペイロード（固定・この形式のみ）

メインが書記サブにログ 1 件を委譲するとき、**次の JSON 形式のみ**を使用する。キー名・必須の有無を変えてはならない。

```json
{
  "issue_id": "<対象 issue の UUID または task_id>",
  "timestamp": "<ISO8601。実行時刻。JST 推奨>",
  "created_at": "<ISO8601。記録日時。書記が省略時は記録時点で補完可>",
  "agent_id": "<実行した人格。要件BDDリード|実装者|テスト者|監査者|総合レビューリード|書記>",
  "action_type": "<EXECUTION_CONTRACT §2.1 の表に従う。plan|execute|review または 00_要求定義 等>",
  "target_artifact": "<主な対象成果物のパスまたは論理名。空文字禁止>",
  "summary": "<3 行以内の要約。空文字禁止>",
  "input_ref": "<任意。入力参照>",
  "output_ref": "<任意。出力参照>",
  "error_flag": 0,
  "human_required": 0
}
```

| キー | 必須 | 説明 |
|------|------|------|
| issue_id | 必須 | 対象 issue の識別子。 |
| timestamp | 必須 | 実行時刻（ISO8601）。 |
| created_at | 必須 | 記録日時（ISO8601）。書記が記録時に補完してよい。 |
| agent_id | 必須 | 実行した人格。 |
| action_type | 必須 | [EXECUTION_CONTRACT §2.1](../boot/EXECUTION_CONTRACT.md) の phase→action_type 表に従う。`plan` / `execute` / `review` またはフェーズ名（`00_要求定義` / `01_要件定義` 等）。 |
| target_artifact | 必須 | 主な対象成果物。パスまたは論理名。空は禁止。 |
| summary | 必須 | 人間が読む用の要約。3 行以内。空は禁止。 |
| input_ref, output_ref, error_flag, human_required | 任意 | スキーマの列と同様。 |

**正規ルール**: 上記以外のキーを追加したり、必須を省略したり、キー名を変更したりしてはならない。書記は本形式を受け取り、`execution_logs` に 1 行 INSERT する。

---

## 3. 書記が workflow.db に書くときの対応

書記は §2 のペイロードを受け取り、[ワークフローログ_SQLiteスキーマ](../ledger/ワークフローログ_SQLiteスキーマ.md) の `execution_logs` に 1 行 INSERT する。ペイロードのキーとスキーマの列は次の対応とする。

- issue_id → issue_id
- timestamp → timestamp
- created_at → created_at（未渡しの場合は書記が記録時点の ISO8601 を設定）
- agent_id → agent_id
- action_type → action_type
- target_artifact → target_artifact
- input_ref → input_ref
- output_ref → output_ref
- summary → summary
- error_flag → error_flag（未渡しは 0）
- human_required → human_required（未渡しは 0）

---

## 4. action_type の値（EXECUTION_CONTRACT に従う）

`action_type` は [EXECUTION_CONTRACT §2.1](../boot/EXECUTION_CONTRACT.md) の「phase と execution_logs.action_type の対応」に従う。`plan` / `execute` / `review` のいずれか、またはフェーズ名（`00_要求定義` / `01_要件定義` / `02_設計` / `03_実装計画` / `04_review` 等）をそのまま使う。メインと書記で同じ規則を用い、ブレを出さない。

---

## 5. 暫定記録（書記未使用時）のフォーマット（固定）

書記サブを使わない場合、メインは **次の形式のみ** で memo に記録する。他の書き方（表のみ・箇条書きのみ・キー省略）は禁止する。

- **ファイル**: `.workflow/{issue}/memo/YYYYMMDD_HHMMSS_実行ログ.md`（日時はシステム取得・JST。プレフィックス必須）。**同一 issue では、既存の `YYYYMMDD_HHMMSS_実行ログ.md` が存在する場合はそのファイルに追記する。新規作成は同一 issue で初回のみとする。**
- **1 件ごと**: §2 の必須キー（issue_id, timestamp, created_at, agent_id, action_type, target_artifact, summary）を **YAML ブロック** で 1 件ずつ書く。
- **区切り**: エントリとエントリの間は `---` のみの行で区切る。
- **順序**: 新しい件をファイル末尾に追記する。

例（1 件目と 2 件目）:

```yaml
issue_id: "20260306_120000_my_issue"
timestamp: "2026-03-06T12:00:00+09:00"
created_at: "2026-03-06T12:05:00+09:00"
agent_id: "要件BDDリード"
action_type: "plan"
target_artifact: "01_要件定義.md"
summary: "01 要件定義を完了。BDD Feature 3 本追加。"
---
issue_id: "20260306_120000_my_issue"
timestamp: "2026-03-06T12:10:00+09:00"
created_at: "2026-03-06T12:11:00+09:00"
agent_id: "実装者"
action_type: "execute"
target_artifact: "02_設計.md"
summary: "02 設計を完了。影響範囲とテスト戦略を記載。"
```

---

## 6. 参照

- 委譲入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)（§2 のペイロード形式で渡す）
- スキーマ: [ワークフローログ_SQLiteスキーマ](../ledger/ワークフローログ_SQLiteスキーマ.md)
- 誰が何を書けるか: [capabilities/POLICY](../capabilities/POLICY.md)
