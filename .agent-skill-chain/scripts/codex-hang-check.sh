#!/usr/bin/env bash
# Issue #336: codex-companionが起動するバックグラウンドプロセス（app-server-broker.mjs・
# codex app-server・codex-code-mode-host等）のハング（経過時間が進んでもCPU時間が実質増加しない
# 停止状態）を、進行役が機械的に検知・安全に終了するための補助スクリプト。
#
# 運用手順の正本は .agent-skill-chain/standards/CODEX_BACKGROUND_TASK_POLICY.md であり、
# 本スクリプトはその手順を再現可能にする軽量な補助にすぎない。agent-skill-chain CLI の
# セグメント/ゲートドメイン（bin/agents-md.js）には属さないため、他の .agent-skill-chain/scripts/
# 配下スクリプトと異なりCLIサブコマンドへのラッパーではなく、本ファイル自体が実装本体である。

set -euo pipefail

DEFAULT_PATTERN='app-server-broker\.mjs|codex app-server|codex-code-mode-host'

usage() {
  cat <<'EOF'
使い方:
  codex-hang-check.sh check   [--pattern REGEX] [--min-elapsed-seconds N] [--max-cpu-seconds N] [--cwd PATH] [--ps-output FILE] [--cwd-map FILE]
  codex-hang-check.sh compare --before FILE --after FILE [--pattern REGEX] [--min-elapsed-delta N] [--max-cpu-delta N] [--cwd PATH] [--cwd-map FILE]
  codex-hang-check.sh kill    --cwd PATH [--pattern REGEX] [--pid PID[,PID...]] [--dry-run] [--ps-output FILE] [--cwd-map FILE]

check:    `ps -eo pid,etimes,cputimes,args` を1回サンプリングし、経過時間(etimes)が
          --min-elapsed-seconds 以上かつ累積CPU時間(cputimes)が --max-cpu-seconds 以下の
          プロセスを「ハング候補」として報告する（初動の一次スクリーニング用）。
          終了コード: 0=候補無し、1=候補あり、2=使い方エラー。

compare:  間隔を空けて取得した2つの ps スナップショット（--before/--after、いずれも
          `ps -eo pid,etimes,cputimes,args` の生出力）を比較し、経過時間の差分が
          --min-elapsed-delta 以上進んだのに累積CPU時間の差分が --max-cpu-delta 以下の
          プロセスを「ハング確定」として報告する。
          終了コード: 0=確定無し、1=確定あり、2=使い方エラー。

kill:     --cwd で指定したディレクトリを起動時cwdに持つ、patternに一致するプロセスのみを
          対象に SIGTERM を送る。--cwd は必須（無関係な別セッションを誤って停止させないため）。
          --pid で対象PIDをさらに絞り込める。--dry-run を付けると実際には送信せず対象一覧のみ
          表示する（既定でも --dry-run 相当のプレビュー行を先に出力してから送信する）。
          実機の `ps` を対象にする場合、本スクリプトの実行プロセス自身の祖先プロセスは
          pattern・cwdが一致していても対象から自動的に除外する（安全弁）。
          終了コード: 0=1件以上終了、1=対象無し（安全側のno-op）、2=使い方エラー。

いずれのサブコマンドも --pattern 省略時は既定で以下にマッチする:
  app-server-broker.mjs / codex app-server / codex-code-mode-host

check・compare の --cwd は任意だが、指定すると起動時cwdが一致するプロセスのみを判定対象にする。
待機中で本来CPU時間が伸びない他セッションの正当なプロセス（例: 別Issueで起動中のサーバ）を
誤ってハング候補と報告しないため、確認対象の worktree パスを常に指定することを推奨する。

--ps-output / --cwd-map はテスト・CI からの入力モック用フックであり、通常運用では省略して
実機の `ps` / `/proc/<pid>/cwd` を使う。
EOF
}

