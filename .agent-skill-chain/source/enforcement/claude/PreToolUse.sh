#!/usr/bin/env bash
# PreToolUse.sh — ツール実行前に契約違反を reject するフック（絶対強制）
# 配置: .claude/hooks/（setup が enforcement/claude/ からコピー）／plugin 経由は .agent-skill-chain/source/enforcement/claude/ を直接呼ぶ。
#
# 責務:
#   - 実機 Claude Code の hooks 契約（stdin JSON 入力・ブロック exit 2）に整合させる。
#   - stdin の JSON から tool_name / tool_input.command / tool_input.file_path を限定抽出し、該当違反で exit 2（block）する（runtime enforcement・Layer 2）。
#   - **絶対強制**: orchestrator（ROLE=orchestrator）の Write/Edit/StrReplace/Shell/Delete/Bash 等は例外なく必ず exit 2 で拒否する。
#   - 入力が取れない（stdin 空・非 JSON・env 未設定）場合は案内のみ exit 0（CI で事後検知）。保守的に倒す（過剰ブロックしない）。
#
# 入力（2 経路・優先順位は parse_input）:
#   (a) stdin の JSON（実機が渡す tool_name / tool_input.{command,file_path}）【優先】
#   (b) env 後方互換（CLAUDE_TOOL_NAME / TOOL_NAME、CLAUDE_FILE_PATH / FILE_PATH、CLAUDE_COMMAND / COMMAND）。stdin 空/非 JSON 時のみ。
#   ROLE: AGENT_ROLE / CLAUDE_AGENT_ROLE（未設定時 unknown）。
#
# 終了コード規約: 違反=2（block）/ 許可・案内のみ=0（allow）。
# Fail-safe: set +e でフック自体の失敗が全ツール停止にならないようにする。内部エラーは allow（exit 0）に倒す。

set +e

# ---------------------------------------------------------------------------
# 終了コード規約（block / allow）— exit 2 / exit 0 を 1 か所に集約する薄関数。
# ---------------------------------------------------------------------------
block() {
  # 違反確証時: 理由を stderr に出し exit 2（fail-closed）。
  # prefix `[enforcement:block]` は「実際の違反（BLOCK）」であることを示す。常時案内の
  # `[PreToolUse:info]` バナー（下記）と体裁で明確に区別する（FR-6・ADR-7）。理由本文 $1 は
  # `<英語> / <日本語>` の日英併記（FR-7・ADR-8）。英語部分文字列は先頭に保持し既存テストを壊さない。
  echo "[enforcement:block] 違反(BLOCK): $1" >&2
  exit 2
}
allow() {
  # 許可・案内のみ: exit 0（fail-safe 側）。
  exit 0
}

# ---------------------------------------------------------------------------
# is_in_project_allowlist <tool> — project 固有 allowlist 拡張（FR-4・ADR-3/ADR-4）。
#   R2 の *) default に落ちた未知ツール名が、消費先のユーザー資産
#   `.agent-skill-chain/project/orchestrator-allowlist.txt` に厳密一致で列挙されていれば真。
#
#   設計原則（ADR-3）:
#     - 拡張ファイルは **source せずデータとして** read する（任意コード実行ベクタを作らない）。
#     - 各行は `#` 以降をコメント除去し、**先頭末尾のみ trim（内部空白は collapse しない）**。
#       collapse すると `mcp __ shell`→`mcp__shell` 等の内部空白難読化が正規名に化けて regex を通過し、
#       PR レビューの目視をすり抜ける余地を残すため、trim のみとする。
#     - 衛生フィルタとして厳密文字種 `^[A-Za-z][A-Za-z0-9_-]*$` を要求（`-` は末尾 literal。MCP 名の
#       ハイフンを許容。内部空白・その他メタ文字・内部 CR・BOM を含む不正行は不一致で無視＝注入対策）。
#       許可の実ゲートは `[[ "$line" == "$want" ]]` の厳密一致
#       （RHS を quote＝リテラル比較・glob 無効）であり、regex は衛生に過ぎない。
#     - ファイル不在・空・全行不正・読取不可・非正規ファイル（`-f` 偽＝デバイス/FIFO への symlink 等）は
#       偽を返し *) default 拒否へ落ちる＝**fail-closed を保全**。
#   パス導出（ADR-3）: `$(dirname "$AGENTS_ROOT")/project/orchestrator-allowlist.txt`
#     （AGENTS_ROOT=.../.agent-skill-chain/source → .../.agent-skill-chain/project）。字句 dirname
#     （symlink 解決なし）。非標準配置ではファイル不在で fail-closed に落ちるだけで許可は漏れない。
#   注意（能力ベース残余リスク）: 「明示拒否**名**を覆せない」のは名前一致の保証であり、能力の保証ではない。
#     `*)` に落ちる MCP 書込/実行ツール（`mcp__*` 系。明示拒否列の `call_mcp_tool` とは別名）を opt-in
#     すれば orchestrator が Edit/Write を介さず書込/実行の等価権限を得る余地が残る。安全性は opt-in 内容の
#     人間 PR レビューに全面依存する（SETUP.md §orchestrator allowlist の project 拡張 参照）。
# ---------------------------------------------------------------------------
is_in_project_allowlist() {
  local want="$1" line proj_file
  [[ -z "$want" ]] && return 1
  proj_file="$(dirname "$AGENTS_ROOT")/project/orchestrator-allowlist.txt"
  [[ -f "$proj_file" ]] || return 1        # 不在・非正規ファイルは fail-closed（default block へ）
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"                          # # 以降はコメント除去
    line="${line#"${line%%[![:space:]]*}"}"     # 先頭空白の trim
    line="${line%"${line##*[![:space:]]}"}"     # 末尾空白の trim（CRLF の \r を含む）
    [[ -z "$line" ]] && continue
    # 厳密文字種検証（衛生フィルタ・内部空白/メタ文字/内部 CR/BOM を含む行はここで無視）。
    #   `-` は末尾に置いた literal（範囲演算子でない）。MCP 名 `mcp__brave-search__search` 等の
    #   ハイフン付き正式名を許容するため許可集合に含める（厳密一致ゲートは下行で不変）。
    [[ "$line" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]] || continue
    [[ "$line" == "$want" ]] && return 0        # 厳密一致（RHS quote＝リテラル比較・glob 無効）
  done < "$proj_file"
  return 1
}

# ---------------------------------------------------------------------------
# json_get <key> — RAW（stdin 全量）から限定キーを 1 つ抽出する低レベル関数。
#   対象キー: tool_name / command（= tool_input.command）/ file_path（= tool_input.file_path）/
#             agent_id（= トップレベル .agent_id・サブエージェント実行時のみハーネスが注入する識別信号）。
#   jq があれば jq、無ければ sed/grep の保守的 fallback。抽出失敗は空文字（誤検知抑制）。
#   注: agent_id は stdin JSON のトップレベルからのみ読む（env 経路は設けない＝ADR-2 非自己申告性）。
# ---------------------------------------------------------------------------
json_get() {
  local key="$1"
  [[ -z "$RAW" ]] && return 0
  if command -v jq >/dev/null 2>&1; then
    case "$key" in
      tool_name) printf '%s' "$RAW" | jq -r '.tool_name // empty' 2>/dev/null ;;
      command)   printf '%s' "$RAW" | jq -r '.tool_input.command // empty' 2>/dev/null ;;
      file_path) printf '%s' "$RAW" | jq -r '.tool_input.file_path // empty' 2>/dev/null ;;
      agent_id)  printf '%s' "$RAW" | jq -r '.agent_id // empty' 2>/dev/null ;;
    esac
    return 0
  fi
  # jq 非依存フォールバック（最小・限定キーのみ）。"key" : "値" を 1 件抽出する。
  # 値中の \" エスケープを許容し、最初の非エスケープ " で閉じる。
  local pat val
  case "$key" in
    tool_name) pat='"tool_name"' ;;
    command)   pat='"command"' ;;
    file_path) pat='"file_path"' ;;
    agent_id)  pat='"agent_id"' ;;
    *) return 0 ;;
  esac
  # grep -o で `"key"\s*:\s*"...(エスケープ許容)..."` を抜き、sed で値部分だけ取り出す。
  val="$(printf '%s' "$RAW" \
    | grep -oE "$pat[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
    | head -n1 \
    | sed -E "s/^$pat[[:space:]]*:[[:space:]]*\"//" \
    | sed -E 's/"$//')"
  # JSON エスケープを最小限デコード（\" \\ \/ のみ。誤検知抑制のため過剰デコードしない）。
  val="${val//\\\"/\"}"
  val="${val//\\\//\/}"
  val="${val//\\\\/\\}"
  printf '%s' "$val"
}

