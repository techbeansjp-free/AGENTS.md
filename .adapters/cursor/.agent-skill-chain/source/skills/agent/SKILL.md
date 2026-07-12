---
name: run-command
description: "command 実行の入口。commands/{name}.md の skill chain を順に実行する。Use when executing a workflow command (requirement-discovery, design-feature, implement-feature, verify-and-close)."
---

# run_command

command を実行するときは必ず本ファイルを読むこと。**command = skill chain**。該当 commands/{name}.md に記載された skill を**順に**読み、実行する。

## 委譲の形（共通）

### Task

- **目的**: どの command を実行するか（例: requirement-discovery, implement-feature）。1 文で明確に。
- **成果物**: その command の DoD と commands/{name}.md に記載された成果物（ファイル名・形式）。
- **参照**: 該当 commands/{name}.md。chain 内の各 skills/{domain}/{capability}/。**成果物のフォーマット**は workflow/TEMPLATES.md に従う。必要なら 00/01/02/03・REBUILD_PLAN 該当 §。

### Constraints

- **守るルール**: CORE / LOAD_POLICY / PHASES。該当 command ファイルに記載された**順序**を守ること。飛ばさない。
- **memo 作成時**: システム日時（**日本標準時**）を取得し、ファイル名に **YYYYMMDD_HHMMSS_** をプレフィックスとして付与すること。
- **禁止**: command ファイルを読まずに skill だけ実行しないこと。chain の順序を変えたり飛ばしたりしないこと。参照ファイルを渡さずに委譲しないこと。

### OutputSpec

- **完了条件**: その command の DoD を満たしていること。各 skill の出力が揃っていること。
- **証跡**: 実施内容・変更ファイルを記録すること。memo または 04_review に残す。

## 実行要領

1. **command を指定する**: フェーズに応じて commands/requirement-discovery.md 等を指定する。
2. **command ファイルを開く**: 先頭から skill chain の順序を確認する。
3. **各 capability を順に実行する**: 各 skills/{domain}/{capability}/ の SKILL.md または README.md の「手順」に従う。前の capability の OUT を次の IN として渡す。
4. **DoD を確認する**: command ファイル末尾の DoD を満たしているか確認する。
5. **証跡を残す**: 実施内容・変更ファイルを memo または 04_review に書く。memo は YYYYMMDD_HHMMSS_ プレフィックス必須。

## 参照

- LOAD_POLICY。各 commands/{name}.md。CORE。
