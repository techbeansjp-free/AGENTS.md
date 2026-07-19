#!/usr/bin/env bash
# resolve-wf-db.sh — workflow.db パス解決の共有ヘルパ（read/write 経路で単一正本）
#
# 目的:
#   git worktree で並行委譲した際、書記（write-workflow-log.sh）が worktree ローカルの
#   .agent-skill-chain/runtime/workflow.db へ書いてしまい、main ツリーの canonical DB に
#   反映されない問題（Issue #132・ADR-132-1）を解消する。書記・監査（audit.sh）双方が
#   本ヘルパを source して同一の解決規則を用いることで、read/write が単一 canonical DB を指す。
#
# 提供する関数:
#   resolve_wf_db_path <hint> [workflow_dir]
#     - <hint>: 呼び出し側が抽出した PROJECT_ROOT ヒント。
#         write-workflow-log.sh は環境変数 PROJECT_ROOT を、audit.sh は位置引数 $1 を渡す。
#         呼び出し規約（env / 位置引数）の差は「hint を引数で受ける」ことで吸収する。
#     - [workflow_dir]: 既定 .agent-skill-chain/runtime。呼び出し側の WORKFLOW_DIR を渡す。
#     - 標準出力: 解決した workflow.db の絶対または相対パス（パスのみを返す。副作用なし）。
#
# 解決規則（ADR-132-1）:
#   1. hint が非空かつ "." 以外なら、その値をそのまま PROJECT_ROOT として採用（後方互換・明示上書き尊重）。
#   2. それ以外（未指定 or "."）の場合、git rev-parse --path-format=absolute --git-common-dir を試行。
#      成功し、かつ dirname で得た main root 直下に .agent-skill-chain/ ディレクトリが実在する場合のみ
#      その main root を採用（sentinel ガード）。
#   3. 上記いずれも不成立（git 失敗・sentinel 非該当・旧 git で --path-format 非対応 等）なら、
#      従来の "."（CWD 基準）へ fail-safe フォールバックする。
#
# 設計上の注意:
#   - 本ファイルは source 専用（関数定義のみ）。exit / set -e を持たず、呼び出し元の実行を止めない。
#   - sentinel ガードにより、consumer モノレポ（.agent-skill-chain/ が git サブディレクトリ配下）や
#     bare/非標準 GIT_DIR で main root を誤検出しても、そこに .agent-skill-chain/ が無ければ
#     フォールバックするため、誤った別 DB を新規作成しない（回帰防止・SC-4）。

# workflow.db パスのみを解決して標準出力へ返す。
resolve_wf_db_path() {
  local hint="${1:-}"
  local workflow_dir="${2:-.agent-skill-chain/runtime}"

  # 1. 明示ヒント（非空かつ "." 以外）を最優先で尊重（後方互換）。
  if [[ -n "$hint" && "$hint" != "." ]]; then
    printf '%s/%s/workflow.db\n' "$hint" "$workflow_dir"
    return 0
  fi

  # 2. git main root 解決（sentinel ガード付き）。
  #    set -e 下でも command 置換の失敗で中断しないよう if 条件で捕捉する。
  local common_dir main_root
  if common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
     && [[ -n "$common_dir" ]]; then
    main_root="$(dirname "$common_dir")"
    if [[ -n "$main_root" && -d "$main_root/.agent-skill-chain" ]]; then
      printf '%s/%s/workflow.db\n' "$main_root" "$workflow_dir"
      return 0
    fi
  fi

  # 3. fail-safe フォールバック（従来の CWD 基準）。
  printf '%s/%s/workflow.db\n' "." "$workflow_dir"
  return 0
}