# ---------------------------------------------------------------------------
# is_sqlite3_invocation <cmd> — R6: sqlite3 直接実行の判定（コマンド名としての起動のみ検知）。
#   旧実装 `[[ "$CMD" =~ sqlite3 ]]` は部分文字列一致であり、`grep sqlite3 doc.md` のような
#   引数中の言及（文字列としての言及）まで一律ブロックする過剰検知だった。
#   本関数は CMD をセパレータ（改行 / ; / & / |。&& や || も同じ文字の並びとして分割される）で
#   セグメントに分割し、各セグメントの「実行コマンド名」（先頭の VAR=val 環境変数代入を読み飛ばした
#   最初のトークン。パス付き実行はベースネームで比較）が厳密に `sqlite3` であるセグメントのみを
#   違反とする。これにより `grep sqlite3 doc.md`（先頭トークンは grep）は誤ブロックしない。
#   回避耐性の強化として、`python3 -c "import sqlite3"` 等インタプリタの -c インライン経由での
#   sqlite3 モジュール利用も簡易検知する（先頭コマンドが python/python3/python2 かつ -c を含み、
#   `import sqlite3` / `from sqlite3 import` パターンを含む場合を検知）。
#   限界（00_要求定義.md §7.1 のとおり正直に明記）: シェル文字列の静的解析には限界があり、
#   エイリアス・関数経由の呼び出しやスクリプトファイル内部での import など、あらゆる回避経路を
#   完全に防ぐものではない。実用上のバランスを優先した簡易判定に留める。
# ---------------------------------------------------------------------------
is_sqlite3_invocation() {
  local raw="$1" normalized seg trimmed first base
  [[ -z "$raw" ]] && return 1
  # ; & | 改行をセパレータとして分割（&& / || は同一文字の連続として分割される）。
  normalized="${raw//$'\n'/$'\n'}"
  normalized="${normalized//;/$'\n'}"
  normalized="${normalized//&/$'\n'}"
  normalized="${normalized//\|/$'\n'}"
  while IFS= read -r seg; do
    trimmed="$seg"
    # 先頭空白の trim。
    trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
    [[ -z "$trimmed" ]] && continue
    # 先頭の `VAR=val` 環境変数代入（0 個以上）を読み飛ばして実行コマンド名を得る。
    while [[ "$trimmed" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+(.*)$ ]]; do
      trimmed="${BASH_REMATCH[1]}"
    done
    first="${trimmed%%[[:space:]]*}"
    base="${first##*/}"
    if [[ "$base" == "sqlite3" ]]; then
      return 0
    fi
    # 回避耐性: python(3)? -c "import sqlite3 ..." / "from sqlite3 import ..." の簡易検知。
    if [[ "$base" =~ ^python[23]?$ ]] && [[ "$trimmed" == *"-c"* ]]; then
      if [[ "$trimmed" =~ (^|[^A-Za-z0-9_])import[[:space:]]+sqlite3([^A-Za-z0-9_]|$) ]] \
        || [[ "$trimmed" =~ (^|[^A-Za-z0-9_])from[[:space:]]+sqlite3[[:space:]]+import([^A-Za-z0-9_]|$) ]]; then
        return 0
      fi
    fi
  done <<< "$normalized"
  return 1
}

# >>> worktree-discipline lib (BEGIN) ---------------------------------------
# worktree 運用規律（命名規則 Tier1 強制・削除前 untracked 退避）の純関数・副作用関数群。
# 本ブロックは既存関数・R1〜R6 を変更せず**追加のみ**（02_設計 ADR-1/ADR-2）。
# 全経路 fail-safe: 対象外・判定不能・内部エラーは allow 側に倒し、作成形と確定した命名違反のみ block。
# 単体テストは本 BEGIN/END マーカ間を sed 抽出して source する（test-worktree-discipline.sh）。
#
# git_subcommand_of / _wt_effective — git サブコマンド抽出のトークナイザ（ADR-3・fable 助言統合）。
#   ラッパー（command/env/nohup/…）・先頭 VAR=val・パス付き git を読み飛ばし、グローバルオプションを
#   スキップしてサブコマンド以降の argv を WT_ARGV に格納する。未知オプションは 1 進みで allow 側に自然
#   落下（誤 block でなく見逃しに倒れる非対称）。bare `--exec-path` は実 git がそこで exec-path を印字して
#   終了し後続サブコマンドを実行しないため（実機 git 2.43.0 で確認・observed_runtime）、サブコマンド無し
#   （return 1）として扱う（`--exec-path=<path>` の = 形は `--*=*` で自己完結・後続を実行するため別扱い）。
_wt_effective() {
  local LC_ALL=C; local -a tok; read -ra tok <<< "$1"
  WT_ARGV=()
  local i=0 n=${#tok[@]}
  while (( i < n )); do
    case "${tok[i]}" in
      *=*) ((i++)); continue ;;                 # VAR=val 代入
      command|env|nohup|nice|stdbuf) ((i++)); continue ;;  # ラッパー
      *) break ;;
    esac
  done
  (( i < n )) || return 1
  [[ "${tok[i]##*/}" != "git" ]] && return 1    # basename が git でなければ対象外
  ((i++))
  while (( i < n )); do
    case "${tok[i]}" in
      --*=*|-C?*|-c?*) ((i++)) ;;                # 結合/=形は自己完結 → 1 進む
      --exec-path) return 1 ;;                   # bare --exec-path: git はここで終了・サブコマンド無し
      -C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source) ((i+=2)) ;;  # 引数を別トークンで取る
      -p|--paginate|-P|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks|--no-advice) ((i++)) ;;  # 引数なし既知フラグ
      -*) ((i++)) ;;                             # 未知オプション: 1 進み（allow 側へ自然落下）
      *) break ;;                                # サブコマンド確定
    esac
  done
  (( i < n )) || return 1
  WT_ARGV=( "${tok[@]:i}" )
  return 0
}

git_subcommand_of() {
  local LC_ALL=C
  _wt_effective "$1" || return 0
  printf '%s' "${WT_ARGV[0]}"
}

# validate_name <固有名> — 固有名（<name> 部分）の妥当性（ADR-4・LC_ALL=C ブラックリスト＋構造＋長さ上限）。
#   日本語（マルチバイト）は許容し、ASCII 危険文字・制御文字・先頭 . / 先頭 - / .. / 末尾 .lock を排除する。
#   長さ上限 200 バイト（LC_ALL=C 下の ${#name} はバイト数。ext4 NAME_MAX=255 に安全マージン）。
validate_name() {
  local LC_ALL=C name="$1"
  [[ -z "$name" ]] && return 1
  (( ${#name} > 200 )) && return 1
  case "$name" in
    .*|-*|*..*|*.lock) return 1 ;;              # 先頭./先頭-/親escape/refロック
  esac
  case "$name" in
    *[]]*) return 1 ;;                          # ] を含む（] は bracket 先頭で扱えないため単独判定）
  esac
  local danger ctl
  danger=$(printf ' \t/;&|$`"'\''\\<>(){}[^~:#?*!\177')   # ASCII 危険文字（space/tab/… /0x7f）
  case "$name" in
    *["$danger"]*) return 1 ;;
  esac
  ctl=$(printf '\1\2\3\4\5\6\7\10\11\12\13\14\15\16\17\20\21\22\23\24\25\26\27\30\31\32\33\34\35\36\37')
  case "$name" in
    *["$ctl"]*) return 1 ;;                     # 制御文字 0x01-0x1f
  esac
  return 0
}

