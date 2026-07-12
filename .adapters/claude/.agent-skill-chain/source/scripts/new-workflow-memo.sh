#!/usr/bin/env bash
# new-workflow-memo.sh — .agent-skill-chain/runtime/{issue}/memo/ の単一作成経路
# 目的:
# - memo ファイル名の YYYYMMDD_HHMMSS_ プレフィックスを **必ず実行時のシステム時計から取得** する。
# - 呼び出し元が日時文字列を渡すことを**禁止**し、AI がプレフィックスを推測・手入力する経路を物理的に塞ぐ。
#
# 使い方:
#   .agent-skill-chain/source/scripts/new-workflow-memo.sh ISSUE_DIR "タイトル" > /dev/null  （パッケージルートからの相対）
#   例: .agent-skill-chain/source/scripts/new-workflow-memo.sh ".agent-skill-chain/runtime/YYYYMMDD_HHMMSS_example-issue-name" "検証メモ"
#
# 振る舞い:
# - TZ=Asia/Tokyo で `date +%Y%m%d_%H%M%S` を呼び出し、YYYYMMDD_HHMMSS_ を生成する。
# - .agent-skill-chain/runtime/{issue}/memo/ ディレクトリを作成（存在しなければ）。
# - `${TS}_${SANITIZED_TITLE}.md` というファイルを新規作成する（既存なら最大 5 秒まで 1 秒刻みで再試行）。
# - 作成したファイルパスを標準出力に 1 行だけ出す。
#
# 禁止事項:
# - 本スクリプトにタイムスタンプ文字列（YYYYMMDD_HHMMSS 等）を引数として渡してはならない。
# - .agent-skill-chain/runtime/**/memo/ 以下のファイルを、Write/Edit で直接手入力のプレフィックス付きファイル名として作成してはならない。

set -euo pipefail

if [[ "${TZ:-}" == "" ]]; then
  # 日本標準時での一意な日時付与を強制する
  export TZ="Asia/Tokyo"
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 ISSUE_DIR [TITLE]" >&2
  echo "ISSUE_DIR example: .agent-skill-chain/runtime/YYYYMMDD_HHMMSS_example-issue-name" >&2
  exit 1
fi

ISSUE_DIR="$1"
TITLE="${2:-memo}"

# プレフィックスに含めるのは実行時のシステム時計のみ。呼び出し元から日時を渡すことは禁止。
if [[ "$TITLE" =~ ^[0-9]{8}_[0-9]{6}_ ]]; then
  echo "ERROR: TITLE must not start with a timestamp prefix (YYYYMMDD_HHMMSS_). The timestamp is always computed from the system clock inside this script." >&2
  exit 1
fi

MEMO_DIR="${ISSUE_DIR%/}/memo"
mkdir -p "$MEMO_DIR"

# タイトルからファイル名に不適切な文字を除去・単純化
sanitize_title() {
  local raw="$1"
  # 改行・タブをスペースに
  raw="${raw//$'\n'/ }"
  raw="${raw//$'\t'/ }"
  # スラッシュやバックスラッシュなどをアンダースコアに
  raw="${raw//\//_}"
  raw="${raw//\\/ _}"
  # 先頭末尾の空白を削除
  raw="$(echo "$raw" | sed -e 's/^[[:space:]]\+//' -e 's/[[:space:]]\+$//')"
  # 空ならデフォルト名
  if [[ -z "$raw" ]]; then
    raw="memo"
  fi
  echo "$raw"
}

SANITIZED_TITLE="$(sanitize_title "$TITLE")"

create_memo_once() {
  local ts fname path
  ts="$(date +%Y%m%d_%H%M%S)"
  fname="${ts}_${SANITIZED_TITLE}.md"
  path="${MEMO_DIR}/${fname}"
  if [[ -e "$path" ]]; then
    return 1
  fi
  printf '# %s\n\n' "$TITLE" > "$path"
  printf '%s\n' "$path"
  return 0
}

# タイムスタンプ衝突を避けるため、最大 5 回まで 1 秒刻みで再試行
ATTEMPTS=0
MAX_ATTEMPTS=5
while (( ATTEMPTS < MAX_ATTEMPTS )); do
  if created_path="$(create_memo_once)"; then
    echo "$created_path"
    exit 0
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done

echo "ERROR: Failed to create unique memo file under ${MEMO_DIR} after ${MAX_ATTEMPTS} attempts." >&2
exit 1

