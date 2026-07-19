---
name: write-workflow-log
description: "実施内容・変更ファイル・完了判定を規約に従って workflow.db に記録する。Use when recording evidence or closing verify-and-close."
---

# write-workflow-log

**目的**: 実施内容・変更ファイル・完了判定を規約に従って **workflow.db にのみ**記録する。**ログは書記に任せる**。本 capability のみが記録する。**記録先は workflow.db（SQLite）のみ**。無ければ作成する（scribe/CONTRACT・ledger/schema 参照）。memo は CONTRACT で定める過渡的・例外運用（非推奨）としてのみ存在し、本スキルは workflow.db を正とする。

## 手順

1. 入力（実施内容・変更ファイル一覧・完了判定。必要なら決定事項）を読む。
2. **記録先は workflow.db（SQLite）のみ**。workflow.db への 1 行の記録は、**必ず .agent-skill-chain/source/scripts/write-workflow-log.sh** を呼び出すこと。**sqlite3 を直接実行してはならない。** ラッパー内で DB 作成・PRAGMA・INSERT を行う。**証跡の因果関係（順序監査）** を満たすため、環境変数 **PARENT_ENTRY_ID**（親ログの entry_id）、**REVIEW_PATH**（verify-and-close 時は 04_review.md のパス）、**CHANGED_FILES_JSON**（implement-feature 時は**必須**。変更ファイルの JSON 配列。CONTRACT・ledger/schema 準拠）を渡すこと。成果ドキュメント（00/01/02/03/04）に対応するログでは **DOCUMENT_ID**（UUID。任意・推奨）と **DOCUMENT_PATH**（成果物のプロジェクトルート相対パス。例 `.agent-skill-chain/runtime/<issue>/00_要求定義.md`。`./`・絶対パスにしない）を渡すこと。ACTOR_ROLE=scribe, DELEGATED_BY_ROLE=orchestrator はラッパーがデフォルトで設定する。
   - **モデルティア記録の受け渡し契約**: 委譲元（orchestrator）が委譲パケットに選定ティア・根拠を明記していた場合（[skills/agent/run_command.md §Constraints「委譲時のティア明記」](../../agent/run_command.md)）、書記はその値を **MODEL_TIER**（選定ティア。例 `opus`）・**TIER_RATIONALE**（対応表該当行の引用 1 行）・**TIER_EXCEPTION**（`MODEL_TIER=fable` のときのみ・ユーザー最重要指定の記録）として `write-workflow-log.sh` に渡すこと。3 つとも任意 env（未指定時は `NULL` で記録され、非 tier ランタイムの既存呼び出しを破壊しない）。値の妥当性（対応表との整合・fable 例外の内容）は本スキルでは検証しない（判定は `audit.sh` の記録有無検査に集約）。
   - **複数成果物は全件・成果物ごとに 1 回ずつ記録する（取りこぼし禁止）**: **1 つの command が複数の成果ドキュメント（例: requirement-discovery の 00 と 01、design-feature の 02 と 03）を生成・更新した場合、書記はそれらを「まとめて 1 回」ではなく、生成・更新した全成果物のそれぞれについて DOCUMENT_ID（各成果物の UUID）・DOCUMENT_PATH（各成果物のルート相対パス）を渡して `write-workflow-log.sh` を 1 回ずつ呼ぶ**こと（成果物が n 件なら n 回呼ぶ）。PREV_HASH は指定しない（各回が直前 head の entry_hash に自動連結される）。1 件でも記録漏れがあると audit#20（document_id 紐付け）で FAIL する。**「1 command につき書記 1 回」という単数解釈をしてはならない。**
   - **DOCUMENT_PATH はランタイム共通でルート相対に統一**: 消費者ランタイム（`.agent-skill-chain/runtime/<issue>/...`）でも自己拡張ランタイム（`docs/maintainer/workflow/<issue>/...`）でも、配置パスをそのままプロジェクトルート相対で渡す。配置プレフィックスに依存する分岐は設けない（audit#20/#20+ の document_path 突合と整合させるため）。
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
