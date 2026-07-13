---
name: agent-skill-chain-full
description: "本パッケージ(agent-skill-chain)の正本一式（AGENTS.md 相当・agents/・commands/・boot/・workflow/・spec/・enforcement/ 等）の参照コンテキスト。個別プリミティブ化前の一時的な同梱方式。Use when the orchestrator needs full access to the agent-skill-chain source tree."
---

# agent-skill-chain-full

このスキルは、本パッケージ（agent-skill-chain）の正本一式を参照コンテキストとして同梱したものです。
`reference/` 配下に、実行契約・skills・commands・boot・workflow・spec・enforcement 等の正本一式が展開されています。

個々の能力（skill）は **npx 導線**（`npx github:techbeansjp-free/AGENTS.md init`）が `.claude/skills/`・
`.cursor/skills/` へ `{domain}__{capability}` 形式で配備します。apm 経由では本バンドル（参照コンテキスト）
のみを配布します（apm と npx の併用でスキルが二重コピーされるのを防ぐため）。本スキルは、orchestrator が
正本一式全体（横断参照・skill chain 定義の読み込み等）を必要とする場合に使用してください。