# validate_branch_ref <ref> — ブランチ名/ref が <type>/<YYYYMMDD_HHMMSS>/<固有名> 準拠か。
#   type ∈ {feature,bugfix,hotfix,release,chore}・ts=[0-9]{8}_[0-9]{6}・name は validate_name（/ 不可＝3 階層固定）。
validate_branch_ref() {
  local LC_ALL=C ref="$1" type ts name rest
  [[ -z "$ref" ]] && return 1
  type="${ref%%/*}"; rest="${ref#*/}"
  [[ "$rest" == "$ref" ]] && return 1           # / 無し（1 階層のみ）
  ts="${rest%%/*}"; name="${rest#*/}"
  [[ "$name" == "$rest" ]] && return 1          # 2 階層のみ
  case "$type" in feature|bugfix|hotfix|release|chore) ;; *) return 1 ;; esac
  [[ "$ts" =~ ^[0-9]{8}_[0-9]{6}$ ]] || return 1
  validate_name "$name" || return 1             # name に / があれば validate_name が弾く（4 階層以上拒否）
  return 0
}

# validate_worktree_path <path> — worktree ディレクトリが .worktree/<type>/<ts>/<name>/ 準拠か。
validate_worktree_path() {
  local LC_ALL=C p="${1%/}" rest
  p="${p#./}"
  case "$p" in *..*) return 1 ;; esac           # 親 escape
  case "$p" in
    .worktree/*) rest="${p#.worktree/}" ;;
    */.worktree/*) rest="${p##*/.worktree/}" ;; # 絶対/ネスト表記
    *) return 1 ;;                              # .worktree 配下でない
  esac
  validate_branch_ref "$rest"
}

# _wt_extract_creation — WT_ARGV から作成されるブランチ名・worktree path を抽出（Query・副作用なし）。
#   出力: WT_CREATE(0/1) WT_CREATE_BRANCH WT_CREATE_PATH。作成形と確定できないものは WT_CREATE=0（fail-open）。
_wt_extract_creation() {
  WT_CREATE=0; WT_CREATE_BRANCH=""; WT_CREATE_PATH=""
  local sub="${WT_ARGV[0]:-}" i n tok
  n=${#WT_ARGV[@]}
  case "$sub" in
    worktree)
      [[ "${WT_ARGV[1]:-}" == "add" ]] || return 0   # add のみ作成（list/remove/prune/move 等は対象外）
      local -a pos=(); local branch=""
      i=2
      while (( i < n )); do
        tok="${WT_ARGV[i]}"
        case "$tok" in
          -b|-B) ((i++)); branch="${WT_ARGV[i]:-}" ;;
          -b?*|-B?*) branch="${tok#-?}" ;;      # -bNAME 結合形
          --reason) ((i++)) ;;                  # 引数取りオプション
          --*=*) : ;;
          -*) : ;;
          *) pos+=("$tok") ;;
        esac
        ((i++))
      done
      local wtpath="${pos[0]:-}"
      [[ -z "$wtpath" ]] && return 0            # path 無し＝曖昧 → allow
      WT_CREATE=1; WT_CREATE_PATH="$wtpath"
      if [[ -n "$branch" ]]; then
        WT_CREATE_BRANCH="$branch"
      else
        local b="${wtpath%/}"; WT_CREATE_BRANCH="${b##*/}"   # -b 無し＝path basename が暗黙ブランチ
      fi
      ;;
    switch)
      i=1
      while (( i < n )); do
        tok="${WT_ARGV[i]}"
        case "$tok" in
          -c|-C) ((i++)); WT_CREATE_BRANCH="${WT_ARGV[i]:-}"; WT_CREATE=1 ;;
          -c?*|-C?*) WT_CREATE_BRANCH="${tok#-?}"; WT_CREATE=1 ;;
        esac
        ((i++))
      done
      ;;
    checkout)
      i=1
      while (( i < n )); do
        tok="${WT_ARGV[i]}"
        case "$tok" in
          -b|-B) ((i++)); WT_CREATE_BRANCH="${WT_ARGV[i]:-}"; WT_CREATE=1 ;;
          -b?*|-B?*) WT_CREATE_BRANCH="${tok#-?}"; WT_CREATE=1 ;;
        esac
        ((i++))
      done
      ;;
    branch)
      # 作成形のみ: 位置引数 name が 1 つ以上あり listing/削除/rename/copy/変更系フラグを含まない。
      local -a pos=(); local noncreate=0
      i=1
      while (( i < n )); do
        tok="${WT_ARGV[i]}"
        case "$tok" in
          -d|-D|--delete|-m|-M|--move|-c|-C|--copy|-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--edit-description|--set-upstream-to|--set-upstream-to=*|-u|--unset-upstream|--contains|--no-contains|--merged|--no-merged|--points-at|--show-current|--format|--format=*|--sort|--sort=*|-t|--track|--track=*|--no-track|--recurse-submodules)
            noncreate=1 ;;
          -*) : ;;
          *) pos+=("$tok") ;;
        esac
        ((i++))
      done
      if [[ "$noncreate" -eq 0 && -n "${pos[0]:-}" ]]; then
        WT_CREATE=1; WT_CREATE_BRANCH="${pos[0]}"
      fi
      ;;
  esac
  return 0
}

# is_worktree_destroy — 削除形（worktree remove / clean -x|-X / clean が .worktree を対象）検知（Query）。
#   出力: WT_DESTROY(0/1) WT_DESTROY_PATH（対象 path。無ければ空＝呼び出し側で CWD 既定）。
is_worktree_destroy() {
  WT_DESTROY=0; WT_DESTROY_PATH=""
  local sub="${WT_ARGV[0]:-}" i n tok
  n=${#WT_ARGV[@]}
  case "$sub" in
    worktree)
      if [[ "${WT_ARGV[1]:-}" == "remove" ]]; then   # --force 有無問わず
        WT_DESTROY=1
        i=2; local -a pos=()
        while (( i < n )); do
          tok="${WT_ARGV[i]}"
          case "$tok" in -*) : ;; *) pos+=("$tok") ;; esac
          ((i++))
        done
        WT_DESTROY_PATH="${pos[0]:-}"
      fi
      ;;
    clean)
      i=1; local -a pos=(); local hasx=0
      while (( i < n )); do
        tok="${WT_ARGV[i]}"
        case "$tok" in
          --) ((i++)); while (( i < n )); do pos+=("${WT_ARGV[i]}"); ((i++)); done; break ;;
          -x|-X) hasx=1 ;;                       # 単独 -x/-X
          --*) : ;;
          -*x*|-*X*) hasx=1 ;;                   # 結合形 -xf/-dfx 等
          -*) : ;;
          *) pos+=("$tok") ;;
        esac
        ((i++))
      done
      [[ "$hasx" -eq 1 ]] && { WT_DESTROY=1; WT_DESTROY_PATH="${pos[0]:-}"; }
      ;;
  esac
  # clean が対象パスに .worktree を含む場合も検知対象に含める（BR-12・保全のみ）。
  # worktree サブコマンドの破壊性は remove で確定済み（add は作成のため対象外）。
  if [[ "$WT_DESTROY" -eq 0 && "$sub" == "clean" ]]; then
    for tok in "${WT_ARGV[@]}"; do
      case "$tok" in
        -*) continue ;;
        *.worktree|*.worktree/*|.worktree|.worktree/*) WT_DESTROY=1; WT_DESTROY_PATH="$tok" ;;
      esac
    done
  fi
  [[ "$WT_DESTROY" -eq 1 ]] && return 0 || return 1
}

# worktree_name_reject <got> — 命名違反 reject（期待パターン＋got＋fix example・日英併記・BR-16）。exit 2。
worktree_name_reject() {
  local got="$1"
  {
    echo "[enforcement:block] 違反(BLOCK): worktree/branch name violates naming rule / worktree・ブランチ名が命名規則に違反しています"
    echo "  expected: <type>/<YYYYMMDD_HHMMSS>/<name>  (type = feature|bugfix|hotfix|release|chore)"
    echo "  got:      $got"
    echo "  fix example: feature/20260716_143000/worktree運用規律"
    echo "  worktree path must be under: .worktree/<type>/<YYYYMMDD_HHMMSS>/<name>/"
  } >&2
  exit 2
}

# _wt_purge_trash <trash_root> — 退避先の lazy purge（保持期限超過エントリのみ削除・自 trash 配下のみ・SC-5）。
_wt_purge_trash() {
  local trash="$1"
  [[ -d "$trash" ]] || return 0
  local retention="${WORKTREE_TRASH_RETENTION_DAYS:-14}"
  [[ "$retention" =~ ^[0-9]+$ ]] || retention=14
  local now cutoff entry base
  now="$(date +%s 2>/dev/null)" || return 0
  cutoff=$(( now - retention*86400 ))
  for entry in "$trash"/*/; do
    [[ -d "$entry" ]] || continue
    base="${entry%/}"; base="${base##*/}"
    if [[ "$base" =~ ^([0-9]{8})_([0-9]{6})_ ]]; then
      local d="${BASH_REMATCH[1]}" t="${BASH_REMATCH[2]}" eepoch
      eepoch="$(date -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null)" || continue
      (( eepoch < cutoff )) && rm -rf "$entry" 2>/dev/null
    fi
  done
}

