---
name: implement-change
description: "02_設計・03_実装計画に従って実装し、単体テスト観点を満たす成果物を出す。Use when implementing a feature or task from 03_実装計画."
---

# implement-change

**目的**: 02_設計・03_実装計画に従って実装し、単体テスト観点を満たす成果物を出す。

## 手順

1. 入力（02_設計、03_実装計画。該当 00/01。Task/Constraints/OutputSpec があれば読む）を読む。
2. 03 のタスク分解に従い、1 タスクずつ実装する。テストファーストを推奨（テスト観点を先に書く）。
3. 単体テスト（BDD シナリオに沿った観点）を満たすまで実装する。**新規・変更のテストは .agent-skill-chain/source/TEST_BDD_FORMAT.md に従い、`ユースケース:`・`シナリオ:` および Given / When / Then（必要時 And）を必ず書く。**
4. 証跡（どのファイルを変更したか）を記録する。memo を書く場合は YYYYMMDD_HHMMSS_ プレフィックスを付ける。
5. 成果物を 03 の DoD と照らして確認する。

## 制約・禁止

- 02・03 に書かれていない仕様を勝手に追加しない。YAGNI。必要なら 00/01 に戻って要求を足す。
- 証跡を省略しない。CORE の「証跡を省略してはならない」を守る。
- 委譲されている場合、Constraints で指定された参照ファイルを読んだうえで実装する。

## 成果物の形式

- **OUT**: コード・ファイル・ディレクトリ等の成果物。単体テスト観点を満たしていること。変更ファイル一覧または diff の要約を 04_review または memo に残す。

## 参照

- CORE、RULES。02_設計、03_実装計画。PHASES。skills/agent/run_command.md。workflow/TEMPLATES.md。
