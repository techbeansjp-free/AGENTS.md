# capability: write-workflow-log

**目的**: 実施内容・変更ファイル・完了判定を規約に従って **workflow.db にのみ**記録する。**ログは書記に任せる**。本 capability のみが記録する。**記録先は workflow.db（SQLite）のみ**。無ければ作成する（scribe/CONTRACT・ledger/schema 参照）。memo は CONTRACT の過渡的・例外運用（非推奨）としてのみ存在し、本 capability の正規経路は workflow.db のみとする。

---

## 手順

1. 入力（実施内容・変更ファイル一覧・完了判定。必要なら決定事項）を読む。
2. **記録先は workflow.db（SQLite）のみ**。**.agents/scripts/write-workflow-log.sh を必ず使用する**。sqlite3 直接実行禁止。ledger/README.md の配置に従う。
3. 記録する内容：実施日時・実施者（または役割）・実施内容の要約・変更ファイル・完了条件の充足有無。
4. scribe/README.md・ledger/README.md の形式に従う。

---

## 制約・禁止

- 証跡を省略しない。CORE の「証跡を省略してはならない」を守る。
- **記録先は workflow.db のみ**。memo は CONTRACT §どこに保存するか の過渡的・例外時のみ（本 capability の正規経路ではない）。
- **ログは書記のみ**が書き込む。書記以外の workflow.db への書き込みは禁止。enforcement で矯正する（CORE）。

---

## 成果物の形式

- **OUT**: **workflow.db への 1 行以上の記録**（CONTRACT 準拠。実施内容・変更・完了判定が分かる形）。memo は過渡的・例外時のみ（CONTRACT 参照）。

---

## 参照

- CORE（証跡省略禁止）
- scribe/README.md、ledger/README.md
- skills/agent/run_command.md（Constraints）。scribe/CONTRACT.md（保存先・必須キー）
