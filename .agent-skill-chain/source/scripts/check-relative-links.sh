#!/usr/bin/env bash
# check-relative-links.sh — Markdown 相対リンクの実在検査（read-only・検出のみ）。
#
# 目的:
#   指定スコープの Markdown ファイルから相対リンク（`](target)` 形式。外部 URL・同一ファイル内
#   アンカー・テンプレートプレースホルダを除く）を抽出し、リンク先が実在するかを機械判定する。
#   `--check-anchors`（既定 ON）指定時は、他ファイルへの `#anchor` 付きリンクについて、リンク先
#   ファイルの見出しを GitHub 準拠でスラッグ化した集合に anchor が実在するかも検査する。
#   本スクリプトは検出のみを行い、修正は行わない（read-only）。
#
# 使い方:
#   bash .agent-skill-chain/source/scripts/check-relative-links.sh [project_root] [scope_dir...] [--check-anchors|--no-check-anchors]
#     project_root        省略時は cwd（"." 相当）。
#     scope_dir...        省略時は既定スコープ（下記）。1 個以上指定した場合、project_root からの
#                         相対パスとして扱い、当該ディレクトリ配下の *.md を再帰走査する（既定を上書き）。
#     --check-anchors     既定 ON。`#anchor` 付きリンクのアンカー実在も検査する。
#     --no-check-anchors  アンカー検査を無効化する（ファイル実在のみ検査）。
#
# 既定スコープ（project_root からの相対。scope_dir を 1 個も指定しなかった場合のみ適用）:
#   - .agent-skill-chain/source/**/*.md（再帰）
#   - .agent-skill-chain/project/**/*.md（再帰）
#   - *.md（project_root 直下のみ・非再帰）
#   - docs/maintainer/*.md（直下のみ・非再帰。サブディレクトリの issue ドキュメント群は含めない）
#
# 除外（スコープ・scope_dir 明示指定にかかわらず常に除外）: パスの構成要素に以下を含むファイル
#   close/ .claude/ .cursor/ .adapters/ node_modules/ .git/
#
# 抽出ルール:
#   - fenced code block（```` ``` ```` または `~~~` で囲む範囲）を除外する。
#   - inline code（`` `...` ``）を除去してから抽出する（誤検出防止の要）。
#   - Markdown リンク `](target)` を抽出。target が以下のいずれかなら検査対象外:
#       空 / `http://` `https://` `mailto:` `tel:` で始まる（外部） /
#       `#` で始まる（同一ファイル内アンカー・本スクリプトの対象外） /
#       `{` `}` を含む（テンプレートプレースホルダ）
#   - target が `path "title"` 形式（タイトル付き）の場合、タイトル部分は無視する（ベストエフォート）。
#   - target が `/` で始まる場合は project_root 基準、それ以外は当該 Markdown ファイルのあるディレクトリ
#     基準で解決する（`realpath -m`。実体が無くてもパス正規化し、実在判定は別途 `-e` で行う）。
#
# アンカースラッグ化規則（GitHub 準拠の近似実装。.agent-skill-chain/project 配下の行番号相互参照是正
#   issue の設計で定めた規則と同一正本）:
#   1. 見出し行頭の `#`（1〜6 個）と前後空白を除去する。
#   2. ASCII 英字は小文字化する。
#   3. 空白は `-` に置換する。
#   4. 英数字・`-`・`_`・Unicode 文字（日本語等）以外の記号は除去する。
#   5. 日本語等の非 ASCII 文字はそのまま保持する（大小文字変換の対象外）。
#   6. 同一ファイル内で slug が重複する場合、GitHub と同様に 2 個目以降へ `-1` `-2` ... を付与する。
#
# 終了コード:
#   0: 切れ 0 件。
#   1: 切れ 1 件以上検出。
#   2: 実行前提エラー（project_root 不在、既定スコープ使用時に基準ディレクトリが 1 つも実在しない、
#      python3 が見つからない等）。
#
# 出力形式（検出 1 件につき 1 行、タブ区切り。末尾に走査件数のサマリ行）:
#   <file>:<line>\t<target>\t-> <resolved_path_or_marker>
#
# 実装方針: 本体は bash（既存 scripts/*.sh 規約に合わせる）。Unicode を含む見出しスラッグ化・
#   inline code 除去つきのリンク抽出のみ、既存 write-workflow-log.sh の UUID 生成と同様に
#   python3 を小さなヘルパーとして呼び出す（ロジックはこのスクリプト 1 本に集約し、二重化しない）。
set -uo pipefail

