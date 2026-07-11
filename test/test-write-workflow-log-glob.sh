#!/usr/bin/env bash
# test-write-workflow-log-glob.sh — to_json_array の glob 展開是正（LOW）回帰テスト。
#
# ユースケース（このテストファイル全体）:
#   write-workflow-log.sh の changed_files → JSON 配列変換（to_json_array）は、unquoted 展開で単語分割する。
#   noglob を適用していないと、changed_files に含まれる glob メタ文字（* ? [...]）が、cwd の実ファイル名へ
#   展開されてしまう。本テストは「changed_files に * / ? / [..] を含めても実ファイル展開されず、文字どおり
#   記録される」ことと、「通常のカンマ/改行区切りの分割・hash 計算の後方互換が壊れない」ことを保証する。
#
# 方針（破壊禁止・tmp 隔離 必須・.agent-skill-chain/project/自己拡張ワークフロー.md §テストの tmp 隔離）:
#   - 全シナリオを mktemp -d の一時 DB／クリーン環境で実行する。PROJECT_ROOT を tmp に向け、本リポの
#     .agent-skill-chain/runtime/workflow.db を一切読み書き・変更しない。write-workflow-log.sh は read のみ（呼び出すのみ・無改造）。
#   - cwd を「glob 展開すると実ファイルにマッチする」ディレクトリへ移して実行し、展開の有無を検証する。
#   - 各テストは TEST_BDD_FORMAT に従い `# シナリオ:` と `# Given:` `# When:` `# Then:` を本文に書く。
#
# 使い方:
#   bash test/test-write-workflow-log-glob.sh   # リポジトリルートで実行
#
# 前提: bash・sqlite3。
# 参照:
#   .agent-skill-chain/source/scripts/write-workflow-log.sh（to_json_array・noglob 適用）
#   .agent-skill-chain/source/TEST_BDD_FORMAT.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
WWL="$REPO_ROOT/.agent-skill-chain/source/scripts/write-workflow-log.sh"
SCHEMA="$REPO_ROOT/.agent-skill-chain/source/ledger/schema.sql"

PASS=0
FAIL=0
FAILED_NAMES=()
ok() { PASS=$((PASS+1)); echo "  [PASS] $1"; }
ng() { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); echo "  [FAIL] $1"; }
assert_eq() { [[ "$1" == "$2" ]] && ok "${3:-一致: $1}" || ng "${3:-不一致: 期待 '$1' 実際 '$2'}"; }

command -v sqlite3 >/dev/null 2>&1 || { echo "エラー: sqlite3 が必要です" >&2; exit 2; }
[[ -f "$WWL" && -f "$SCHEMA" ]] || { echo "エラー: 対象スクリプト/スキーマが見つかりません" >&2; exit 2; }

TMP_DIRS=()
cleanup() { for d in "${TMP_DIRS[@]:-}"; do [[ -n "$d" && -d "$d" ]] && rm -rf "$d"; done; }
trap cleanup EXIT
mk() { local d; d="$(mktemp -d)"; TMP_DIRS+=("$d"); printf '%s\n' "$d"; }

DOCID="2b993149-0000-4000-8000-000000000001"

# 記録ヘルパ: cwd を decoy ディレクトリに向け、PROJECT_ROOT を tmp DB に向けて implement-feature を記録。
#   changed_files（第6位置引数）を文字どおり渡す。最後に記録 JSON を返す（read）。
record_changed() {
  local cwd="$1" root="$2" changed="$3"
  ( cd "$cwd" && PROJECT_ROOT="$root" AGENT_ROLE=scribe DOCUMENT_ID="$DOCID" \
      "$WWL" implement-feature "glob regression check" 1 "2026-06-16T10:00:00Z" "" "$changed" >/dev/null 2>&1 )
  sqlite3 "$root/.agent-skill-chain/runtime/workflow.db" "SELECT changed_files_json FROM workflow_log ORDER BY rowid DESC LIMIT 1;" 2>/dev/null
}

echo "== to_json_array glob 是正（LOW） =="

# シナリオ1: changed_files の "*" は実ファイルへ展開されず文字どおり記録される
# Given: cwd に decoy ファイル（a.md b.md）があり、changed_files に "*.md" を含める
# When:  write-workflow-log.sh を呼ぶ
# Then:  changed_files_json に "*.md" が文字どおり入り、a.md / b.md へ展開されない
t1() {
  local cwd root json
  cwd="$(mk)"; root="$(mk)"
  : > "$cwd/a.md"; : > "$cwd/b.md"; : > "$cwd/c.md"
  json="$(record_changed "$cwd" "$root" '*.md')"
  if [[ "$json" == *'*.md'* ]] && [[ "$json" != *'a.md'* ]]; then
    ok "アスタリスク(*.md)は文字どおり記録（実ファイル未展開）"
  else
    ng "アスタリスクが実ファイルへ展開された: $json"
  fi
}

# シナリオ2: "?" / "[..]" も展開されず文字どおり記録される
# Given: cwd に x1.md（? や [0-9] にマッチしうる名前）があり、changed_files に "x?.md,[a-z].txt" を含める
# When:  記録する
# Then:  changed_files_json に "x?.md" と "[a-z].txt" が文字どおり残る（x1.md へ展開しない）
t2() {
  local cwd root json
  cwd="$(mk)"; root="$(mk)"
  : > "$cwd/x1.md"; : > "$cwd/q.txt"
  json="$(record_changed "$cwd" "$root" 'x?.md,[a-z].txt')"
  if [[ "$json" == *'x?.md'* ]] && [[ "$json" == *'[a-z].txt'* ]] && [[ "$json" != *'x1.md'* ]]; then
    ok "? と [..] は文字どおり記録（実ファイル未展開）"
  else
    ng "? / [..] が実ファイルへ展開された: $json"
  fi
}

# シナリオ3: 通常のカンマ区切り分割は後方互換どおり 2 要素に分かれる（非破壊）
# Given: glob を含まない通常の changed_files "src/a.ts,src/b.ts"
# When:  記録する
# Then:  JSON 配列が ["src/a.ts","src/b.ts"]（従来どおりの分割）
t3() {
  local cwd root json
  cwd="$(mk)"; root="$(mk)"
  json="$(record_changed "$cwd" "$root" 'src/a.ts,src/b.ts')"
  assert_eq '["src/a.ts","src/b.ts"]' "$json" "通常カンマ区切りの分割は後方互換（非破壊）"
}

t1
t2
t3

echo
echo "== 結果: PASS=$PASS FAIL=$FAIL =="
if [[ $FAIL -gt 0 ]]; then
  printf '  失敗: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
