#!/usr/bin/env bash
# 正本: AGENTS.md §役割・権限・writer lease / §不変条件I8 / .agent-skill-chain/config/roles.yaml adapters.* /
#       .agent-skill-chain/config/agent-skill-chain.yaml worker.adapter
#
# 進行役が segment start 後にセグメント作業ワーカー（spec/design/implementation/validation）を
# 起動するために呼ぶ。config(worker.adapter, 既定human)で選択したアダプタの launch_worker を
# 起動し、writer lease 取得〜起動〜解放/blocked報告の一連を委譲する（gate-launch-reviewer.sh と
# 対称の起動ラッパー）。
#
# 終了コード（launch_workerの終了コードをそのまま伝播する）:
#   0        worker完了（report_status completed済み、lease解放済み）
#   3        deferred（human adapterのみ。正常系。lease は保持継続、人間の非同期作業待ち）
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

# config からアダプタを解決する（worker.adapter、未設定時 human）。
ADAPTER="$(_cli worker context "$ISSUE_ID" | sed -n 's/^adapter=//p')"
ADAPTER="${ADAPTER:-human}"
ADAPTER_FILE="$ADAPTERS_DIR/${ADAPTER}.sh"

if [[ ! -f "$ADAPTER_FILE" ]]; then
  echo "アダプタが見つかりません: $ADAPTER_FILE（worker.adapter=$ADAPTER）。まだ何も起動していないため error として扱います" >&2
  exit 2
fi

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
