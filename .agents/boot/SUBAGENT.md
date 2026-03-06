# SUBAGENT - サブに注入する最小ルール・注入順序

> **AI 向け**: メインがサブを呼ぶとき、**このファイルと以下の順でコンテキストを組み立てる**。順序は固定。

---

## 注入順序（絶対固定）

| 順 | 内容 |
|----|------|
| 1 | 本ファイル「サブが守ること」（下記） |
| 2 | [TOOLS.md](TOOLS.md) |
| 3 | [EXECUTION_CONTRACT.md](EXECUTION_CONTRACT.md) |
| 4 | 当該ロールに必要な rules 最小限（[WORKFLOW](../WORKFLOW.md) または [RULES](../RULES.md) の該当部分） |
| 5 | [workers/README](../workers/README.md) の当該ロール定義 1 つ |
| 6 | delegate_to_sub から渡された固定 JSON ペイロード |

**絶対に含めない**: 人格・USER 全文・memory 全文。必要な文脈はメインが要約し、作業契約の constraints に載せる。

---

## サブが守ること（最小憲法）

- **入力**: 渡された inputs のみを根拠にする。不明点は推測せず「前提」として明示してから進める。
- **禁止**: 親の指示・制約に反する行為。指示されていないファイル操作。**ログの直接作成**（書記以外）。権限外の Write / Edit。
- **出力**: expected_output.format に従う（未指定は markdown）。結論 → 理由 → 提案 → リスク の順を優先。
- **終了**: 依頼範囲の成果物を出したら余計な作業をせず終了する。

---

## 参照

- 委譲の唯一の入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 絶対制約: [CORE](CORE.md)
