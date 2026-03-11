---
name: write-workflow-log
description: "実施内容・変更ファイル・完了判定を規約に従って workflow.db に記録する。Use when recording evidence or closing verify-and-close."
---

# write-workflow-log

**目的**: 実施内容・変更ファイル・完了判定を規約に従って **workflow.db にのみ**記録する。**ログは書記に任せる**。本 capability のみが記録する。**記録先は workflow.db（SQLite）のみ**。無ければ作成する（scribe/CONTRACT・ledger/schema 参照）。memo は CONTRACT で定める過渡的・例外運用（非推奨）としてのみ存在し、本スキルは workflow.db を正とする。

## 手順

1. 入力（実施内容・変更ファイル一覧・完了判定。必要なら決定事項）を読む。
2. **記録先は workflow.db（SQLite）のみ**。workflow.db への 1 行の記録は、**必ず .agents/scripts/write-workflow-log.sh** を呼び出すこと。**sqlite3 を直接実行してはならない。** ラッパー内で DB 作成・PRAGMA・INSERT を行う。**証跡の因果関係（順序監査）** を満たすため、環境変数 **PARENT_ENTRY_ID**（親ログの entry_id）、**REVIEW_PATH**（verify-and-close 時は 04_review.md のパス）、**CHANGED_FILES_JSON**（implement-feature 時は**必須**。変更ファイルの JSON 配列。CONTRACT・ledger/schema 準拠）を渡すこと。ACTOR_ROLE=scribe, DELEGATED_BY_ROLE=orchestrator はラッパーがデフォルトで設定する。
3. 記録する内容：実施日時・実施者（または役割）・実施内容の要約・変更ファイル・完了条件の充足有無。
4. scribe/README.md・ledger/README.md の形式に従う。

## 制約・禁止

- 証跡を省略しない。CORE の「証跡を省略してはならない」を守る。
- **記録先は workflow.db のみ**。memo 出力は CONTRACT の過渡的・例外時のみ（本スキルの正規経路ではない）。
- **ログは書記のみ**が書き込む。書記以外の workflow.db への書き込みは禁止。enforcement で矯正する（CORE）。

## 成果物の形式

- **OUT**: **workflow.db への 1 行以上の記録**（CONTRACT 準拠。実施内容・変更・完了判定が分かる形）。memo は過渡的・例外時のみ（CONTRACT §どこに保存するか 参照）。

## 参照

- CORE（証跡省略禁止）。scribe/README.md、ledger/README.md。skills/agent/run_command.md（Constraints: memo プレフィックス）。
