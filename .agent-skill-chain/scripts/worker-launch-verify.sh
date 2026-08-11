#!/usr/bin/env bash
# 正本: AGENTS.md 役割・権限・writer lease / 不変条件I8 / Issue #448
#
# Agent tool経由で完了したsegment workerについて、renewデーモン停止、contract完全性、
# report statusとpush済みHEADの一致を検証し、最後にwriter leaseを解放する。
#
# 引数: <issue_id> <dispatch_temp_dir>
# 終了コード: 0=Completed / 1=引数不正・対象worktree解決不能 / 2=Blocked

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"

_cli() {
  if [[ -f "$REPO_ROOT/bin/agents-md.js" ]]; then
    node "$REPO_ROOT/bin/agents-md.js" "$@"
  elif [[ -x "$REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    "$REPO_ROOT/node_modules/.bin/agent-skill-chain" "$@"
  elif command -v agent-skill-chain >/dev/null 2>&1; then
    agent-skill-chain "$@"
  else
    echo "agent-skill-chain CLI が見つかりません（'npm run build' を実行するか agent-skill-chain を導入してください）。" >&2
    return 1
  fi
}

ISSUE_ID="${1:-}"
DISPATCH_TEMP_DIR="${2:-}"

if [[ -z "$ISSUE_ID" || -z "$DISPATCH_TEMP_DIR" ]]; then
  echo "使い方: worker-launch-verify.sh <issue_id> <dispatch_temp_dir>" >&2
  exit 1
fi
if [[ "$DISPATCH_TEMP_DIR" != /* || ! -d "$DISPATCH_TEMP_DIR" ]]; then
  echo "worker-launch-verify.sh: dispatch_temp_dirは存在する絶対ディレクトリパスである必要があります" >&2
  exit 1
fi
case "$(basename -- "$DISPATCH_TEMP_DIR")" in
  agent-skill-chain-worker-dispatch.*) ;;
  *)
    echo "worker-launch-verify.sh: dispatch_temp_dirが安全なdispatch一時ディレクトリ名ではありません" >&2
    exit 1
    ;;
esac

CONTRACT_FILE="$DISPATCH_TEMP_DIR/contract.md"
ROLE=""
SEGMENT=""
if [[ -f "$CONTRACT_FILE" ]]; then
  ROLE="$(sed -n 's/^role:[[:space:]]*//p' "$CONTRACT_FILE" | head -n1)"
  SEGMENT="${ROLE%_worker}"
fi
CONTEXT_SEGMENT="$SEGMENT"
case "$CONTEXT_SEGMENT" in
  spec | design | implementation | validation) ;;
  *) CONTEXT_SEGMENT=spec ;;
esac

if ! WORKER_CONTEXT="$(_cli worker context "$ISSUE_ID" "$CONTEXT_SEGMENT")"; then
  echo "worker-launch-verify.sh: worker context の解決に失敗しました。lease操作を行わず停止します" >&2
  exit 1
fi
WORKTREE_PATH="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^worktree_path=//p')"
if [[ -z "$WORKTREE_PATH" ]]; then
  echo "worker-launch-verify.sh: 対象Issueのworktreeを一意に解決できませんでした: ${ISSUE_ID}" >&2
  exit 1
fi

# Issue #442で確立したcwd非依存の自己解決: 呼び出し元の位置に依存せず対象worktreeへ再実行する。
if [[ ! "$REPO_ROOT" -ef "$WORKTREE_PATH" ]]; then
  if [[ "${ASC_WORKER_VERIFY_REEXEC:-0}" == "1" ]]; then
    echo "worker-launch-verify.sh: 対象worktreeへ再実行後も実行位置が一致しません: ${WORKTREE_PATH}" >&2
    exit 1
  fi
  TARGET_VERIFY="$WORKTREE_PATH/.agent-skill-chain/scripts/worker-launch-verify.sh"
  if [[ ! -f "$TARGET_VERIFY" ]]; then
    echo "worker-launch-verify.sh: 対象worktree内の検証スクリプトが見つかりません: ${TARGET_VERIFY}" >&2
    exit 1
  fi
  if ! cd -- "$WORKTREE_PATH"; then
    echo "worker-launch-verify.sh: 対象worktreeへ移動できません: ${WORKTREE_PATH}" >&2
    exit 1
  fi
  export ASC_WORKER_VERIFY_REEXEC=1
  exec bash "$TARGET_VERIFY" "$ISSUE_ID" "$DISPATCH_TEMP_DIR"
fi

# shellcheck source=../adapters/claude.sh
source "$REPO_ROOT/.agent-skill-chain/adapters/claude.sh"

_release_only_blocked() {
  local reason="$1"
  echo "worker-launch-verify.sh: ${reason}（フェイルセーフでblockedへ倒します）" >&2
  release_lease "$ISSUE_ID" >/dev/null 2>&1 || true
  return 2
}

_fail_blocked() {
  local reason="$1" sha
  echo "worker-launch-verify.sh: ${reason}（フェイルセーフでblockedへ倒します）" >&2
  sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  report_status "$ISSUE_ID" "$ROLE" "$SEGMENT" blocked "$sha" "$reason" true >/dev/null 2>&1 || true
  release_lease "$ISSUE_ID" >/dev/null 2>&1 || true
  return 2
}

# PIDファイルの値だけを信頼せず、固有の一時ディレクトリパスがcmdlineに残る場合だけ停止する。
if [[ -f "$DISPATCH_TEMP_DIR/renew.pid" ]]; then
  RENEW_PID="$(tr -d '[:space:]' <"$DISPATCH_TEMP_DIR/renew.pid")"
  if [[ "$RENEW_PID" =~ ^[1-9][0-9]*$ ]]; then
    RENEW_ARGS="$(ps -p "$RENEW_PID" -o args= 2>/dev/null || true)"
    if [[ "$RENEW_ARGS" == *"$DISPATCH_TEMP_DIR"* ]]; then
      kill "$RENEW_PID" >/dev/null 2>&1 || true
      for _poll in {1..10}; do
        kill -0 "$RENEW_PID" >/dev/null 2>&1 || break
        sleep 0.2
      done
      if kill -0 "$RENEW_PID" >/dev/null 2>&1; then
        kill -9 "$RENEW_PID" >/dev/null 2>&1 || true
        for _poll in {1..10}; do
          kill -0 "$RENEW_PID" >/dev/null 2>&1 || break
          sleep 0.2
        done
      fi
    fi
  fi
fi

if [[ -z "$ROLE" ]]; then
  rm -rf -- "$DISPATCH_TEMP_DIR"
  _release_only_blocked "contract.mdからroleを抽出できませんでした"
  exit $?
fi
case "$SEGMENT" in
  spec | design | implementation | validation) ;;
  *)
    rm -rf -- "$DISPATCH_TEMP_DIR"
    _release_only_blocked "contract.mdのroleがsegment worker契約と一致しません: ${ROLE}"
    exit $?
    ;;