# ps -eo pid,etimes,cputimes,args の生出力を「pid etimes cputimes cmd」の4列（cmdは元の空白を
# 保持したまま）へ正規化する。先頭3列は数値幅にかかわらずawkのフィールド分割で確実に取り出せる。
normalize_ps() {
  awk '{
    pid=$1; etimes=$2; cputimes=$3;
    cmd=$0;
    sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", cmd);
    if (pid ~ /^[0-9]+$/) print pid, etimes, cputimes, cmd;
  }'
}

sample_ps() {
  local ps_output_file="$1"
  if [[ -n "$ps_output_file" ]]; then
    cat "$ps_output_file"
  else
    ps -eo pid,etimes,cputimes,args
  fi
}

resolve_cwd() {
  local pid="$1" cwd_map_file="$2"
  if [[ -n "$cwd_map_file" ]]; then
    awk -v p="$pid" '$1==p {$1=""; sub(/^ /,""); print; found=1} END{if(!found) exit 1}' "$cwd_map_file"
    return
  fi
  readlink -f "/proc/$pid/cwd" 2>/dev/null
}

# 本スクリプト自身（$$）の親プロセス連鎖に candidate が含まれるかを判定する。実機の `ps`
# （--ps-output 未指定）を対象にkillする場合のみ使う安全弁。pattern一致とcwd一致だけでは
# 「呼び出し元シェルの引数文字列に検索patternが偶然含まれ、かつcwdも一致してしまう」場合
# （例: シェルラッパーが実行中スクリプト本文をそのまま自身の引数として保持し、その本文に
# たまたま検索patternの文字列が含まれる）に、進行役自身の実行プロセスを誤って終了させ得る
# ことを実機検証で確認したため導入する（Issue #336 手動検証）。
is_ancestor_of_self() {
  local candidate="$1"
  local pid=$$
  while [[ "$pid" -gt 1 ]]; do
    if [[ "$pid" == "$candidate" ]]; then
      return 0
    fi
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -z "$pid" ]] && break
  done
  return 1
}

# Issue #551: 数値オプション（--min-elapsed-seconds等）はこの後bashの算術評価
# コンテキスト（(( etimes >= min_elapsed && ... ))）へそのまま渡る。算術評価は
# 変数値に含まれる `$(...)` 形式のコマンド置換を実行しうるため、算術評価へ渡す前に
# 非負の十進整数のみであることを検証し、不正な場合は使い方エラーで拒否する。
require_uint() {
  local sub="$1" opt="$2" value="$3"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "$sub: $opt には非負の整数を指定してください（実際の値: ${value}）" >&2
    usage >&2
    exit 2
  fi
}

# Issue #551: --before/--after/--ps-output で指定したファイルが存在しない・読めない
# 場合、grepの「不一致」（終了コード1、空結果として正常系）と区別せず「候補なし」を
# 誤って返してしまう既知の不具合を防ぐため、内容を処理する前にファイルの存在・可読性を
# 検証する。値が空文字列（未指定）の場合は検証をスキップする（実機の`ps`を使う等の
# 意図的な省略と区別するため）。
require_readable_file() {
  local sub="$1" opt="$2" file="$3"
  if [[ -n "$file" && ! -r "$file" ]]; then
    echo "$sub: $opt に指定されたファイルが存在しないか読み取れません: $file" >&2
    usage >&2
    exit 2
  fi
}

