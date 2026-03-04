# SCRIBE CONTRACT - 書記契約

書記は「**ログのみ**」を書く。ログは **1 回の呼び出しで 1 件のみ**。

---

## ログ保存先（固定）

- **workflow.db（SQLite）のみ**。`.workflow/**/logs/` は廃止・使用禁止。

---

## フロントマター（固定・SQLite の execution_logs に対応）

書記が書くログの先頭には、次の YAML を必ず含める。

```yaml
issue_id: "<task_id>"
agent_id: "implementer | reviewer | tester | auditor | scribe"
action_type: "plan | execute | review"（推奨: フェーズ名を含める。例: 01_要件定義, 02_設計, 03_実装計画, 04_review）
timestamp: "ISO8601"
target_artifact: "<path or logical name>"（監査用トレーサビリティのため推奨。主な成果物のパスまたは論理名）
input_ref: "<optional>"
output_ref: "<optional>"
summary: "<3 lines max>"
```

必須キー: **issue_id**, **agent_id**, **action_type**, **timestamp**, **target_artifact**, **summary**。CI で検証する。

---

## 本文（任意）

- 詳細メモが必要な場合のみ記述する。
- 推測は禁止。観測した事実と決定事項のみ。

---

## 参照

- 委譲入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 誰が何を書けるか: [capabilities/POLICY](../capabilities/POLICY.md)
