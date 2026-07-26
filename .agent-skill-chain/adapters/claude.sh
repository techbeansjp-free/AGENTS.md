#!/usr/bin/env bash
# 正本: AGENTS.md §GitHub配布・マルチAI対応 / .agent-skill-chain/config/roles.yaml
#
# ベンダー中立の role contract（.agent-skill-chain/config/roles.yaml）を実行系（Claude Code / Claude Agent SDK 経由の起動）へ
# 変換するアダプタ。lease・commit・test・report等の状態操作系関数は .agent-skill-chain/scripts/*.sh
# （agent-skill-chain CLIへの薄いラッパー）へ結線済み。ゲートレビュアの起動は launch_gate_reviewer、
# セグメント作業ワーカー（spec/design/implementation/validation）の起動は launch_worker として
# いずれも実装済み（#166）。

set -euo pipefail

ADAPTER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SCRIPTS_DIR="$ADAPTER_DIR/../scripts"
REPO_ROOT="$(cd -- "$ADAPTER_DIR/../.." &>/dev/null && pwd)"

# launch_worker の既定起動系（WORKER_CMD 未指定時）が claude CLI へ渡す --allowed-tools の既定値
# （ワーカーの正規責務範囲——自worktree内ファイル編集、自branchへのcommit/push、Draft PR作成
# （specセグメントのみ想定）、テスト実行、report/lease/checkpoint 各スクリプト実行——
# のみに限定したallowlist）。列挙外はヘッドレスで拒否される（安全側 fail）。無制限自動承認
# （--permission-mode bypassPermissions）は既定に用いない。env WORKER_ALLOWED_TOOLS で完全上書き可能
# （grep可能な名前付き変数として定義。採用理由・却下案との比較は DESIGN.md（ISSUE-183）
# 「権限付与方式の設計判断」参照）。
#
# Issue #188 AC-5/AC-6: `Bash(gh pr create:*)` は既定allowlistから除外している。Draft PR作成の
# 正規経路は `.agent-skill-chain/scripts/pr-create.sh`（agent-skill-chain CLI `pr create`
# サブコマンド）であり、PRテンプレート各節を自動充填したうえで `gh pr create` を実行する
# （src/commands/pr.ts buildIssueBody）。このラッパーは `Bash(.agent-skill-chain/scripts/*)` /
# `Bash(node bin/agents-md.js:*)` で既に許可された単一のBash呼び出しの中でNode子プロセスとして
# `gh` を直接起動するため、allowlistから生 `gh pr create` を除いてもラッパー自身のPR作成は
# 影響を受けない（DESIGN.md「論点3」参照）。生 `gh pr create` を残すと、ワーカーがテンプレート
# 充填を経由しない素のPR本文でDraft PRを作成できてしまい、PRテンプレートの実効的な徹底
# （AC-5/AC-6）を損なうため除外する。`gh pr view/edit/comment` はPR作成ではなく更新・参照用途
# のため引き続き許可する。
WORKER_ALLOWED_TOOLS_DEFAULT='Read Grep Glob Edit Write MultiEdit Bash(git add:*) Bash(git commit:*) Bash(git push:*) Bash(git status:*) Bash(git diff:*) Bash(git rev-parse:*) Bash(git log:*) Bash(git show:*) Bash(git fetch:*) Bash(git restore:*) Bash(gh pr view:*) Bash(gh pr edit:*) Bash(gh pr comment:*) Bash(gh issue comment:*) Bash(.agent-skill-chain/scripts/*) Bash(bash .agent-skill-chain/scripts/*) Bash(node bin/agents-md.js:*) Bash(npm run:*) Bash(npm test:*) Bash(npm ci:*) Bash(mkdir:*) Bash(ls:*)'