# _wt_abspath <path> — path を絶対パスへ正規化（末尾コンポーネント未存在でも許容）。解決不能時は空。
#   退避先が削除対象配下かを判定するための正規化に用いる（finding-6/7）。
_wt_abspath() {
  local p="$1" d b
  [[ -z "$p" ]] && return 0
  if command -v realpath >/dev/null 2>&1 && realpath -m -- "." >/dev/null 2>&1; then
    realpath -m -- "$p" 2>/dev/null; return 0
  fi
  d="$(dirname -- "$p" 2>/dev/null)"; b="$(basename -- "$p" 2>/dev/null)"
  if [[ -d "$d" ]]; then printf '%s/%s' "$(cd "$d" 2>/dev/null && pwd -P)" "$b"
  elif [[ "$p" == /* ]]; then printf '%s' "$p"
  else printf '%s/%s' "$(pwd -P)" "$p"; fi
}

# _wt_main_worktree_root <target> — target（git worktree）の main worktree ルート絶対パスを返す。
#   `worktree list --porcelain` の先頭 worktree エントリが main worktree（linked worktree でも共有）。
#   git バージョン差に強い（--porcelain は 2.7+）。解決不能時は空を返す（呼び出し側で fail-safe）。
_wt_main_worktree_root() {
  local t="$1" line
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) printf '%s' "${line#worktree }"; return 0 ;;
    esac
  done < <(git -C "$t" worktree list --porcelain 2>/dev/null)
  return 0
}

# worktree_untracked_rescue <target> — 削除前 untracked を退避先へ copy 保全（Command・fail-safe・block しない）。
#   copy（move でなく）で原本を保持し退避失敗が原本を壊さない（ADR-5）。実削除は本来のコマンドに委ねる。
worktree_untracked_rescue() {
  local target="$1"
  [[ -z "$target" ]] && return 0
  command -v git >/dev/null 2>&1 || return 0
  [[ -d "$target" ]] || return 0
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local trash ts base dest target_abs trash_abs
  # 削除対象（target）の絶対パス。退避先が target 配下に入ると、直後の clean（-x path 省略で
  #   target=CWD）で退避物ごと非可逆消失するため必ず算出する（finding-6/7・実測再現）。
  target_abs="$(cd "$target" 2>/dev/null && pwd -P)" || return 0
  [[ -z "$target_abs" ]] && return 0
  # 退避先ルートの解決:
  #   ① WORKTREE_TRASH_ROOT 明示時はそれを尊重（値はそのまま利用・従来互換）。
  #   ② 既定は「削除対象の外側」＝ main worktree ルート直下の .claude/.worktree-trash
  #      （target が linked worktree でも main ルートは別サブツリー）。target 相対の
  #      .claude/.worktree-trash に置くと clean -x path 省略（CWD=target）で退避物ごと消える。
  if [[ -n "${WORKTREE_TRASH_ROOT:-}" ]]; then
    trash="$WORKTREE_TRASH_ROOT"
  else
    local main_root
    main_root="$(_wt_main_worktree_root "$target")"
    if [[ -n "$main_root" ]]; then
      trash="$main_root/.claude/.worktree-trash"
    else
      trash=".claude/.worktree-trash"          # 最終手段（main ルート解決不能時の相対）
    fi
  fi
  # 安全ガード（finding-6/7）: 退避先が target 自身/配下なら clean で退避物ごと消える。
  #   絶対化して判定し、該当時は target 外（システム temp）へフォールバックする。
  trash_abs="$(_wt_abspath "$trash")"; [[ -z "$trash_abs" ]] && trash_abs="$trash"
  if [[ "$trash_abs" == "$target_abs" || "$trash_abs" == "$target_abs"/* ]]; then
    trash="${TMPDIR:-/tmp}/agents-md-worktree-trash"
    trash_abs="$(_wt_abspath "$trash")"; [[ -z "$trash_abs" ]] && trash_abs="$trash"
  fi
  # フォールバック先も target 配下（TMPDIR が target 配下等の病的ケース）なら、退避を見送り
  #   fail-safe（allow・WARN のみ・原本は本来のコマンドに委ねる。退避しても直後に消えるため）。
  if [[ "$trash_abs" == "$target_abs" || "$trash_abs" == "$target_abs"/* ]]; then
    echo "[enforcement:warn] worktree untracked rescue: 安全な退避先を target 外に確保できませんでした（退避見送り・原本は本来のコマンドに委ねる・保全のみ失敗）: target=$target_abs" >&2
    return 0
  fi
  ts="$(TZ=Asia/Tokyo date +%Y%m%d_%H%M%S 2>/dev/null || date +%Y%m%d_%H%M%S 2>/dev/null || echo unknown)"
  base="${target%/}"; base="${base##*/}"
  local -a untracked=()
  while IFS= read -r -d '' rec; do
    [[ "$rec" == '??'* ]] && untracked+=("${rec:3}")   # porcelain -z: "?? <path>\0"
  done < <(git -C "$target" status --porcelain=v1 -z 2>/dev/null)
  if [[ ${#untracked[@]} -eq 0 ]]; then
    _wt_purge_trash "$trash"
    return 0                                     # untracked 無し → 退避しない（BR-1・SC-4）
  fi
  dest="$trash/${ts}_${base}"
  if ! mkdir -p "$dest" 2>/dev/null; then
    echo "[enforcement:warn] worktree untracked rescue: 退避先を作成できませんでした（削除は継続・保全のみ失敗）: $dest" >&2
    return 0
  fi
  local f rc=0 src ddir
  for f in "${untracked[@]}"; do
    [[ -z "$f" ]] && continue
    case "$f" in .git|.git/*|*/.git|*/.git/*) continue ;; esac   # .git 実体は除外
    src="$target/$f"
    ddir="$dest/$(dirname "$f")"
    mkdir -p "$ddir" 2>/dev/null || { rc=1; continue; }
    cp -a "$src" "$ddir/" 2>/dev/null || rc=1
  done
  if [[ "$rc" -eq 0 ]]; then
    echo "[enforcement:info] rescued ${#untracked[@]} untracked path(s) to $dest (restore from there) / untracked 成果物を退避しました（復元元）: $dest" >&2
  else
    echo "[enforcement:warn] worktree untracked rescue: 一部の退避に失敗しました（削除は継続）: $dest" >&2
  fi
  _wt_purge_trash "$trash"
  return 0
}

# worktree_name_enforce <cmd> — R7 本体: CMD をセグメント分割し、作成形の命名違反のみ block（exit 2）。
worktree_name_enforce() {
  local cmd="$1" seg normalized
  normalized="${cmd//;/$'\n'}"; normalized="${normalized//&/$'\n'}"; normalized="${normalized//\|/$'\n'}"
  while IFS= read -r seg; do
    [[ -z "${seg//[[:space:]]/}" ]] && continue
    _wt_effective "$seg" || continue
    case "${WT_ARGV[0]:-}" in
      worktree|switch|checkout|branch) ;;
      *) continue ;;
    esac
    _wt_extract_creation
    [[ "${WT_CREATE:-0}" == "1" ]] || continue   # 作成形と確定できなければ allow（fail-open）
    if ! validate_branch_ref "$WT_CREATE_BRANCH"; then
      worktree_name_reject "$WT_CREATE_BRANCH"    # exit 2
    fi
    if [[ -n "$WT_CREATE_PATH" ]] && ! validate_worktree_path "$WT_CREATE_PATH"; then
      worktree_name_reject "$WT_CREATE_PATH (worktree path)"   # exit 2
    fi
  done <<< "$normalized"
}

# worktree_destroy_rescue <cmd> — R8 本体: CMD をセグメント分割し、削除形の前に untracked を退避（block しない）。
worktree_destroy_rescue() {
  local cmd="$1" seg normalized tgt
  normalized="${cmd//;/$'\n'}"; normalized="${normalized//&/$'\n'}"; normalized="${normalized//\|/$'\n'}"
  while IFS= read -r seg; do
    [[ -z "${seg//[[:space:]]/}" ]] && continue
    _wt_effective "$seg" || continue
    case "${WT_ARGV[0]:-}" in
      worktree|clean) ;;
      *) continue ;;
    esac
    if is_worktree_destroy; then
      tgt="$WT_DESTROY_PATH"
      [[ -z "$tgt" ]] && tgt="."                  # clean で path 省略時は CWD
      worktree_untracked_rescue "$tgt"
    fi
  done <<< "$normalized"
}
# <<< worktree-discipline lib (END) -----------------------------------------

# ---------------------------------------------------------------------------
# r1_norm_path <path> — R1 carve-out 用のパス正規化（symlink 実体解決）。
#   R5 の norm_path と同型だが、Edit/Write の対象は **まだ存在しないファイル**（Write 新規作成）や
#   **既存 symlink**（同名の symlink が先に置かれているケース）の双方を扱う必要があるため、
#   欠損許容（missing 可）フラグを優先して用いる:
#     ① realpath -m（欠損コンポーネントを許容しつつ、途中・末尾の既存 symlink は実体へ解決する）。
#     ② readlink -f（同様に末尾欠損を許容し symlink を追う）。
#     ③ realpath（-m 非対応な古い実装向け）。
#   いずれも無い環境では空を返す（呼び出し側で symlink 実在時は fail-closed に倒す）。
#   純 bash の cd+pwd 代替は末尾 symlink を解決できない（basename が symlink 名のまま残る）ため、
#   ここでは採らない。この限界は呼び出し側の `-L` チェックで補償する（下記 R1 参照）。
# ---------------------------------------------------------------------------
r1_norm_path() {
  local p="$1"
  [[ -z "$p" ]] && return 0
  if command -v realpath &>/dev/null && realpath -m -- "." &>/dev/null; then
    realpath -m -- "$p" 2>/dev/null
  elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
    readlink -f -- "$p" 2>/dev/null
  elif command -v realpath &>/dev/null; then
    realpath -- "$p" 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# r1_has_extra_hardlink <path> — R1 carve-out 用のハードリンク簡易検知（best-effort）。
#   symlink と異なりハードリンクは「リンク先」を持たず realpath で実体をたどれないため、
#   carve-out 対象の doc 名の通常ファイルが実は workflow.db や memo と inode を共有している
#   （`ln workflow.db 00_要求定義.md` 等）ケースを完全に見分けることはシェルでは難しい。
#   ここでは実用的な信号として **st_nlink（ハードリンク数）> 1** を用い、doc として異常な
#   リンク数を持つ通常ファイルは carve-out を fail-closed で拒否する（allow せず R1 の通常 block へ）。
#   限界（is_sqlite3_invocation 等と同じく正直に明記）:
#     - 別名（相手側リンク）の実体までは列挙できないため、真に workflow.db 等を指すかまでは断定しない。
#       通常の issue doc は nlink==1 のため、実運用での誤 block はほぼ起きないが、
#       ごく稀に「意図的にハードリンクした正当な doc」も carve-out からは外れて block される。
#     - `stat` が無い環境ではこの検査を省略する（return 1＝追加リンク未検知）。真の防御は
#       symlink 実体解決（r1_norm_path）と R2/R3 の role 軸、CI audit が多層で担う。
# ---------------------------------------------------------------------------
r1_has_extra_hardlink() {
  local f="$1" n
  command -v stat &>/dev/null || return 1
  n="$(stat -c %h -- "$f" 2>/dev/null)"          # GNU: ハードリンク数
  [[ "$n" =~ ^[0-9]+$ ]] || n="$(stat -f %l -- "$f" 2>/dev/null)"   # BSD fallback
  [[ "$n" =~ ^[0-9]+$ ]] && (( n > 1 )) && return 0
  return 1
}

# ---------------------------------------------------------------------------
# r1_carveout_guard <path> — R1 carve-out 一致後の symlink/hardlink 実体すり替え検査（共通ヘルパ）。
#   doc allowlist carve-out・templates carve-out の双方から呼ぶ（重複排除・02_設計 ADR-3）。
#   carve-out で「編集して良い」と一致判定された後、対象パスの**実体**が実は保護対象
#   （memo/ 配下・workflow.db*）を指す symlink/hardlink であった場合に block する（善意の Edit/Write に
#   よる保護対象の破壊を防ぐ・事故防止。権限昇格の問題ではない）。判定は読み取り（realpath/stat）のみで
#   対象を一切変更しない（CQRS Query 側・副作用なし）。
#   分岐（既存 doc 分岐のインライン 4 分岐を振る舞い不変で移送）:
#     ① symlink 実在だが実体解決不能（realpath/readlink 不在等）＝検証不能 → 安全側で block。
#     ② 実体が /memo/ を含む または basename が workflow.db* → 保護対象すり替え → block。
#     ③ 通常ファイルで nlink>1（ハードリンクで保護対象と inode 共有の疑い）→ best-effort に block。
#     ④ いずれにも該当しなければ安全 → return 0（呼び出し側で no-op フォールスルー）。
#   block はここから呼んでよい（exit 2 で即終了する）。
# ---------------------------------------------------------------------------
r1_carveout_guard() {
  local path="$1" real real_base
  real="$(r1_norm_path "$path")"
  real_base="${real##*/}"
  if [[ -L "$path" && -z "$real" ]]; then
    # symlink は実在するが実体解決できない（realpath/readlink 不在等）＝検証不能。安全側で block。
    block "carve-out target is an unresolved symlink; refusing to follow / carve-out 対象が解決不能な symlink のため拒否します"
  elif [[ -n "$real" ]] && { [[ "$real" == *"/memo/"* ]] || [[ "$real_base" == workflow.db* ]]; }; then
    # symlink 実体が保護対象（memo 配下 / workflow.db*）を指している。block。
    block "carve-out target resolves to a protected path (memo/ or workflow.db*) via symlink / carve-out 対象の実体が保護パス（memo/ または workflow.db*）を指すため拒否します"
  elif [[ -f "$path" && ! -L "$path" ]] && r1_has_extra_hardlink "$path"; then
    # doc 名の通常ファイルが nlink>1＝ハードリンクで保護対象と inode 共有の疑い。best-effort に block。
    block "carve-out target is a hard link (nlink>1); refusing to follow / carve-out 対象がハードリンク（nlink>1）のため拒否します"
  fi
  return 0  # 安全（保護対象すり替えなし）。呼び出し側で no-op フォールスルー。
}

# ---------------------------------------------------------------------------
# parse_input — 唯一 stdin/env を読む入力層。TOOL / PATH_TARGET / CMD / ROLE を確定する。
#   stdin が JSON 様なら json_get で抽出、そうでなければ env を後方互換で読む。
# ---------------------------------------------------------------------------
parse_input() {
  # stdin を全量読込（配線が stdin を継承する前提。空なら即 env フォールバックへ）。
  RAW=""
  if [[ ! -t 0 ]]; then
    RAW="$(cat 2>/dev/null)"
  fi

  # ROLE 確定（C-4b: AGENT_ROLE の出所制御）。
  #   scribe を主張する呼び出しは、env 配線された実 nonce（AGENTS_SCRIBE_NONCE）が、
  #   **期待 nonce** と一致する場合のみ scribe として扱う。手動 export した AGENT_ROLE=scribe は
  #   実 nonce を知らないため不一致となり unknown へ降格する（= write-workflow-log.sh 実行を block）。
  #
  #   出所分離（HIGH 是正の核心）: 期待 nonce の出所を **実 nonce（env）と別経路**にする。
  #     優先順: ① ${AGENTS_ROOT}/.scribe-nonce ファイル（setup/enforce が 0600 で生成）を最優先で読む。
  #             ② ファイルが無い環境のみ AGENTS_EXPECTED_SCRIBE_NONCE（env・後方互換）を期待値に用いる。
  #     ファイルが存在する場合、env だけを掌握した相手は AGENTS_SCRIBE_NONCE と
  #     AGENTS_EXPECTED_SCRIBE_NONCE を同値に揃えても、期待値は **ファイル**から読むため一致できない
  #     （ファイルは 0600 で書けない）。これにより素朴な手動 export 偽装を遮断する。
  #   限界（正直化）: env 空間全体＋ファイル読取まで掌握された相手に対する完全防御ではない。
  #     最終保証は CI audit ＋ 外部証跡（NDJSON export / 署名 / append-only）が担う。
  #   nonce 配線が無い環境（消費者が未配線・後方互換）では、従来どおり AGENT_ROLE をそのまま採用する
  #   （主防御の nonce は opt-in。配線時のみ scribe 偽装を遮断する）。
  ROLE="${AGENT_ROLE:-${CLAUDE_AGENT_ROLE:-unknown}}"
  if [[ "$ROLE" == "scribe" ]]; then
    # 期待 nonce を **実 nonce と別出所**から確定する。
    #   ① ファイル出所（最優先・env と独立）: ${AGENTS_ROOT}/.scribe-nonce を読む。
    #   ② フォールバック（後方互換）: ファイルが無い場合のみ env の期待 nonce を用いる。
    expected_nonce=""
    nonce_file="${AGENTS_ROOT:-.agent-skill-chain/source}/.scribe-nonce"
    if [[ -f "$nonce_file" ]]; then
      # ファイル先頭行のみ採用（改行・余白を除去）。読めなければ空のまま（検証スキップ＝後方互換）。
      expected_nonce="$(head -n1 "$nonce_file" 2>/dev/null | tr -d '[:space:]')"
    else
      expected_nonce="${AGENTS_EXPECTED_SCRIBE_NONCE:-}"
    fi
    if [[ -n "$expected_nonce" ]]; then
      if [[ "${AGENTS_SCRIBE_NONCE:-}" != "$expected_nonce" ]]; then
        # nonce 不一致の scribe 主張は出所不明として降格（手動 export 偽装の遮断）。
        ROLE="unknown"
      fi
    fi
  fi

  # JSON 様判定: 先頭が { で tool_name を含む（軽量判定）。
  if [[ -n "$RAW" && "$RAW" == \{* && "$RAW" == *tool_name* ]]; then
    TOOL="$(json_get tool_name)"
    CMD="$(json_get command)"
    PATH_TARGET="$(json_get file_path)"
    # AGENT_ID: サブエージェント識別。stdin JSON のトップレベル .agent_id のみを参照する。
    AGENT_ID="$(json_get agent_id)"
  else
    # stdin 空/非 JSON → env 後方互換フォールバック。
    TOOL="${CLAUDE_TOOL_NAME:-${TOOL_NAME:-}}"
    PATH_TARGET="${CLAUDE_FILE_PATH:-${FILE_PATH:-}}"
    CMD="${CLAUDE_COMMAND:-${COMMAND:-}}"
    # env フォールバック経路では AGENT_ID を空に固定する。
    #   env 昇格 twin（CLAUDE_AGENT_ID 等）は意図的に設けない（ADR-2）。手動 export で
    #   IS_SUBAGENT=1 を自己申告できる経路を作らないことで worker 昇格の非自己申告性を担保する。
    #   stdin 空/非 JSON では IS_SUBAGENT=0（＝非 subagent・main 相当の保守側）に倒す。
    AGENT_ID=""
  fi

  # IS_SUBAGENT 確定（両経路共通）: agent_id 非空なら subagent worker（1）、空なら非 subagent（0）。
  IS_SUBAGENT=0
  [[ -n "$AGENT_ID" ]] && IS_SUBAGENT=1
}

parse_input

AGENTS_ROOT="${AGENTS_ROOT:-.agent-skill-chain/source}"
if [[ ! -d "$AGENTS_ROOT" ]]; then
  echo "[PreToolUse:info] .agents not found; skip contract check. / .agents が見つからないため契約チェックをスキップします（これは違反ではありません）。" >&2
  allow
fi

# 案内（常に表示・exit には影響しない）
#   prefix `[PreToolUse:info]` は「常時表示の案内であり、ツール呼び出しのブロック（違反）ではない」
#   ことを示す（FR-6・ADR-7）。実際の違反は `block()` の `[enforcement:block]` 行で出る。
#   各行は `<英語> / <日本語>` の日英併記（FR-7・ADR-8）。
if [[ -f "$AGENTS_ROOT/boot/CORE.md" ]]; then
  echo "[PreToolUse:info] This is always-shown guidance, not a block. / 以下は常時表示の案内であり、違反（ブロック）ではありません。" >&2
  echo "[PreToolUse:info] Ensure you have read: $AGENTS_ROOT/boot/CORE.md, $AGENTS_ROOT/boot/LOAD_POLICY.md, $AGENTS_ROOT/workflow/PHASES.md before starting workflow or running a command. / workflow やコマンド開始前に上記を読んでください。" >&2
  echo "[PreToolUse:info] Main (orchestrator) must NOT do real work (absolute): do not directly edit 00/01/02/03/04 or code. Always delegate via Task/Constraints/OutputSpec to sub. No exceptions. / メイン（orchestrator）は実作業（00/01/02/03/04・コードの直接編集）をしてはいけません（絶対）。必ずサブへ委譲してください。" >&2
  echo "[PreToolUse:info] Evidence: workflow.db via write-workflow-log.sh only. Do NOT run sqlite3 directly. 書記は write-workflow-log.sh のみ実行可。sqlite3 直接は全ロールで reject。Memo timestamps must come from system clock (new-workflow-memo.sh or write-workflow-log)." >&2
fi

# ---------------------------------------------------------------------------
# Runtime enforcement（reject 判定群）: 確定変数 TOOL/PATH_TARGET/CMD/ROLE のみ参照する。
# 入力が取れない（TOOL も CMD も空）場合は保守的に倒す（BR-4: 違反確証なしは reject しない）。
# ---------------------------------------------------------------------------
if [[ -n "$TOOL" ]]; then
  # R1. .workflow 配下への直接 Write/Edit 禁止（全 ROLE・ただし保護対象を絞った allowlist 方式）
  #   例外1（ADR-3）: 対象パスが厳密に .agent-skill-chain/runtime/.gitignore と一致する場合のみ許可する。
  #   配布漏れの自己修復用の正規手段。前方一致・正規表現の緩いマッチではなくファイル名までの完全一致で判定する。
  #   例外2（ADR-1/ADR-2・02_設計 参照）: R1 の本来の保護対象は memo（YYYYMMDD_HHMMSS_*.md のタイムスタンプ
  #   整合性）と workflow.db*（書記のみが書く DB 書込整合性）の2点であり、00_要求定義.md 等の issue ドキュメント
  #   自体はこの保護を必要としない（内容の真正性は Bash 経由でも Edit/Write 経由でも同じ）。したがって、
  #   basename が ALLOWED_DOC_BASENAMES に厳密一致し、かつパスが /memo/ を含まない場合のみ allow する。
  #   この allow 判定は既存の .gitignore 例外と同じ **no-op（フォールスルー）** で実装し、allow()（exit 0 の
  #   早期終了）は使わない。フォールスルーにすることで、carve-out に一致した後も後続の R2（ROLE=orchestrator
  #   かつ IS_SUBAGENT!="1" の Edit/Write 拒否）が必ず評価され、orchestrator（main）自身の直接編集は carve-out
  #   の有無に関わらず引き続き block される（R2 との独立性を保つための必須の実装制約）。
  #   ALLOWED_DOC_BASENAMES に含まれないファイル（memo・workflow.db* を含む）への禁止は一切広げない。
  #
  #   symlink/hardlink 実体すり替え耐性（CodeRabbit PR#92 指摘対応）:
  #     文字列 basename だけを見ると、doc 名（例 00_要求定義.md）の **symlink** が実体として memo 配下や
  #     workflow.db* を指していた場合、通常の（善意の）Edit/Write が気づかず実体を破壊しうる（権限昇格では
  #     なく事故防止の問題。R1 本来の目的＝memo タイムスタンプ整合性・workflow.db 書込整合性の保護は、事前に
  #     仕込まれた symlink 経由の書換からも守られるべき）。そこで basename が allowlist に一致した後、
  #     r1_norm_path で **realpath 解決した実体パス**を再検査し、解決先が (a) /memo/ を含む または
  #     (b) basename が workflow.db* に一致するなら block する。symlink が既に存在するのに解決できない場合も
  #     （検証不能＝安全側で）block する。hardlink は実体をたどれないため r1_has_extra_hardlink で
  #     nlink>1 の異常リンク数を best-effort に検知して block する（限界は各関数コメント参照）。
  #   例外3（ADR-1/ADR-2/ADR-4・02_設計「templates carve-out」参照）: 対象パスが配布物テンプレート置き場
  #   .agent-skill-chain/runtime/templates/ 配下（かつ /memo/ を含まない）の場合も allow する。templates/ は
  #   npm 配布物（追跡対象）でありながら runtime/ 名前空間の配下に置かれるため R1 の一律 block と重なるが、
  #   memo（タイムスタンプ整合性）・workflow.db*（書込整合性）のような**保護目的を持たない**（配布物の真正性は
  #   Bash 経由でも Edit/Write 経由でも同じ）。そのため basename によらず templates/ 配下全体を編集手段として
  #   統一する。判定は basename allowlist ではなく **path-prefix**（`.agent-skill-chain/runtime/templates/`・
  #   末尾スラッシュ付き）とする。理由: templates/ 配下には README.md・00_README.md 等の汎用 basename が多数あり、
  #   basename 方式だと消費者の他 issue フォルダの同名ファイルにも allow が波及するため（ADR-2）。末尾スラッシュ
  #   により `templates-evil/`・`mytemplates/` 等の別名ディレクトリを誤マッチさせない。/memo/ 除外は doc 分岐と
  #   対称の防御で保護範囲を広げないため（ADR-4）。この carve-out も no-op（フォールスルー）で実装し allow() を
  #   使わない（R2 独立性の必須制約）。symlink/hardlink すり替え耐性は doc 分岐と共通の r1_carveout_guard が担う。
  ALLOWED_DOC_BASENAMES="00_要求定義.md 00_システム理解.md 01_要件定義.md 02_設計.md 03_実装計画.md 04_review.md 05_最終確認チェックリスト.md 90_issues.md 99_PR.md 99_PR_review.md"
  if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]]; then
    if [[ "$PATH_TARGET" == ".agent-skill-chain/runtime/.gitignore" ]] || [[ "$PATH_TARGET" == */.agent-skill-chain/runtime/.gitignore ]]; then
      : # allow（厳密パス一致の狭い例外。R1 の他条件には進まない）
    elif { [[ "$PATH_TARGET" =~ \.agent-skill-chain/runtime/templates/ ]] || [[ "$PATH_TARGET" =~ /\.agent-skill-chain/runtime/templates/ ]]; } && [[ "$PATH_TARGET" != *"/memo/"* ]]; then
      # templates carve-out（path-prefix・末尾スラッシュで別名ディレクトリを誤マッチ除外・/memo/ 除外）。
      # doc 分岐と共通のヘルパで symlink/hardlink 実体すり替えを検査し、安全なら no-op フォールスルー（R2 独立性維持）。
      r1_carveout_guard "$PATH_TARGET"
      : # allow（templates carve-out・no-op フォールスルーで後続 R2 評価を妨げない）
    elif [[ "$PATH_TARGET" =~ \.agent-skill-chain/runtime/ ]] || [[ "$PATH_TARGET" =~ /\.agent-skill-chain/runtime/ ]]; then
      R1_BASENAME="${PATH_TARGET##*/}"
      R1_DOC_ALLOWED=0
      for r1_name in $ALLOWED_DOC_BASENAMES; do
        if [[ "$R1_BASENAME" == "$r1_name" ]]; then
          R1_DOC_ALLOWED=1
          break
        fi
      done
      if [[ "$R1_DOC_ALLOWED" == "1" ]] && [[ "$PATH_TARGET" != *"/memo/"* ]]; then
        # carve-out 候補。symlink/hardlink による実体すり替えを共通ヘルパで再検査する（振る舞い不変・ADR-3）。
        r1_carveout_guard "$PATH_TARGET"
        : # allow（issue ドキュメントの carve-out・no-op フォールスルーで後続 R2 評価を妨げない）
      else
        block "direct edit of .agent-skill-chain/runtime/ is forbidden / .agent-skill-chain/runtime/ の直接編集は禁止です"
      fi
    fi
  fi

  # R2 / R2'. orchestrator（main 限定）: 許可ツールのみ（allowlist）。それ以外は拒否。
  #    許可: Read, Grep, Glob, LS, list_dir, Task, Agent, mcp_task 等「読む・検索・委譲」のみ。
  #    委譲ツールの実名はハーネスで異なる（Agent SDK 系は Task、Claude Code CLI / FleetView 系は Agent）。
  #    両名を許可に残さないと、実機側の委譲ツールが下の *) に落ちて拒否され、orchestrator が委譲手段ごと
  #    自己ロックアウトする（Agent 名のみの環境で実際に発生済み）。互換のため Task と Agent の両方を許可する。
  #    main 限定化（IS_SUBAGENT != 1）: 委譲先サブエージェント（agent_id あり）は継承 orchestrator を
  #    上書きして worker として実作業（Edit/Write）を許可するため、本 allowlist の対象外にする。
  #    scribe は ROLE!=orchestrator のため本 R2 の対象外（scribe 経路は R3 以降で判定）。
  if [[ "$ROLE" == "orchestrator" && "$IS_SUBAGENT" != "1" ]]; then
    case "$TOOL" in
      Read|Grep|Glob|LS|list_dir|Task|Agent|Skill|mcp_task|ReadLints|fetch_mcp_resource|list_mcp_resources|AskUserQuestion)
        # allowed（R2'）
        #   AskUserQuestion: 読み取り専用・非破壊のユーザー対話ツール。ファイル変更・コード実行を伴わず、
        #   CORE.md §メインエージェントがやってはいけないこと（ファイル作成/編集/コード実装/設計本文/
        #   レビュー本文/テスト作成/コマンド実行）に非該当のため orchestrator に許可する（FR-1・ADR-1）。
        #   Skill: 本フレームワークの command 実行の正規入口（.claude/skills/agent 経由の skill chain 呼び出し）。
        #   orchestrator が委譲経路として Skill を使う配備（CLAUDE.md「command 実行時は run_command と
        #   commands/{name}.md を読むこと」）で、本 allowlist に無いと *) で fail-closed ブロックされ、
        #   Agent 名未対応時と同型の自己ロックアウトが起きる。ツール名レベルの判定しかできないため
        #   Task/Agent と同水準で許可する（呼び出し先 skill 種別の絞り込みは本 hook の対象外）。
        #   注: ハーネス組み込みツールの追加時は、Agent/Skill（本注記）と同様に allowlist 追従漏れによる
        #   自己ロックアウトが起こりうる。同種ツール追加時は本 allowlist の追従を検討すること。
        :
        ;;
      Bash)
        block "orchestrator cannot run Bash / orchestrator は Bash を実行できません"
        ;;
      Edit|Write|Delete|StrReplace|Shell|TodoWrite|EditNotebook|call_mcp_tool|GenerateImage)
        block "orchestrator must never modify files or run write/edit/shell (absolute). Delegate to sub only. No exceptions. / orchestrator はファイル変更・write/edit/shell の実行をしてはいけません（絶対）。サブへ委譲してください。例外はありません。"
        ;;
      *)
        # 未知のツールは原則 orchestrator には許可しない（許可リスト方式・fail-closed）。
        #   ただし project 固有 opt-in 拡張（.agent-skill-chain/project/orchestrator-allowlist.txt）に
        #   厳密一致で列挙されたツール名のみ許可する（FR-4・ADR-3/ADR-4）。
        #   重要: Bash・Edit|Write|... はこの *) より手前の case で block されるため、拡張では覆せない
        #   （明示拒否**名**の保証。ただし能力=capability の保証ではない。ADR-3 帰結・SETUP.md 参照）。
        if is_in_project_allowlist "$TOOL"; then
          : # project opt-in で許可
        else
          block "orchestrator may only use allowed tools (Read, Grep, Glob, LS, Task, etc.): $TOOL / orchestrator は許可ツール（Read, Grep, Glob, LS, Task 等）のみ使用できます: $TOOL"
        fi
        ;;
    esac
  fi