cmd_check() {
  local pattern="$DEFAULT_PATTERN" min_elapsed=600 max_cpu=1 ps_output="" target_cwd="" cwd_map=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pattern) pattern="$2"; shift 2 ;;
      --min-elapsed-seconds) min_elapsed="$2"; shift 2 ;;
      --max-cpu-seconds) max_cpu="$2"; shift 2 ;;
      --ps-output) ps_output="$2"; shift 2 ;;
      --cwd) target_cwd="$2"; shift 2 ;;
      --cwd-map) cwd_map="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "check: 不明な引数: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
  require_uint check --min-elapsed-seconds "$min_elapsed"
  require_uint check --max-cpu-seconds "$max_cpu"
  require_readable_file check --ps-output "$ps_output"
  [[ -n "$target_cwd" ]] && target_cwd="$(readlink -f "$target_cwd" 2>/dev/null || echo "$target_cwd")"

  local found=0
  while read -r pid etimes cputimes cmd; do
    [[ -z "$pid" ]] && continue
    if [[ -n "$target_cwd" ]]; then
      local pid_cwd
      pid_cwd="$(resolve_cwd "$pid" "$cwd_map" || true)"
      [[ "$pid_cwd" != "$target_cwd" ]] && continue
    fi
    if (( etimes >= min_elapsed && cputimes <= max_cpu )); then
      echo "HANG候補 pid=$pid etimes=${etimes}s cputimes=${cputimes}s cmd=$cmd"
      found=1
    fi
  done < <(sample_ps "$ps_output" | grep -E "$pattern" | grep -v grep | normalize_ps)

  if [[ "$found" -eq 1 ]]; then
    exit 1
  fi
  echo "ハング候補なし（pattern=$pattern, min_elapsed=${min_elapsed}s, max_cpu=${max_cpu}s, cwd=${target_cwd:-指定無し}）"
  exit 0
}

cmd_compare() {
  local pattern="$DEFAULT_PATTERN" min_elapsed_delta=600 max_cpu_delta=0 before="" after="" target_cwd="" cwd_map=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pattern) pattern="$2"; shift 2 ;;
      --min-elapsed-delta) min_elapsed_delta="$2"; shift 2 ;;
      --max-cpu-delta) max_cpu_delta="$2"; shift 2 ;;
      --before) before="$2"; shift 2 ;;
      --after) after="$2"; shift 2 ;;
      --cwd) target_cwd="$2"; shift 2 ;;
      --cwd-map) cwd_map="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "compare: 不明な引数: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
  require_uint compare --min-elapsed-delta "$min_elapsed_delta"
  require_uint compare --max-cpu-delta "$max_cpu_delta"
  if [[ -z "$before" || -z "$after" ]]; then
    echo "compare: --before と --after は必須" >&2
    usage >&2
    exit 2
  fi
  require_readable_file compare --before "$before"
  require_readable_file compare --after "$after"
  [[ -n "$target_cwd" ]] && target_cwd="$(readlink -f "$target_cwd" 2>/dev/null || echo "$target_cwd")"

  local tmp_before tmp_after
  tmp_before="$(mktemp)"
  tmp_after="$(mktemp)"
  # `exit` はプロセスを直ちに終了させ関数のRETURNトラップを経由しないため、EXITトラップで
  # 一時ファイルを回収する（このサブコマンド内でしかmktempを使わないため他処理と競合しない）。
  trap 'rm -f "$tmp_before" "$tmp_after"' EXIT
  # Issue #542: 対象パターンに1件も一致しない（＝監視対象自体が無い、最も一般的で健全な状態）
  # 場合、grepは終了コード1を返す。set -euo pipefail下ではこれがパイプライン全体を非ゼロ終了
  # させ、本来のハング判定ロジックに到達する前にスクリプトが打ち切られ「ハング確定なし」を
  # 「ハング確定あり」と誤検知する。grepの不一致は空結果の正常系として扱い、実際のハング検知
  # 時の比較ロジック・終了コード契約（下記found変数によるexit 0/1）は変更しない。
  { grep -E "$pattern" "$before" || true; } | { grep -v grep || true; } | normalize_ps | sort -k1,1n > "$tmp_before"
  { grep -E "$pattern" "$after" || true; } | { grep -v grep || true; } | normalize_ps | sort -k1,1n > "$tmp_after"

  local found=0
  while read -r pid et1 ct1 cmd; do
    [[ -z "$pid" ]] && continue
    if [[ -n "$target_cwd" ]]; then
      local pid_cwd
      pid_cwd="$(resolve_cwd "$pid" "$cwd_map" || true)"
      [[ "$pid_cwd" != "$target_cwd" ]] && continue
    fi
    local line2 et2 ct2
    line2="$(awk -v p="$pid" '$1==p {print; exit}' "$tmp_after")"
    [[ -z "$line2" ]] && continue
    read -r _ et2 ct2 _ <<<"$line2"
    local elapsed_delta=$(( et2 - et1 ))
    local cpu_delta=$(( ct2 - ct1 ))
    if (( elapsed_delta >= min_elapsed_delta && cpu_delta <= max_cpu_delta )); then
      echo "HANG確定 pid=$pid elapsed_delta=${elapsed_delta}s cpu_delta=${cpu_delta}s cmd=$cmd"
      found=1
    fi
  done < "$tmp_before"

  if [[ "$found" -eq 1 ]]; then
    exit 1
  fi
  echo "ハング確定なし（pattern=$pattern, min_elapsed_delta=${min_elapsed_delta}s, max_cpu_delta=${max_cpu_delta}s, cwd=${target_cwd:-指定無し}）"
  exit 0
}