# Issue #185: launch_worker/launch_gate_reviewer 共通の認証チェック（2段化）。
# (a) 高速パス: ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN のいずれかが非空なら authed とみなす
#     （従来どおり実値は非ログ）。
# (b) フォールバック: いずれのenvも無い場合のみ、claudeが実際に認証済みかを軽量に確認する実疎通確認
#     （既定 `claude auth status`。非対話・認証状態のみ確認・モデル呼び出しなし・トークン消費なし）を
#     行い、終了コード0を authed とみなす。CLAUDE_AUTH_PROBE_CMD で完全上書き可能（テストのモック境界。
#     WORKER_CMD/GATE_REVIEWER_CMDと同型）。claude 不在かつ CLAUDE_AUTH_PROBE_CMD 未指定なら
#     真の認証欠如として1を返す。プローブの出力（`auth status --json`はアカウント情報を含みうる）は
#     stdout/stderrとも非ログ（呼び出し元で2>/dev/null等により捨てる）。
# 採用理由・却下案との比較はDESIGN.md（ISSUE-185）「認証チェック修正方式の設計判断」参照。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（高速パス）、
#      CLAUDE_AUTH_PROBE_CMD（フォールバックプローブの上書き。既定は`claude auth status`）、
#      CLAUDE_AUTH_PROBE_TIMEOUT_SEC（プローブのtimeout秒数、既定20）。
# 終了コード: 0=authed / 1=真の認証欠如（env無し・プローブ失敗またはclaude不在）。
_claude_auth_ok() {
  if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    return 0
  fi
  local probe="${CLAUDE_AUTH_PROBE_CMD:-}"
  if [[ -z "$probe" ]]; then
    if command -v claude >/dev/null 2>&1; then
      probe='claude auth status'
    else
      return 1
    fi
  fi
  local t="${CLAUDE_AUTH_PROBE_TIMEOUT_SEC:-20}"
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" bash -c "$probe" >/dev/null 2>&1
  else
    bash -c "$probe" >/dev/null 2>&1
  fi
}