CHECK_ANCHORS=1
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --check-anchors) CHECK_ANCHORS=1 ;;
    --no-check-anchors) CHECK_ANCHORS=0 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

ROOT="${POSITIONAL[0]:-.}"
if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  SCOPE_ARGS=("${POSITIONAL[@]:1}")
else
  SCOPE_ARGS=()
fi

if [[ ! -d "$ROOT" ]]; then
  echo "エラー: project_root が見つかりません: $ROOT" >&2
  exit 2
fi
ROOT="$(cd "$ROOT" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "エラー: python3 が見つかりません（見出しスラッグ化・リンク抽出に使用）。" >&2
  exit 2
fi

is_excluded() {
  # 引数は ROOT からの相対パスであること（絶対パスを渡すと、worktree の物理配置が
  # たまたま .claude/ 等の配下にある場合に誤検出するため、必ず相対パス化してから渡す）。
  case "$1" in
    close/*|*/close/*|.claude/*|*/.claude/*|.cursor/*|*/.cursor/*|.adapters/*|*/.adapters/*|node_modules/*|*/node_modules/*|.git/*|*/.git/*) return 0 ;;
    *) return 1 ;;
  esac
}

FILES=()

collect_recursive() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  while IFS= read -r -d '' f; do
    rel="${f#"$ROOT"/}"
    is_excluded "$rel" && continue
    FILES+=("$f")
  done < <(find "$dir" -type f -name "*.md" -print0)
}

collect_flat() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  while IFS= read -r -d '' f; do
    rel="${f#"$ROOT"/}"
    is_excluded "$rel" && continue
    FILES+=("$f")
  done < <(find "$dir" -maxdepth 1 -type f -name "*.md" -print0)
}

if [[ ${#SCOPE_ARGS[@]} -eq 0 ]]; then
  if [[ ! -d "$ROOT/.agent-skill-chain/source" && ! -d "$ROOT/.agent-skill-chain/project" ]]; then
    echo "エラー: 既定スコープの基準ディレクトリが見つかりません（.agent-skill-chain/source, .agent-skill-chain/project）: $ROOT" >&2
    exit 2
  fi
  collect_recursive "$ROOT/.agent-skill-chain/source"
  collect_recursive "$ROOT/.agent-skill-chain/project"
  collect_flat "$ROOT"
  collect_flat "$ROOT/docs/maintainer"
else
  for d in "${SCOPE_ARGS[@]}"; do
    full="$ROOT/$d"
    if [[ -d "$full" ]]; then
      collect_recursive "$full"
    elif [[ -f "$full" ]]; then
      rel="${full#"$ROOT"/}"
      is_excluded "$rel" || FILES+=("$full")
    fi
  done
fi

# 重複除去
if [[ ${#FILES[@]} -gt 0 ]]; then
  mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | sort -u)
fi

extract_links() {
  # 引数の Markdown ファイルから "行番号\tリンク先" を 1 リンク 1 行で標準出力へ列挙する。
  # fenced code block を除外し、inline code を除去してから抽出する。
  python3 - "$1" <<'PYEOF'
import re
import sys

path = sys.argv[1]
in_fence = False
fence_char = ''
fence_len = 0
fence_re = re.compile(r'^(`{3,}|~{3,})')
link_re = re.compile(r'\]\(([^)]+)\)')

try:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.rstrip("\n")
            stripped = line.lstrip()
            # E-19: 開始フェンスの記号種（` / ~）と長さを記憶し、同種・同長以上の行でのみ
            # 閉じる（CommonMark 準拠）。単一フラグの単純トグルだと ``` ブロック内の ~~~ 行が
            # 誤って開閉をトグルし、以降のファイル全体で誤検出が連鎖していた。
            m = fence_re.match(stripped)
            if m:
                marker = m.group(1)
                ch, ln_len = marker[0], len(marker)
                if not in_fence:
                    in_fence, fence_char, fence_len = True, ch, ln_len
                    continue
                elif ch == fence_char and ln_len >= fence_len:
                    in_fence, fence_char, fence_len = False, '', 0
                    continue
                # in_fence かつ別種/短いフェンス行はコンテンツ扱い（開閉しない）
            if in_fence:
                continue
            line = re.sub(r"`[^`]*`", "", line)
            for m in link_re.finditer(line):
                target = m.group(1).strip()
                if target:
                    print(f"{lineno}\t{target}")
except OSError as e:
    print(f"__ERROR__ {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

check_anchor() {
  # 引数: <resolved_md_file> <anchor>
  # リンク先ファイルの見出しを GitHub 準拠でスラッグ化し、anchor が実在すれば exit 0、なければ exit 1。
  python3 - "$1" "$2" <<'PYEOF'
import re
import sys

path, anchor = sys.argv[1], sys.argv[2]
in_fence = False
fence_char = ''
fence_len = 0
fence_re = re.compile(r'^(`{3,}|~{3,})')
seen = {}
slugs = set()
heading_re = re.compile(r"^(#{1,6})\s+(.*)$")

try:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            stripped = line.lstrip()
            # E-19: extract_links と同一のフェンス種別・長さ追跡ロジック（ロジック二重化はここに明示）。
            m_fence = fence_re.match(stripped)
            if m_fence:
                marker = m_fence.group(1)
                ch, ln_len = marker[0], len(marker)
                if not in_fence:
                    in_fence, fence_char, fence_len = True, ch, ln_len
                    continue
                elif ch == fence_char and ln_len >= fence_len:
                    in_fence, fence_char, fence_len = False, '', 0
                    continue
            if in_fence:
                continue
            m = heading_re.match(line)
            if not m:
                continue
            text = m.group(2).strip()
            chars = []
            for ch in text:
                if ch.isspace():
                    chars.append("-")
                elif ch.isalnum() or ch in ("-", "_"):
                    chars.append(ch.lower() if ord(ch) < 128 else ch)
                else:
                    continue
            base = "".join(chars)
            if base in seen:
                seen[base] += 1
                slug = f"{base}-{seen[base]}"
            else:
                seen[base] = 0
                slug = base
            slugs.add(slug)
except OSError:
    sys.exit(1)

sys.exit(0 if anchor in slugs else 1)
PYEOF
}

broken_count=0
link_count=0

for file in "${FILES[@]}"; do
  # E-7: extract_links（python3）が失敗しても、プロセス置換 < <(...) の終了コードは
  # pipefail の対象外のため while ループが単に空入力を受け取るだけになり、全ファイル
  # 「リンク 0 件」の偽 PASS になっていた。一時ファイルへ落として終了コードを検査してから読む。
  _links_tmp="$(mktemp)"
  trap 'rm -f "$_links_tmp"' EXIT INT TERM
  if ! extract_links "$file" > "$_links_tmp"; then
    echo "エラー: リンク抽出ヘルパー（python3）が失敗しました: $file" >&2
    rm -f "$_links_tmp"
    exit 2
  fi
  while IFS=$'\t' read -r lineno target; do
    [[ -z "${lineno:-}" ]] && continue
    link_count=$((link_count + 1))

    target="$(printf '%s' "$target" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$target" ]] && continue

    case "$target" in
      http://*|https://*|mailto:*|tel:*) continue ;;
      '#'*) continue ;;
    esac
    case "$target" in
      *'{'*|*'}'*) continue ;;
    esac

    # タイトル付きリンク `path "title"` の title 部分を除去（ベストエフォート）。
    target="${target%% \"*}"

    if [[ "$target" == *'#'* ]]; then
      filepart="${target%%#*}"
      anchor="${target#*#}"
    else
      filepart="$target"
      anchor=""
    fi
    [[ -z "$filepart" ]] && continue

    if [[ "$filepart" == /* ]]; then
      resolved="$(realpath -m -- "$ROOT/$filepart" 2>/dev/null)"
    else
      resolved="$(realpath -m -- "$(dirname -- "$file")/$filepart" 2>/dev/null)"
    fi

    if [[ ! -e "$resolved" ]]; then
      printf '%s:%s\t%s\t-> %s\n' "$file" "$lineno" "$target" "$resolved"
      broken_count=$((broken_count + 1))
      continue
    fi

    if [[ "$CHECK_ANCHORS" == "1" && -n "$anchor" && "$resolved" == *.md ]]; then
      if ! check_anchor "$resolved" "$anchor"; then
        printf '%s:%s\t%s\t-> [anchor missing]\n' "$file" "$lineno" "$target"
        broken_count=$((broken_count + 1))
      fi
    fi
  done < "$_links_tmp"
  rm -f "$_links_tmp"
done

echo "---"
echo "check-relative-links: 走査 ${#FILES[@]} ファイル / リンク ${link_count} 件 / 切れ ${broken_count} 件（アンカー検査: $([[ "$CHECK_ANCHORS" == "1" ]] && echo ON || echo OFF)）"

if [[ "$broken_count" -eq 0 ]]; then
  exit 0
else
  exit 1
fi