cmd_kill() {
  local pattern="$DEFAULT_PATTERN" target_cwd="" pid_filter="" dry_run=0 ps_output="" cwd_map=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pattern) pattern="$2"; shift 2 ;;
      --cwd) target_cwd="$2"; shift 2 ;;
      --pid) pid_filter="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      --ps-output) ps_output="$2"; shift 2 ;;
      --cwd-map) cwd_map="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "kill: 不明な引数: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
  if [[ -z "$target_cwd" ]]; then
    echo "kill: --cwd は必須（無関係な別セッションのプロセスを誤って停止させないための安全策）" >&2
    usage >&2
    exit 2
  fi
  require_readable_file kill --ps-output "$ps_output"
  target_cwd="$(readlink -f "$target_cwd" 2>/dev/null || echo "$target_cwd")"

  declare -A pid_allow=()
  if [[ -n "$pid_filter" ]]; then
    IFS=',' read -ra ids <<<"$pid_filter"
    for id in "${ids[@]}"; do pid_allow["$id"]=1; done
  fi

  local -a targets=()
  while read -r pid etimes cputimes cmd; do
    [[ -z "$pid" ]] && continue
    if [[ -n "$pid_filter" && -z "${pid_allow[$pid]:-}" ]]; then
      continue
    fi
    local pid_cwd
    pid_cwd="$(resolve_cwd "$pid" "$cwd_map" || true)"
    if [[ "$pid_cwd" != "$target_cwd" ]]; then
      continue
    fi
    # 実機の `ps` を対象にする場合のみ、本スクリプトの実行プロセス自身の祖先を安全弁として除外する
    # （--ps-output 指定時はテスト用の架空PIDであり実プロセス木と無関係なため対象外）。
    if [[ -z "$ps_output" ]] && is_ancestor_of_self "$pid"; then
      echo "対象外（安全弁）: pid=$pid は本スクリプト実行プロセス自身の祖先のため終了しない" >&2
      continue
    fi
    targets+=("$pid")
    echo "対象 pid=$pid etimes=${etimes}s cputimes=${cputimes}s cwd=$pid_cwd cmd=$cmd"
  done < <(sample_ps "$ps_output" | grep -E "$pattern" | grep -v grep | normalize_ps)

  if [[ "${#targets[@]}" -eq 0 ]]; then
    echo "kill: cwd=$target_cwd に一致するpattern一致プロセスは無し（何も終了しない）" >&2
    exit 1
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    echo "--dry-run のため実際の送信はしない"
    exit 0
  fi

  for pid in "${targets[@]}"; do
    kill -TERM "$pid" 2>/dev/null || echo "kill: pid=$pid へのSIGTERM送信に失敗（既に終了済みの可能性）" >&2
  done
  exit 0
}

main() {
  local sub="${1:-}"
  if [[ $# -gt 0 ]]; then shift; fi
  case "$sub" in
    check) cmd_check "$@" ;;
    compare) cmd_compare "$@" ;;
    kill) cmd_kill "$@" ;;
    -h|--help|"") usage; [[ -z "$sub" ]] && exit 2 || exit 0 ;;
    *) echo "不明なサブコマンド: $sub" >&2; usage >&2; exit 2 ;;
  esac
}

main "$@"
