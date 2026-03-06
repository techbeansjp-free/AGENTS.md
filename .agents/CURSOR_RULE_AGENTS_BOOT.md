# Cursor 用ルール（強制力アップ用）

> このファイルの「ルール本文」をプロジェクトの **`.cursor/rules/`** にコピーすると、Cursor が常にこのルールをコンテキストに含めるため、**規約を読まずに作業を始めることを防ぎやすく**なります。

## 使い方

1. プロジェクトルートに `.cursor/rules/` を用意する（なければ作成）。
2. 下記「ルール本文」を `.cursor/rules/AGENTS-boot.mdc` などとして保存する（`.mdc` または `.md` で可）。
3. AGENTS-spec をサブフォルダで使う場合、プロジェクトルートの `.cursor/rules/` に置く。パスは `AGENTS-spec/.agents/` がある場合の相対パスで書いている。

## ルール本文（コピー用）

```markdown
---
description: AGENTS 規約に従うとき、必ず実行前契約を守る。未読のまま作業開始禁止。
alwaysApply: true
---

# AGENTS 実行前契約（強制）

このリポジトリに `AGENTS-spec` または `.agents/` が存在し、ユーザーが「agentsに従って」「AGENTS に従って」と言った場合、または .workflow/ 配下の issue を扱う場合:

1. **以下 4 ファイルを読了するまで**、ワークフロー開始・フェーズ進行・コード変更・委譲・成果物作成を**行わない**。
   - `AGENTS-spec/.agents/boot/CORE.md` または `.agents/boot/CORE.md`
   - `AGENTS-spec/.agents/boot/LOAD_POLICY.md` または `.agents/boot/LOAD_POLICY.md`
   - `AGENTS-spec/.agents/WORKFLOW.md` または `.agents/WORKFLOW.md`
   - `AGENTS-spec/.agents/CONCEPTS.md` または `.agents/CONCEPTS.md`

2. 読了したうえで着手する。着手時の応答冒頭で、「CORE/LOAD_POLICY/WORKFLOW/CONCEPTS に従い、…」と 1 行で短く確認する（ユーザーが「規約は読んだ前提で」と明示した場合は省略可）。

3. 未読のまま行ったアクションは規約上無効とする。
```

---

以上をプロジェクトの `.cursor/rules/` に置くことで、**思想・方法論・フォーマット・成果物** を AI に確実に認識させ、規約を守ったうえでだけ動作させやすくする。