fi

# R3 / R4 / R5. Bash 実行の判定（判定順が重要）。
#   (a) scribe（nonce 検証済み）を最優先: write-workflow-log.sh 単独のみ許可（R6先行/R4/R5）。
#       scribe が委譲サブエージェント（agent_id あり）を伴っても worker allow に落とさず、
#       scribe 専用の R4/R5 制約を無条件に受けさせる（§8.1 の scribe 保証を無条件化）。
#   (b) 非 scribe の subagent worker（IS_SUBAGENT=1）は Bash を allow（scribe 専用 R4/R5 に入れない。
#       sqlite3 は下流の全ロール R6 で block される）。
#   (c) main（orchestrator かつ IS_SUBAGENT!=1）は Bash 不可で block。
#   (d) それ以外（非 scribe・非 subagent・非 orchestrator＝unknown/env-worker 等）は従来どおり block。
if [[ "$TOOL" == "Bash" ]]; then
  if [[ "$ROLE" == "scribe" ]]; then
    # (a) scribe 最優先: 従来の R6先行/R4/R5 を適用する。
    # CMD が取れていない場合のみ保守的に通す（複合シェル/単独実行の確証なし）。
    if [[ -n "$CMD" ]]; then
      # R6（先行）. sqlite3 直接実行禁止（全 ROLE）。role 共通の明確な理由を優先表示するため
      #            scribe の write-workflow-log.sh 単独実行制約（R5）より前に判定する。
      #            判定はコマンド名としての起動のみを見る is_sqlite3_invocation に委譲する
      #            （`grep sqlite3 ...` 等の引数中の言及を誤ブロックしないため）。
      if is_sqlite3_invocation "$CMD"; then
        block "sqlite3 direct execution forbidden (use write-workflow-log.sh) / sqlite3 の直接実行は禁止です（write-workflow-log.sh を使用してください）"
      fi
      # R4. 複合シェル禁止（改行・;・&&・||・|）
      case "$CMD" in
        *$'\n'*|*';'*|*'&&'*|*'||'*|*'|'* )
          block "compound shell command forbidden / 複合シェルコマンドは禁止です"
          ;;
      esac
      # R5. write-workflow-log.sh は単独実行のみ（C-4a: 正規化済み絶対パス比較で回避ベクタを塞ぐ）。
      #   ①第 1 トークンを取り出し、②realpath（無ければ readlink -f、無ければ cd+pwd）で正規化済み絶対パスへ解決、
      #   ③その実体パスが「許可正本パス＝実行 cwd 起点の配備先 .agent-skill-chain/source/scripts/write-workflow-log.sh を
      #     realpath 解決した値」と一致することを要求する。固定文字列はハードコードしない（消費者配備先で誤 block
      #     しないため・N-E）。相対パス（./...）は realpath 正規化で同一判定へ収れんし、symlink で別実体を
      #     指す同名スクリプトは実体 realpath 不一致で block、bash -c "..." は第 1 トークンが bash になり不一致で block。
      norm_path() {
        local p="$1"
        [[ -z "$p" ]] && return 0
        if command -v realpath &>/dev/null; then
          realpath "$p" 2>/dev/null
        elif command -v readlink &>/dev/null && readlink -f -- "." &>/dev/null; then
          readlink -f "$p" 2>/dev/null
        elif [[ -e "$p" ]]; then
          ( cd "$(dirname "$p")" 2>/dev/null && printf '%s/%s' "$(pwd)" "$(basename "$p")" )
        fi
      }
      first_token="$(echo "$CMD" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]].*//')"
      resolved="$(norm_path "$first_token")"
      # 許可正本パス: 実行 cwd 起点の配備先を realpath 解決（実行時算出・固定文字列禁止）。
      canonical_wwl="$(norm_path "${AGENTS_ROOT}/scripts/write-workflow-log.sh")"
      if [[ -z "$resolved" ]] || [[ -z "$canonical_wwl" ]] || [[ "$resolved" != "$canonical_wwl" ]]; then
        block "only the canonical write-workflow-log.sh (realpath of \$AGENTS_ROOT/scripts/write-workflow-log.sh) may be run directly / 正規の write-workflow-log.sh（\$AGENTS_ROOT/scripts/write-workflow-log.sh の realpath）のみ直接実行できます"
      fi
    fi
  elif [[ "$IS_SUBAGENT" == "1" ]]; then
    # (b) 非 scribe の subagent worker（agent_id あり）: Bash allow。
    #     scribe 専用の R4/R5 制約には入れない。sqlite3 直接実行は下流の全ロール R6 で block される。
    :
  elif [[ "$ROLE" == "orchestrator" ]]; then
    # (c) main（orchestrator かつ 非 subagent）: Bash 不可。
    block "orchestrator cannot run Bash / orchestrator は Bash を実行できません"
  else
    # (d) 非 scribe・非 subagent・非 orchestrator（unknown/env-worker 等）は従来どおり block。
    block "only scribe may run Bash for workflow logging / Bash 実行は workflow 記録の scribe のみ可能です"
  fi
