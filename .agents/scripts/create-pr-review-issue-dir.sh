#!/usr/bin/env bash
# create-pr-review-issue-dir.sh — PR 指摘対応 issue 用ディレクトリの決定・新規作成
#
# 使い方:
#   create-pr-review-issue-dir.sh <workspace_root> <parent_issue_id> [issue_dir_hint] <pr_url>
#   issue_dir_hint を省略または空の場合は pr_url と JST プレフィックスから新規ディレクトリ名を生成する。
#
# 出力（成功時）: 採用したディレクトリの絶対パスを 1 行で stdout に出力。
# エラー時:  stderr にメッセージを出力し、exit 1。エラー種別は echo "ERROR_*" で始まる行で示す。
#
# BDD 観点:
#   - issue_dir_hint=null かつ 90_issues/ のみ存在 → 新規 90_issues/{prefix}PR指摘対応/ を作成
#   - issue_dir_hint 指定かつ当該ディレクトリ存在 → そのディレクトリを採用（新規作成しない）

set -euo pipefail

usage() {
  echo "Usage: $0 <workspace_root> <parent_issue_id> [issue_dir_hint] <pr_url>" >&2
  echo "  issue_dir_hint: optional. If given, must exist under .workflow/<parent_issue_id>/90_issues/." >&2
  exit 1
}

if [[ $# -lt 3 ]]; then
  usage
fi

# WORKSPACE_ROOT を絶対パスに正規化
_raw_root="$1"
if command -v realpath &>/dev/null; then
  WORKSPACE_ROOT="$(realpath "$_raw_root")"
elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
  WORKSPACE_ROOT="$(readlink -f "$_raw_root")"
else
  WORKSPACE_ROOT="$(cd "$_raw_root" && pwd)"
fi

PARENT_ISSUE_ID="$2"
# issue_dir_hint が空でない 3 番目引数なら「既存指定」、なければ 3 番目が pr_url
if [[ $# -eq 3 ]]; then
  ISSUE_DIR_HINT=""
  PR_URL="$3"
else
  ISSUE_DIR_HINT="${3:-}"
  PR_URL="${4:-}"
fi

BASE_DIR="${WORKSPACE_ROOT}/.workflow/${PARENT_ISSUE_ID}/90_issues"
if [[ ! -d "${WORKSPACE_ROOT}/.workflow/${PARENT_ISSUE_ID}" ]]; then
  echo "ERROR_PARENT_NOT_FOUND: 親 issue ディレクトリが見つかりません: .workflow/${PARENT_ISSUE_ID}" >&2
  exit 1
fi

mkdir -p "$BASE_DIR"

if [[ -n "${ISSUE_DIR_HINT:-}" ]]; then
  # ISSUE_DIR_HINT サニタイズ: '/' または '..' を含む場合はエラー
  if [[ "$ISSUE_DIR_HINT" == *'..'* ]] || [[ "$ISSUE_DIR_HINT" == *'/'* ]]; then
    echo "ERROR_INVALID_HINT: issue_dir_hint に '/' または '..' を含むことはできません: ${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  if [[ ! "$ISSUE_DIR_HINT" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
    echo "ERROR_INVALID_HINT: issue_dir_hint は英数字・ハイフン・アンダースコアのみ使用できます: ${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  TARGET_DIR="${BASE_DIR}/${ISSUE_DIR_HINT}"
  if [[ ! -d "$TARGET_DIR" ]]; then
    echo "ERROR_DIR_NOT_FOUND: 指定されたディレクトリが見つかりません: 90_issues/${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  # 絶対パスに解決し BASE_DIR 配下であることを確認
  if command -v realpath &>/dev/null; then
    resolved="$(realpath "$TARGET_DIR")"
  elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
    resolved="$(readlink -f "$TARGET_DIR")"
  else
    resolved="$(cd "$TARGET_DIR" && pwd)"
  fi
  base_resolved="$(cd "$BASE_DIR" && pwd)"
  if [[ "$resolved" != "$base_resolved"* ]]; then
    echo "ERROR_INVALID_HINT: 解決後のパスが 90_issues 配下ではありません: ${resolved}" >&2
    exit 1
  fi
  echo "$resolved"
  exit 0
fi

# 新規作成: プレフィックス = JST 日時、PR 番号を pr_url から抽出
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "${SCRIPT_DIR}/memo-prefix.sh" ]]; then
  PREFIX="$("${SCRIPT_DIR}/memo-prefix.sh")"
else
  export TZ="${TZ:-Asia/Tokyo}"
  PREFIX="$(date +%Y%m%d_%H%M%S)"
fi

# pr_url から PR 番号を抽出（例: .../pull/4 → 4）
PR_NUM=""
if [[ "$PR_URL" =~ /pull/([0-9]+) ]]; then
  PR_NUM="${BASH_REMATCH[1]}"
fi
if [[ -z "$PR_NUM" ]]; then
  PR_NUM="unknown"
fi

DIR_NAME="${PREFIX}_PR${PR_NUM}_PR指摘対応"
TARGET_DIR="${BASE_DIR}/${DIR_NAME}"
mkdir -p "$TARGET_DIR"
# 出力は絶対パスで統一
if command -v realpath &>/dev/null; then
  echo "$(realpath "$TARGET_DIR")"
elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
  echo "$(readlink -f "$TARGET_DIR")"
else
  echo "$(cd "$TARGET_DIR" && pwd)"
fi
