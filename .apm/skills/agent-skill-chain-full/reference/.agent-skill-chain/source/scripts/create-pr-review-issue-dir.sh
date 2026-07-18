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
  echo "  issue_dir_hint: optional. If given, must exist under .agent-skill-chain/runtime/<parent_issue_id>/90_issues/." >&2
  exit 1
}

if [[ $# -lt 3 ]]; then
  usage
fi

# 絶対パスに解決するヘルパー（realpath / readlink -f / cd+pwd の順で試す）
resolve_abs_path() {
  local p="${1:?}"
  if command -v realpath &>/dev/null; then
    realpath "$p"
  elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
    readlink -f "$p"
  else
    (cd "$p" && pwd)
  fi
}

WORKSPACE_ROOT="$(resolve_abs_path "$1")"
PARENT_ISSUE_ID="$2"

# PARENT_ISSUE_ID サニタイズ: '/' または '..' または英数字・ハイフン・アンダースコア以外は拒否
if [[ "$PARENT_ISSUE_ID" == *'/'* || "$PARENT_ISSUE_ID" == *'..'* || ! "$PARENT_ISSUE_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "ERROR_INVALID_PARENT_ISSUE_ID: parent_issue_id は英数字・ハイフン・アンダースコアのみ指定できます: ${PARENT_ISSUE_ID}" >&2
  exit 1
fi

# issue_dir_hint が空でない 3 番目引数なら「既存指定」、なければ 3 番目が pr_url
if [[ $# -eq 3 ]]; then
  ISSUE_DIR_HINT=""
  PR_URL="$3"
else
  ISSUE_DIR_HINT="${3:-}"
  PR_URL="${4:-}"
fi

PARENT_DIR="${WORKSPACE_ROOT}/.agent-skill-chain/runtime/${PARENT_ISSUE_ID}"
BASE_DIR="${PARENT_DIR}/90_issues"
parent_resolved="$(resolve_abs_path "$PARENT_DIR" 2>/dev/null)" || true
# 親ディレクトリが WORKSPACE_ROOT 配下であることを厳密に判定（trailing slash で /base と /base2 を区別）
workspace_prefix="${WORKSPACE_ROOT%/}/"
if [[ -z "$parent_resolved" || "${parent_resolved%/}/" != "${workspace_prefix}"* ]]; then
  echo "ERROR_PARENT_NOT_FOUND: 親 issue ディレクトリが見つかりません、またはワークスペース配外です: .agent-skill-chain/runtime/${PARENT_ISSUE_ID}" >&2
  exit 1
fi
if [[ ! -d "$parent_resolved" ]]; then
  echo "ERROR_PARENT_NOT_FOUND: 親 issue ディレクトリが見つかりません: .agent-skill-chain/runtime/${PARENT_ISSUE_ID}" >&2
  exit 1
fi

mkdir -p "$BASE_DIR"
base_resolved="$(resolve_abs_path "$BASE_DIR")"

if [[ -n "${ISSUE_DIR_HINT:-}" ]]; then
  # ISSUE_DIR_HINT サニタイズ: '/' または '..' を含む場合はエラー
  if [[ "$ISSUE_DIR_HINT" == *'..'* ]] || [[ "$ISSUE_DIR_HINT" == *'/'* ]]; then
    echo "ERROR_INVALID_HINT: issue_dir_hint に '/' または '..' を含むことはできません: ${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  # 隠し名前（先頭ドット）・制御文字は許可しない。非 ASCII（日本語ディレクトリ名等、自動生成
  # ディレクトリ名 ${PREFIX}_PR${PR_NUM}_PR指摘対応 を含む）は許可する（E-6）。
  # traversal は上の '/' '..' チェックで、解決後パスの base 配下判定は下記の resolved 検証で
  # 既に多重防御されているため、ASCII 限定の検証は不要かつ自スクリプト生成物を誤って拒否していた。
  if [[ "$ISSUE_DIR_HINT" == .* ]] || [[ "$ISSUE_DIR_HINT" == *[[:cntrl:]]* ]]; then
    echo "ERROR_INVALID_HINT: issue_dir_hint に先頭ドット・制御文字は使用できません: ${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  TARGET_DIR="${BASE_DIR}/${ISSUE_DIR_HINT}"
  if [[ ! -d "$TARGET_DIR" ]]; then
    echo "ERROR_DIR_NOT_FOUND: 指定されたディレクトリが見つかりません: 90_issues/${ISSUE_DIR_HINT}" >&2
    exit 1
  fi
  resolved="$(resolve_abs_path "$TARGET_DIR")"
  base_prefix="${base_resolved%/}/"
  if [[ "${resolved%/}/" != "$base_prefix"* ]]; then
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
  # E-12: memo 系プレフィックスは JST で一意採番する契約のため、呼び出し環境の TZ に依存させない
  # （既存 TZ を尊重すると環境ごとに時系列順序が崩れる）。無条件で JST を強制する。
  export TZ="Asia/Tokyo"
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
# E-17: BASE_DIR は既に mkdir -p 済みのため、新規作成は mkdir（-p なし）にして EEXIST を検知する。
# 同秒並行実行で 2 プロセスが同一ディレクトリ名を新規作成しようとした場合に、双方が黙って
# 成功して同一ディレクトリを共有する（成果物混線）のを防ぐため、衝突時は連番サフィックスで
# 別ディレクトリへ分離する。
n=1
while ! mkdir "$TARGET_DIR" 2>/dev/null; do
  n=$((n+1))
  if (( n > 50 )); then
    echo "ERROR_DIR_CREATE: ディレクトリ作成に失敗しました（衝突が解消しません）: ${DIR_NAME}" >&2
    exit 1
  fi
  TARGET_DIR="${BASE_DIR}/${DIR_NAME}_${n}"
done
echo "$(resolve_abs_path "$TARGET_DIR")"
