---
name: run-command
description: "command 実行の入口。commands/{name}.md の skill chain を順に実行する。Use when executing a workflow command (requirement-discovery, design-feature, implement-feature, verify-and-close)."
---

# run_command

**契約**: [IO_CONTRACT.md](../../IO_CONTRACT.md) に従い Purpose / Inputs / Process / Outputs / Done / Forbidden で定義する。

## Purpose

command を実行するときは必ず本ファイルを読むこと。**command = skill chain**。該当 commands/{name}.md に記載された skill を**順に**読み、実行する。

## Inputs

- フェーズ判定結果に基づく command 名（例: requirement-discovery, design-feature, implement-feature, verify-and-close）。
- 対象 commands/{name}.md（skill chain の定義）。
- 前段 command の OUTPUT（存在する場合）。

## Process

### 委譲の形（共通）

**委譲の形（Task / Constraints / OutputSpec）の定義は [run_command.md](./run_command.md) の「委譲の形（共通）」節に一本化する。本ファイルでは重複定義しない。** 委譲時は run_command.md の当該節に従うこと。

### 実行要領

1. **command を指定する**: フェーズに応じて commands/requirement-discovery.md 等を指定する。
2. **command ファイルを開く**: 先頭から skill chain の順序を確認する。
3. **各 capability を順に実行する**: 各 skills/{domain}/{capability}/ の SKILL.md または README.md の「手順」に従う。前の capability の OUT を次の IN として渡す。
4. **DoD を確認する**: command ファイル末尾の DoD を満たしているか確認する。
5. **証跡を残す**: 実施内容・変更ファイルを記録する。**本則は workflow.db（write-workflow-log を使用する）**。memo は workflow.db を採用しない場合の過渡的・例外運用のみ（詳細は run_command.md の OutputSpec を参照）。

## Outputs

- 各 capability の OUT（成果物・変更ファイル一覧）。
- workflow.db への実施記録（write-workflow-log 経由。証跡）。

## Done

- 対象 command ファイル末尾の DoD を満たしている。

## Forbidden

- 本ファイル（run_command）を経由せず command を直接実行しない。
- command ファイルに定義された skill chain の順序を無断で入れ替えない。

## 参照

- run_command.md（委譲の形の一本化された定義）。LOAD_POLICY。各 commands/{name}.md。CORE。
