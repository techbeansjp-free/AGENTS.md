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
  # R1. .workflow 配下への直接 Write/Edit 禁止（全 ROLE）
  #   例外（ADR-3）: 対象パスが厳密に .agent-skill-chain/runtime/.gitignore と一致する場合のみ許可する。
  #   配布漏れの自己修復用の正規手段。前方一致・正規表現の緩いマッチではなくファイル名までの完全一致で
  #   判定し、他の runtime/ 配下ファイル（workflow.db*・issue ドキュメント等）への禁止は一切広げない。
  if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]]; then
    if [[ "$PATH_TARGET" == ".agent-skill-chain/runtime/.gitignore" ]] || [[ "$PATH_TARGET" == */.agent-skill-chain/runtime/.gitignore ]]; then
      : # allow（厳密パス一致の狭い例外。R1 の他条件には進まない）
    elif [[ "$PATH_TARGET" =~ \.agent-skill-chain/runtime/ ]] || [[ "$PATH_TARGET" =~ /\.agent-skill-chain/runtime/ ]]; then
      block "direct edit of .agent-skill-chain/runtime/ is forbidden / .agent-skill-chain/runtime/ の直接編集は禁止です"
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

allow