esac

INTEGRITY_ERROR=""
if [[ ! -f "$DISPATCH_TEMP_DIR/contract.sha256" ]]; then
  INTEGRITY_ERROR="contract.sha256が存在しません（dispatch時の監査証跡が欠落しています）"
else
  EXPECTED_SHA="$(sed -n 's/^CONTRACT_SHA256=//p' "$DISPATCH_TEMP_DIR/contract.sha256" | head -n1)"
  EXPECTED_LINES="$(sed -n 's/^CONTRACT_LINES=//p' "$DISPATCH_TEMP_DIR/contract.sha256" | head -n1)"
  DISPATCH_STARTED_AT="$(sed -n 's/^DISPATCH_STARTED_AT=//p' "$DISPATCH_TEMP_DIR/contract.sha256" | head -n1)"
  ACTUAL_SHA="$(sha256sum "$CONTRACT_FILE" | awk '{print $1}')"
  ACTUAL_LINES="$(wc -l <"$CONTRACT_FILE" | tr -d '[:space:]')"
  if [[ -z "$EXPECTED_SHA" || -z "$EXPECTED_LINES" || "$ACTUAL_SHA" != "$EXPECTED_SHA" || "$ACTUAL_LINES" != "$EXPECTED_LINES" ]]; then
    INTEGRITY_ERROR="contract.mdのSHA256または行数がdispatch時の監査証跡と一致しません"
  elif [[ ! "$DISPATCH_STARTED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$ ]] ||
    ! date -u -d "$DISPATCH_STARTED_AT" +%s >/dev/null 2>&1; then
    INTEGRITY_ERROR="contract.sha256のDISPATCH_STARTED_ATが欠落またはUTC ISO8601形式ではありません"
  fi
fi

rm -rf -- "$DISPATCH_TEMP_DIR"

if [[ -n "$INTEGRITY_ERROR" ]]; then
  _fail_blocked "$INTEGRITY_ERROR"
  exit $?
fi

COMPLETION_REASON=""
if ! COMPLETION_REASON="$(_verify_worker_completion_report "$ISSUE_ID" "$ROLE" "$SEGMENT" "$DISPATCH_STARTED_AT")"; then
  _fail_blocked "$COMPLETION_REASON"
  exit $?
fi

release_lease "$ISSUE_ID" >/dev/null 2>&1 || true
exit 0