fi

# R6. sqlite3 直接実行禁止（全 ROLE・wrapper のみ許可）
#     判定はコマンド名としての起動のみを見る is_sqlite3_invocation に委譲する
#     （`grep sqlite3 ...` 等の引数中の言及を誤ブロックしないため）。
if [[ -n "$CMD" ]]; then
  if is_sqlite3_invocation "$CMD"; then
    block "sqlite3 direct execution forbidden (use write-workflow-log.sh)"
  fi
fi

# R7. worktree/ブランチ命名規則の Tier1 機械強制（B・ADR-2/ADR-3）。
#   TOOL=Bash かつ CMD 非空のときのみ評価（ROLE 非依存）。作成形（worktree add / switch -c/-C /
#   checkout -b/-B / branch <name>）と確定でき、かつ命名規則違反のときのみ block（exit 2・fail-closed）。
#   listing/削除/rename・曖昧・対象外・非 git は allow（worktree_name_enforce 内で自然に素通り＝fail-open）。
if [[ "$TOOL" == "Bash" && -n "$CMD" ]]; then
  worktree_name_enforce "$CMD"
fi

# R8. 削除前 untracked 退避（C・ADR-5）。TOOL=Bash かつ CMD 非空のときのみ評価。
#   削除形（worktree remove〈--force 含む〉/ clean -x|-X / clean が .worktree 対象）の前に untracked を
#   退避先へ copy 保全する（block しない・保全のみ）。untracked なし/対象外/内部エラー/退避失敗は allow。
if [[ "$TOOL" == "Bash" && -n "$CMD" ]]; then
  worktree_destroy_rescue "$CMD"
fi

allow