# agent-skill-chain CLI を解決して実行する（.agent-skill-chain/scripts/gate-*.sh と同じ優先順位）。
_asc_cli() {
  if [[ -f "$REPO_ROOT/bin/agents-md.js" ]]; then
    node "$REPO_ROOT/bin/agents-md.js" "$@"
  elif [[ -x "$REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    "$REPO_ROOT/node_modules/.bin/agent-skill-chain" "$@"
  elif command -v agent-skill-chain >/dev/null 2>&1; then
    agent-skill-chain "$@"
  else
    echo "agent-skill-chain CLI が見つかりません（bin/agents-md.js 未ビルド、node_modules/.bin/agent-skill-chain 不在、PATH上にも無し）。" >&2
    return 1
  fi
}

# writer lease を取得する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.ttl_seconds を用いる。
# 引数: issue_id, segment
acquire_lease() {
  "$SCRIPTS_DIR/lease-acquire.sh" "$@"
}

# 保持中の writer lease を延長する。.agent-skill-chain/config/agent-skill-chain.yaml の lease.renewal_interval_seconds を用いる。
# 引数: issue_id（tokenはGit管理外credentialから暗黙に取得）
renew_lease() {
  "$SCRIPTS_DIR/lease-renew.sh" "$@"
}

# 保持中の writer lease を解放する。
# 引数: issue_id（tokenはGit管理外credentialから暗黙に取得）
release_lease() {
  "$SCRIPTS_DIR/lease-release.sh" "$@"
}

# 自ブランチへ commit・push する（自ブランチ以外への書込みは禁止）。
# 引数: message
commit_and_push() {
  "$SCRIPTS_DIR/checkpoint.sh" "$@"
}

# テストを実行する（常時必須／変更内容別必須のテストは .agent-skill-chain/standards/TEST_POLICY.md 参照）。
run_tests() {
  "$SCRIPTS_DIR/run-tests.sh" "$@"
}

# Integration Record / Draft PR を新規作成する（SPECワーカーの最初のcheckpoint push直後のみ）。
# 既存レコードへの更新（design/implementation/validationワーカーによるgatesフィールド反映等）は
# 現時点でCLI側に実装が無く、spec以外のセグメントから呼び出すと失敗する
# （pr-create.sh・.agent-skill-chain/schemas/integration.schema.yaml参照。GitHubモードでは
# 後続のcommit_and_pushによるpushがPRへ自動反映されるため、実害は無い）。
# 引数: issue_id, branch
update_integration_record() {
  "$SCRIPTS_DIR/pr-create.sh" "$@"
}

# 完了・blocked を固定スキーマ（.agent-skill-chain/schemas/worker-report.schema.yaml）で進行役へ報告する。
# 引数: issue_id, role, segment, status, target_sha, [blocked_reason]
report_status() {
  "$SCRIPTS_DIR/report-status.sh" "$@"
}

# --- claude.sh 固有の差分: ゲートレビュア起動 ---
#
# ゲートレビュア（read-only）を Claude Code CLI headless（既定）または GATE_REVIEWER_CMD で指定した
# 実行系で起動し、構造化 verdict を gate-report へ結線する。
#
# read-only 契約（ADR-1 / AGENTS.md §役割・権限）: レビュアには書込みツールを一切与えない
#   （claude CLI は `--allowed-tools ''` で無ツール起動）。gate-report への書込みは trusted な
#   `agent-skill-chain gate record-verdict`（本アダプタ経由）のみが行う。
# I8 安全側ラチェット: 認証未設定（かつ実疎通確認も失敗）・CLI 不在・起動失敗・timeout・verdict 空・
#   結線失敗はいずれも final=human_required を書いて非ゼロ（!=3）で返す（決して approve/success へ倒さない）。
# 認証情報（ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN）・実疎通確認（claude auth status）の出力は
#   実値をログ・stdout に出さない（Issue #185 _claude_auth_ok）。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>
# 終了コード: 0=判定完了 / 2（!=0,!=3）=error（final=human_required 書込み後）。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（認証、高速パス）、
#      CLAUDE_AUTH_PROBE_CMD | CLAUDE_AUTH_PROBE_TIMEOUT_SEC（認証の実疎通フォールバック、_claude_auth_ok参照）、
#      GATE_REVIEWER_CMD（レビュア実行系の上書き）、
#      GATE_REVIEWER_TIMEOUT_SEC（既定900）、GATE_REVIEWER_RETRIES（既定3）、GATE_REVIEWER_RETRY_INTERVAL_SEC（既定30）。
launch_gate_reviewer() {
  local issue_id="${1:-}" gate_id="${2:-}" profile="${3:-}" report_path="${4:-}" target_sha="${5:-}"

  if [[ -z "$issue_id" || -z "$gate_id" || -z "$profile" || -z "$report_path" || -z "$target_sha" ]]; then
    echo "launch_gate_reviewer: 引数 <issue_id> <gate_id> <profile> <gate_report_path> <target_sha> が必要です" >&2
    return 1
  fi
  case "$gate_id" in
    spec | design | implementation | validation) ;;
    *)
      echo "launch_gate_reviewer: gate_id は spec|design|implementation|validation のいずれかである必要があります: $gate_id" >&2
      return 1
      ;;
  esac
  if [[ ! -f "$report_path" ]]; then
    echo "launch_gate_reviewer: gate-report が存在しません（gate review 未実行）: $report_path" >&2
    return 1
  fi

  # フェイルセーフ書込み（I8）: final=human_required を書いて error を返す共通処理。
  _fail_safe() {
    echo "launch_gate_reviewer: $1（フェイルセーフで human_required へ倒します）" >&2
    _asc_cli gate mark-human-required "$report_path" >/dev/null || true
    return 2
  }

  # 認証（実値はログ・stdout に出さない）。env非空の高速パス→claude auth statusの実疎通フォールバック
  # の2段判定（Issue #185 _claude_auth_ok）。真に認証が欠如している場合のみフェイルセーフする。
  if ! _claude_auth_ok; then
    _fail_safe "認証情報が未設定かつ実疎通確認にも失敗しました（env未設定・claude auth status失敗/不在）"
    return
  fi

  # レビュア実行系。GATE_REVIEWER_CMD で上書き可能。既定は claude CLI headless（無ツール＝read-only）。
  local reviewer_cmd="${GATE_REVIEWER_CMD:-}"
  if [[ -z "$reviewer_cmd" ]]; then
    if command -v claude >/dev/null 2>&1; then
      reviewer_cmd="claude -p --output-format text --allowed-tools ''"
    else
      _fail_safe "claude CLI が見つからず GATE_REVIEWER_CMD も未設定です"
      return
    fi
  fi

  # 判定プロンプト（ルーブリック・出力契約）を組み立てる。
  local prompt
  if ! prompt="$(_asc_cli gate reviewer-prompt "$issue_id" "$gate_id" "$target_sha")"; then
    _fail_safe "判定プロンプトの生成に失敗しました"
    return
  fi

  # 判定対象成果物の base_dir を解決（approved_artifacts の digest 算出に使う）。
  local base_dir
  base_dir="$(_asc_cli gate reviewer-context "$issue_id" | sed -n 's/^base_dir=//p')"

  local timeout_sec="${GATE_REVIEWER_TIMEOUT_SEC:-900}"
  local retries="${GATE_REVIEWER_RETRIES:-3}"
  local interval="${GATE_REVIEWER_RETRY_INTERVAL_SEC:-30}"

  # read-only レビュア起動（プロンプトは stdin）。一時障害はリトライ、timeout は打ち切り。
  local attempt=1 verdict rc
  while ((attempt <= retries)); do
    verdict=""
    rc=0
    if command -v timeout >/dev/null 2>&1; then
      verdict="$(printf '%s' "$prompt" | timeout "$timeout_sec" bash -c "$reviewer_cmd" 2>/dev/null)" || rc=$?
    else
      verdict="$(printf '%s' "$prompt" | bash -c "$reviewer_cmd" 2>/dev/null)" || rc=$?
    fi
    if [[ $rc -eq 0 && -n "$verdict" ]]; then
      break
    fi
    ((attempt++))
    if ((attempt <= retries)); then sleep "$interval"; fi
  done

  if [[ ${rc:-1} -ne 0 || -z "${verdict:-}" ]]; then
    _fail_safe "レビュア起動に失敗しました（rc=${rc:-1}, attempts=$retries）"
    return
  fi

  # verdict を gate-report へ結線（書込みは trusted CLI のみ）。
  if ! printf '%s' "$verdict" | _asc_cli gate record-verdict "$report_path" "$base_dir" >/dev/null; then
    _fail_safe "verdict の gate-report への結線に失敗しました"
    return
  fi
  return 0
}

