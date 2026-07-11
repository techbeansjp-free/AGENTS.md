#!/usr/bin/env bash
# workflow-db-guard.sh — .agent-skill-chain/runtime/workflow.db の由来検知（軽量警告・単一正本）。
#
# 責務: 既存 workflow.db が本パッケージ由来の正規スキーマ（有効な sqlite3 ＋ workflow_log
#       テーブル保有）かを 1 クエリで軽量検査し、不一致なら 3 要素（対象パス・推定される問題・
#       確認手順）の警告を標準エラー出力へ表示する。setup.sh の init_workflow_db が既存ファイルを
#       スキップする直前に呼ぶ。
#
# 方針（.agent-skill-chain/ 本体の fail-closed とは対称的に異なる。軽量・非中止・非破壊）:
#   - 処理は中止しない（常に return 0）。
#   - 既存ファイルは一切変更しない（読取り検査のみ）。
#   - sqlite3 未導入・対象パス不在など検査不能な場合は沈黙して return 0 する。
#
# 参照:
#   docs/maintainer/workflow/20260711_015030_agentsOS汎用化_ポリシー統合/90_issues/
#     20260711_062125_workflowDB由来検知欠如是正/02_設計.md（ADR-1・ADR-2）
#   .agent-skill-chain/source/scripts/lib/package-manifest.sh（sourced lib の先例・同型）
#   .agent-skill-chain/source/ledger/schema.sql（workflow_log の正本スキーマ）

# warn_if_foreign_workflow_db <db_path>
#   既存 <db_path> が有効な sqlite3 データベースであり workflow_log テーブルを持つかを検査する。
#   不一致（sqlite3 として開けない、または workflow_log テーブルが存在しない）の場合、
#   3 要素（対象パス・推定される問題・確認手順）の警告を標準エラー出力へ表示する。
#   正規 DB の場合は沈黙する。いずれの場合も戻り値は常に 0（fail-closed は導入しない）。
warn_if_foreign_workflow_db() {
  local db="$1"

  # 対象パスが通常ファイルとして存在しない場合は防御的に何もしない（呼び出し元は
  # [[ -f "$db" ]] 確認後に呼ぶため通常起こらないが、単体呼び出し時の安全のため許容する）。
  [[ -f "$db" ]] || return 0

  # sqlite3 未導入の場合は検査不能のため沈黙で return 0
  # （write-workflow-log.sh の command -v sqlite3 ガード・agents-md.ts doctor の [SKIP] と一貫）。
  command -v sqlite3 >/dev/null 2>&1 || return 0

  # workflow_log テーブルの有無のみを見る（カラム構成は見ない）。これにより
  # write-workflow-log.sh の ADD COLUMN マイグレーションで救済される旧スキーマ差分を
  # 誤って「由来不明」と警告しない（false positive 回避・02_設計 ADR-1 帰結）。
  # sqlite3 呼び出しの失敗（非 DB ファイル等）は 2>/dev/null ＋ 代入で非致命化し、
  # set -e 下でも本関数・呼び出し元を異常終了させない。
  local cnt
  cnt="$(sqlite3 "$db" "SELECT count(*) FROM pragma_table_info('workflow_log');" 2>/dev/null)" || cnt=""

  if [[ -n "$cnt" && "$cnt" -ge 1 ]] 2>/dev/null; then
    # 正規 DB（workflow_log テーブルが存在する）: 沈黙して return 0。
    return 0
  fi

  # 不一致（非 sqlite3 ファイル、または workflow_log テーブル不在）: 3 要素警告を stderr へ出力する。
  {
    echo "警告: $db が本パッケージ由来の workflow.db として認識できません。"
    echo "  推定される問題: sqlite3 データベースとして開けない、または workflow_log テーブルを持ちません（本パッケージ由来でない可能性があります）。"
    echo "  確認手順: 由来不明であれば当該ファイルを退避または削除してから再実行してください。setup 処理はこのまま続行し、当該ファイルは変更していません。後続の書記（write-workflow-log）ステップで「file is not a database」等のエラーが出る場合、この由来不明ファイルが原因です。"
  } >&2

  return 0
}
