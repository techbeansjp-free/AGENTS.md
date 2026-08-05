#!/usr/bin/env bash
# 正本: AGENTS.md §役割・権限・writer lease / §不変条件I8 / .agent-skill-chain/config/roles.yaml adapters.* /
#       .agent-skill-chain/config/agent-skill-chain.yaml worker.adapter・worker.segment_overrides・
#       worker.model_tiers・worker.agent_tool_dispatch
#
# 進行役が segment start 後にセグメント作業ワーカー（spec/design/implementation/validation）を
# 起動するために呼ぶ。config(worker.segment_overrides.<segment> → worker.adapter → 既定human)で
# 選択したアダプタの launch_worker を起動し、writer lease 取得〜起動〜解放/blocked報告の一連を
# 委譲する（gate-launch-reviewer.sh と対称の起動ラッパー）。ティア対応表からの具体モデル解決は
# `worker context`（CLI）側で完結しており、本スクリプトはその解決結果を ASC_WORKER_MODEL /
# ASC_WORKER_REASONING_EFFORT / ASC_WORKER_MODEL_TIER としてアダプタへ渡すだけで、ティア名から
# 具体名を導く処理は持たない（ISSUE-307）。
#
# 終了コード（launch_workerの終了コードをそのまま伝播する）:
#   0        worker完了（report_status completed済み、lease解放済み）
#   3        deferred（human adapterのみ。正常系。lease は保持継続、人間の非同期作業待ち）
#   4        dispatch_required（claude adapterのみ。lease保持継続、Agent tool呼び出し待ち）
#   その他    error（フェイルセーフ。lease解放済み・report_status blocked済み、要人間確認）
#
# I8 安全側ラチェット: adapter未解決・launch_worker未定義は「まだ何も起動していない」ため
#   lease取得前のエラーとして exit 2 を返す（決して 0/3 を装わない）。
#
# 引数: <issue_id> <segment>

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"
ADAPTERS_DIR="$REPO_ROOT/.agent-skill-chain/adapters"

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
SEGMENT="${2:-}"

if [[ -z "$ISSUE_ID" || -z "$SEGMENT" ]]; then
  echo "使い方: worker-launch.sh <issue_id> <segment>" >&2
  exit 1
fi
case "$SEGMENT" in
  spec | design | implementation | validation) ;;
  *)
    echo "worker-launch.sh: segment は spec|design|implementation|validation のいずれかである必要があります: $SEGMENT" >&2
    exit 1
    ;;
esac

# config からアダプタ・モデル選択を解決する（segmentを渡し、worker.segment_overrides.<segment>
# → worker.adapter → 既定human、ティア指定時はworker.model_tiersから具体モデル文字列まで解決
# 済みで返る）。worker context 自体の失敗（設定不正・ティア解決失敗）は、まだ何も起動して
# いない段階のエラーとして扱う。
if ! WORKER_CONTEXT="$(_cli worker context "$ISSUE_ID" "$SEGMENT")"; then
  echo "worker-launch.sh: worker context の解決に失敗しました。まだ何も起動していないため error として扱います" >&2
  exit 2
fi

WORKTREE_PATH="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^worktree_path=//p')"
if [[ -z "$WORKTREE_PATH" ]]; then
  echo "worker-launch.sh: 対象Issueのworktreeを一意に解決できませんでした: ${ISSUE_ID}。writer lease取得前に停止します" >&2
  exit 2
fi

if [[ ! "$REPO_ROOT" -ef "$WORKTREE_PATH" ]]; then
  if [[ "${ASC_WORKER_LAUNCH_REEXEC:-0}" == "1" ]]; then
    echo "worker-launch.sh: 対象worktreeへ再実行後も実行位置が一致しません: ${WORKTREE_PATH}。writer lease取得前に停止します" >&2
    exit 2
  fi
  TARGET_LAUNCHER="$WORKTREE_PATH/.agent-skill-chain/scripts/worker-launch.sh"
  if [[ ! -f "$TARGET_LAUNCHER" ]]; then
    echo "worker-launch.sh: 対象worktree内の起動スクリプトが見つかりません: ${TARGET_LAUNCHER}。writer lease取得前に停止します" >&2
    exit 2
  fi
  if ! cd -- "$WORKTREE_PATH"; then
    echo "worker-launch.sh: 対象worktreeへ移動できません: ${WORKTREE_PATH}。writer lease取得前に停止します" >&2
    exit 2
  fi
  export ASC_WORKER_LAUNCH_REEXEC=1
  exec bash "$TARGET_LAUNCHER" "$ISSUE_ID" "$SEGMENT"
fi

ADAPTER="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^adapter=//p')"
ADAPTER="${ADAPTER:-human}"
ADAPTER_FILE="$ADAPTERS_DIR/${ADAPTER}.sh"

if [[ ! -f "$ADAPTER_FILE" ]]; then
  echo "アダプタが見つかりません: ${ADAPTER_FILE}（worker.adapter=${ADAPTER}）。まだ何も起動していないため error として扱います" >&2
  exit 2
fi

# 解決できた値だけをベンダー中立な環境変数として export する（未解決は export しない）。
# ASC_ 名前空間は ASC_ISSUE_ID/ASC_SEGMENT/ASC_ROLE/ASC_REVIEW_MODEL と揃え、アダプタ固有の
# 上書き変数（CODEX_*系）とは名前空間を分ける。ASC_WORKER_MODEL は worker context が
# worker.model_tiers から解決済みの具体的なモデル文字列であり、本スクリプト・アダプタは
# ティア名から具体名を導く処理を持たない。ASC_WORKER_MODEL_TIER はアダプタ側の防御的検査
# （ティア指定なのにモデル未解決の場合に黙って従来値へ落ちないための検査）にのみ用いる。
ASC_WORKER_MODEL="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^model=//p')"
ASC_WORKER_REASONING_EFFORT="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^reasoning_effort=//p')"
ASC_WORKER_MODEL_TIER="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^model_tier=//p')"
ASC_AGENT_TOOL_DISPATCH="$(printf '%s\n' "$WORKER_CONTEXT" | sed -n 's/^agent_tool_dispatch=//p')"
ASC_AGENT_TOOL_DISPATCH="${ASC_AGENT_TOOL_DISPATCH:-false}"
[[ -n "$ASC_WORKER_MODEL" ]] && export ASC_WORKER_MODEL
[[ -n "$ASC_WORKER_REASONING_EFFORT" ]] && export ASC_WORKER_REASONING_EFFORT
[[ -n "$ASC_WORKER_MODEL_TIER" ]] && export ASC_WORKER_MODEL_TIER
export ASC_AGENT_TOOL_DISPATCH

# アダプタを読み込み、launch_worker を起動する。終了コードはそのまま呼び出し側へ伝播する。
# shellcheck source=/dev/null
source "$ADAPTER_FILE"
if ! declare -F launch_worker >/dev/null; then
  echo "アダプタ $ADAPTER に launch_worker が定義されていません。まだ何も起動していないため error として扱います" >&2
  exit 2
fi

set +e
launch_worker "$ISSUE_ID" "$SEGMENT"
CODE=$?
set -e

exit "$CODE"