# --- claude.sh 固有の差分: セグメント作業ワーカー起動（launch_worker、#166） ---
#
# writer（セグメント作業ワーカー、spec/design/implementation/validation）を Claude Code CLI
# headless（既定）または WORKER_CMD で指定した実行系で起動し、segment start が返す role_contract
# 全文をプロンプトとして stdin 経由で渡す（launch_gate_reviewer と同型）。read-only な
# ゲートレビュアと異なり、書込みツールを許可した非対話フラグで起動する。ワーカー自身が
# checkpoint.sh（＋specのみ pr-create.sh）・report-status.sh・lease-release.sh を呼び出して
# 完了させる。launch_worker自身は「成果物の中身」を判断せず、report-status の直近レコードと
# target_shaの一致だけで完了を機械的に確認する（役割・権限の境界。DESIGN.md参照）。
#
# lease取得→segment start→起動→完了確認→解放/blocked報告の順序（AC-2）:
#   1. lease取得に失敗した場合、まだ何も起動していないため blocked報告は行わず即 return 1。
#   2. segment start（role_contract取得）に失敗した場合も起動前のため worker-report は書かず、
#      lease解放のみ行って return 1。
#   3. 起動後（認証未設定・CLI不在・起動失敗・timeout・完了を騙る＝未報告/target_sha不一致）は
#      すべて report_status blocked(human_escalation_requested扱いの理由メッセージ) + release_lease
#      を行い、0でも3でもない終了コードで返す（I8: silent passしない）。
#   4. 完了確認（worker自身のreport statusがcompletedかつtarget_shaがpush済みHEADと一致）が
#      取れた場合のみ release_lease + return 0。
#
# リトライしない: workerは実際にファイルを書き換える非冪等な操作を行うため、失敗直後の無条件
# リトライは部分書込みの上に二重に作業させる・二重commitを生む実害がある。1回の起動失敗は
# 即座に人間判断（blocked）へ委ねる（I8: 迷ったら安全側）。
#
# 引数: <issue_id> <segment>
# 終了コード: 0=worker完了 / 2（!=0,!=3）=error（blocked報告・lease解放済み）/
#             1=引数・lease取得前のエラー（lease未取得または解放済み、report未発行）。
# env: ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN（認証、高速パス、実値非ログ出力）、
#      CLAUDE_AUTH_PROBE_CMD | CLAUDE_AUTH_PROBE_TIMEOUT_SEC（認証の実疎通フォールバック、_claude_auth_ok参照）、
#      WORKER_CMD（起動系上書き。テストではecho等のモックコマンドに完全差し替え可能）、
#      WORKER_ALLOWED_TOOLS（WORKER_CMD未指定時の既定claude起動が使う --allowed-tools 値の上書き。
#      既定は WORKER_ALLOWED_TOOLS_DEFAULT、ワーカーの正規責務範囲に限定したallowlist）、
#      WORKER_TIMEOUT_SEC（既定1800）、WORKER_RENEW_INTERVAL_SEC（leaseのrenewループ間隔、既定900）。
launch_worker() {
  local issue_id="${1:-}" segment="${2:-}"

  if [[ -z "$issue_id" || -z "$segment" ]]; then
    echo "launch_worker: 引数 <issue_id> <segment> が必要です" >&2
    return 1
  fi
  case "$segment" in
    spec | design | implementation | validation) ;;
    *)
      echo "launch_worker: segment は spec|design|implementation|validation のいずれかである必要があります: $segment" >&2
      return 1
      ;;
  esac

  # 1. lease取得。失敗時はまだ何も起動していないため blocked報告なしで即 return 1
  #    （AC-2: wip.limit超過・同issue内他segment競合・同一segment競合はいずれもここで拒否される。
  #    launch_worker自身はWIP判定・コンフリクト判定を独自に持たず lease acquire の結果を信頼する）。
  if ! acquire_lease "$issue_id" "$segment" >/dev/null; then
    echo "launch_worker: writer lease の取得に失敗しました（wip.limit超過または既存leaseとの競合）" >&2
    return 1
  fi

  # 2. segment start（role_contract取得。lease有効性の再検証を兼ねる）。
  #    失敗時は起動前のため worker-report は書かず lease解放のみ行う。
  local contract role
  if ! contract="$(_asc_cli segment start "$issue_id" "$segment")"; then
    echo "launch_worker: segment start に失敗しました（role_contract取得不可）" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi
  role="$(sed -n 's/^role:[[:space:]]*//p' <<<"$contract" | head -n1)"
  if [[ -z "$role" ]]; then
    echo "launch_worker: segment start の出力から role を抽出できませんでした" >&2
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 1
  fi

  # 3. 起動後のフェイルセーフ（I8）: blocked報告 + lease解放 + 非0非3で返す共通処理。
  _fail_blocked() {
    local reason="$1" sha
    echo "launch_worker: $reason（フェイルセーフでblockedへ倒します）" >&2
    sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    report_status "$issue_id" "$role" "$segment" blocked "$sha" "$reason" true >/dev/null 2>&1 || true
    release_lease "$issue_id" >/dev/null 2>&1 || true
    return 2
  }

  # 認証（実値はログ・stdoutに出さない）。env非空の高速パス→claude auth statusの実疎通フォールバック
  # の2段判定（Issue #185 _claude_auth_ok）。真に認証が欠如している場合のみフェイルセーフする。
  if ! _claude_auth_ok; then
    _fail_blocked "認証情報が未設定かつ実疎通確認にも失敗しました（env未設定・claude auth status失敗/不在）"
    return
  fi

  # 起動系。WORKER_CMD で上書き可能（テスト用モック境界）。既定は claude CLI headless を
  # --allowed-tools（責務スコープ allowlist、WORKER_ALLOWED_TOOLS）で起動する。無制限自動承認
  # （--permission-mode bypassPermissions）・編集のみ自動承認（acceptEdits、Bashは都度承認＝
  # ヘッドレスで事実上停止）のいずれも既定に用いない——既定は「列挙外は拒否」の安全側 fail を
  # 保ったまま、ワーカーの正規責務範囲（自branchへのcommit/push・Draft PR作成・テスト実行・
  # report/lease/checkpoint各スクリプト実行・自worktree内ファイル編集）だけを非対話で完走できる
  # ようにする（DESIGN.md（ISSUE-183）「採用案 候補A」）。
  local worker_cmd="${WORKER_CMD:-}"
  if [[ -z "$worker_cmd" ]]; then
    if command -v claude >/dev/null 2>&1; then
      local worker_allowed_tools="${WORKER_ALLOWED_TOOLS:-$WORKER_ALLOWED_TOOLS_DEFAULT}"
      worker_cmd="claude -p --output-format text --allowed-tools \"$worker_allowed_tools\""
    else
      _fail_blocked "claude CLI が見つからず WORKER_CMD も未設定です"
      return
    fi
  fi

  local timeout_sec="${WORKER_TIMEOUT_SEC:-1800}"
  local renew_interval="${WORKER_RENEW_INTERVAL_SEC:-900}"

  # role_contract全文をプロンプトとしてstdin経由で渡す（唯一の正規契約伝達経路。AC-3）。
  # ASC_ISSUE_ID/ASC_SEGMENT/ASC_ROLE は worker_cmd 実装（テスト用stub含む）の便宜のためのenvであり、
  # 契約の内容自体はstdinのrole_contractに完全に含まれる。
  local prompt_file
  prompt_file="$(mktemp)"
  printf '%s' "$contract" >"$prompt_file"

  local worker_pid rc
  if command -v timeout >/dev/null 2>&1; then
    ASC_ISSUE_ID="$issue_id" ASC_SEGMENT="$segment" ASC_ROLE="$role" \
      timeout "$timeout_sec" bash -c "$worker_cmd" <"$prompt_file" &
  else
    ASC_ISSUE_ID="$issue_id" ASC_SEGMENT="$segment" ASC_ROLE="$role" \
      bash -c "$worker_cmd" <"$prompt_file" &
  fi
  worker_pid=$!

  # renewループ: サブプロセス生存中のみ renewal_interval_seconds ごとに renew_lease を呼ぶ。
  # 待機には sleep（外部コマンド）ではなく read -t（bashビルトイン）を使う: サブシェル自体へ
  # SIGTERM（後述のkill "$renew_pid"）を送った際、外部コマンドとしてforkされたsleepは
  # シグナルを受け取らず孤児プロセスとして生き残り得るが、ビルトインのread -tはサブシェル
  # プロセス自身の実行なのでSIGTERMで即座に中断される（stdinは干渉を避けるため/dev/nullへ）。
  (
    while kill -0 "$worker_pid" 2>/dev/null; do
      read -r -t "$renew_interval" _renew_wait </dev/null || true
      kill -0 "$worker_pid" 2>/dev/null || break
      renew_lease "$issue_id" >/dev/null 2>&1 || true
    done
  ) &
  local renew_pid=$!

  wait "$worker_pid"
  rc=$?
  kill "$renew_pid" >/dev/null 2>&1 || true
  wait "$renew_pid" 2>/dev/null || true
  rm -f "$prompt_file"

  if [[ $rc -ne 0 ]]; then
    _fail_blocked "worker起動が失敗またはtimeoutしました（rc=$rc, timeout=${timeout_sec}s）"
    return
  fi

  # 完了確認（I8: 完了を騙るケースの安全側判定）: report-status直近レコードのstatus・target_shaを
  # 実際のpush済みHEADと突合する。サブプロセスの終了コード0だけでは信頼しない。
  local latest reported_status reported_sha current_sha
  if ! latest="$(_asc_cli report latest "$issue_id" "$segment")"; then
    _fail_blocked "worker完了後の report status を確認できませんでした（未報告の可能性）"
    return
  fi
  reported_status="$(sed -n 's/^status=//p' <<<"$latest")"
  reported_sha="$(sed -n 's/^target_sha=//p' <<<"$latest")"
  current_sha="$(git rev-parse HEAD 2>/dev/null || echo '')"

  if [[ "$reported_status" != "completed" || -z "$reported_sha" || "$reported_sha" != "$current_sha" ]]; then
    _fail_blocked "worker完了を確認できませんでした（報告status=${reported_status:-無し}, 報告target_sha=${reported_sha:-無し}, 現在HEAD=${current_sha:-無し}）"
    return
  fi

  release_lease "$issue_id" >/dev/null 2>&1 || true
  return 0
}
