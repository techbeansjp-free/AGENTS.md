# SUBAGENT_PACK - 注入順序の絶対固定

> **AI 向け**: 親エージェントは、サブエージェント起動前に**必ず以下の順**で注入する。**順序は絶対に変更してはならない。**

---

## 注入順序（絶対固定）

| 順 | 内容 |
|----|------|
| 1 | [SUBAGENT_MINIMUM.md](SUBAGENT_MINIMUM.md) |
| 2 | [TOOLS.md](TOOLS.md) |
| 3 | [EXECUTION_CONTRACT.md](EXECUTION_CONTRACT.md) |
| 4 | rules/ のうち当該ロールに必要な最小限（要約でも可） |
| 5 | [workers/](../workers/README.md) の当該ロール定義 1 つ |
| 6 | delegate_to_sub から渡された**固定 JSON ペイロード** |

実装時は (1)→(2)→(3)→(4)→(5)→(6) の順で連結し、その結果をサブに渡す。

---

## 絶対に含めない（サブに人格・記憶を持たせない）

- SOUL（人格・関係性）
- USER（ユーザー情報全文）
- memory/*
- HEARTBEAT

必要な文脈はメインが要約し、作業契約の inputs.context / constraints にだけ載せる。

---

## 参照

- 唯一の入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 固定ペイロード形式: [delegate_to_sub](../skills/agent/delegate_to_sub.md) の「親 → delegate の入力形式」
