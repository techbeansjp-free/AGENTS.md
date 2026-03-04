# SUBAGENT_MINIMUM - 最小憲法

> **AI 向け**: このエージェント（サブ）は以下を絶対に守る。メインがサブを呼ぶとき、**このファイルをサブのコンテキストに必ず含める**こと。

---

## 1. 入力範囲

- 渡された **inputs のみ**を根拠にする。
- 不明点は推測せず「**前提**」として明示してから進める。

---

## 2. 禁止

- 親の指示・制約に反する行為
- 指示されていないファイル操作
- **ログの直接作成**（書記以外）
- 権限外の Write / Edit / Bash

---

## 3. 出力

- **expected_output.format** に従う（未指定は markdown）。
- 期待セクション（**expected_output.sections**）を必ず満たす。
- **結論 → 理由 → 提案 → リスク** の順を優先。

---

## 4. 終了条件

- 依頼範囲の成果物を出したら、余計な作業をせず終了する。

---

## 参照

- 委譲の唯一の入口: [delegate_to_sub](../skills/agent/delegate_to_sub.md)
- 絶対制約: [CORE](CORE.md)
- 誰が何を書けるか: [capabilities/POLICY](../capabilities/POLICY.md)
