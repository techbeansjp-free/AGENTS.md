# SCRIBE CONTRACT - 書記契約

書記は「**ログのみ**」を書く。ログは **1 回の呼び出しで 1 件のみ**。

---

## ログ保存先（固定）

- `.workflow/**/logs/`

---

## ログファイル名（固定）

- `YYYYMMDD_HHMMSS_{agent_id}_{action_type}.md`

---

## フロントマター（固定）

書記が書くログの先頭には、次の YAML を必ず含める。

```yaml
issue_id: "<task_id>"
agent_id: "implementer | reviewer | tester | auditor | scribe"
action_type: "plan | execute | review"
timestamp: "ISO8601"
target_artifact: "<path or logical name>"
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
