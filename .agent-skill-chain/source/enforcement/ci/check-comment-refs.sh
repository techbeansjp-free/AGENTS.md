#!/usr/bin/env bash
# check-comment-refs.sh — コメント外部参照禁止規約の検出ロジック（単一正本）
#
# 与えられたパス配下のコード/CI ファイルのコメント/docstring 行から、外部ドキュメント名・
# 章節番号・追跡番号（PR/issue/タスク番号）の直書きを検出し、違反箇所を列挙して非 0 で終了する。
# 検出ロジックはこのスクリプト 1 本に集約し、監査（audit.sh）と自己強制 CI（self-enforce.yml）の
# 両方がこのスクリプトを別の対象に対して呼ぶ（ロジックを二重化しない）。
#
# 使い方:
#   check-comment-refs.sh <path>...      # path はディレクトリまたはファイル（1 個以上必須）
#
# 走査対象:
#   - ディレクトリを渡した場合、拡張子 sh py js ts go rb rs java yml yaml のファイルを再帰列挙する。
#   - ファイルを渡した場合はそのファイルを対象にする。
#   - 実在しない path は警告して読み飛ばす。
#
# コメント抽出:
#   - 行頭/行中の // # ;; -- 、または行中の /* * """ を含む行をコメントとして扱う。
#   - import / require / include / from / using で始まる行は除外する（ファイルパスは許可されるため）。
#
# 禁止パターン（LC_ALL=C バイト照合）:
#   - 章節番号（節/章/条・section 表記。全角数字は列挙で表す）
#   - 追跡番号（PR/Issue/チケット/タスク + 数字、裸の #NN 2 桁以上）
#   - ドキュメント名（非空白文字が続く .md / .adoc）
#   - 作業用 issue フォルダへのパス参照（.agent-skill-chain/runtime/{issue}/ または docs/maintainer/workflow/{issue}/。
#     issue フォルダ名の日時プレフィックス YYYYMMDD_ を含むパスに限定。close/ 配下・日時プレフィックスの無い
#     汎用ディレクトリ言及は対象外。CODE_COMMENT_RULES.md §2・DOCS_NOISE_RULES.md (iv-b) と対称）
#
# 出力: 違反を <file>:<line> 形式で標準出力へ列挙する。
# 終了コード: 0=違反なし（走査対象 0 件を含む）／1=違反 1 件以上／2=引数なし等の使用方法エラー。

set -uo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: check-comment-refs.sh <path>..." >&2
  exit 2
fi

# 全角数字は [0-9０-９] のような範囲指定だと一部 locale で "Invalid collation character" に
# なるため、全角数字は列挙（各バイト列を | で並べる）で表し、grep は LC_ALL=C（バイト一致）で実行する。
fw='[0-9]|０|１|２|３|４|５|６|７|８|９'
pat_section="(§(${fw})|第(${fw})+[節章条]|(セクション|[Ss]ection)[[:space:]]*[0-9])"
pat_ticket='((PR|Issue|ISSUE|issue|チケット|task|タスク)[[:space:]]*#?[0-9]|#[0-9][0-9]+)'
# ドキュメント名: 直前が非空白バイトなら CJK 文字で終わる名前も検出する（全角名対応）。
# 拡張子は語末境界（非英数字または行末）を要求し、.mdc 等の別拡張子を .md と誤認しない。
pat_docname='[^[:space:]]+\.(md|adoc)([^[:alnum:]]|$)'
# 作業用 issue フォルダへのパス参照: issue フォルダ名の日時プレフィックス（YYYYMMDD_）を要求することで、
# 汎用ディレクトリ言及（.agent-skill-chain/runtime/workflow.db 等）を誤検知しない。close/ 配下は
# runtime/ または workflow/ の直後が "close"（非数字）のため構造的に一致せず対象外（audit.sh #37 と同一パターン）。
pat_issuefolder='(\.agent-skill-chain/runtime|docs/maintainer/workflow)/[0-9]{8}_'

found=""

scan_file() {
  local f="$1"
  local hits
  # 行番号付きで「コメント行」のみ抽出する。
  hits="$(awk '
    {
      line=$0
      cmt=""
      if (match(line, /(\/\/|#|;;|--)/)) {
        tline=line; sub(/^[[:space:]]+/, "", tline)
        if (tline ~ /^(import|from|require|include|#include|using)/) next
        cmt=substr(line, RSTART)
      } else if (line ~ /\/\*|^[[:space:]]*\*|"""/) {
        cmt=line
      } else next
      print NR "\t" cmt
    }
  ' "$f" 2>/dev/null)"
  [[ -z "$hits" ]] && return 0
  local line_no cmt_text
  while IFS=$'\t' read -r line_no cmt_text; do
    [[ -z "$line_no" ]] && continue
    if printf '%s' "$cmt_text" | LC_ALL=C grep -qE "$pat_section" 2>/dev/null \
      || printf '%s' "$cmt_text" | LC_ALL=C grep -qE "$pat_ticket" 2>/dev/null \
      || printf '%s' "$cmt_text" | LC_ALL=C grep -qE "$pat_docname" 2>/dev/null \
      || printf '%s' "$cmt_text" | LC_ALL=C grep -qE "$pat_issuefolder" 2>/dev/null; then
      echo "${f}:${line_no}"
      found=1
    fi
  done <<< "$hits"
}

for p in "$@"; do
  if [[ -d "$p" ]]; then
    while IFS= read -r -d '' f; do
      scan_file "$f"
    done < <(find "$p" -type f \( -name "*.sh" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.go" -o -name "*.rb" -o -name "*.rs" -o -name "*.java" -o -name "*.yml" -o -name "*.yaml" \) -print0 2>/dev/null || true)
  elif [[ -f "$p" ]]; then
    scan_file "$p"
  else
    echo "WARN: パスが存在しないため読み飛ばします: $p" >&2
  fi
done

if [[ -n "$found" ]]; then
  exit 1
fi
exit 0
