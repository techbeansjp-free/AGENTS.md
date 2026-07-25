#!/usr/bin/env bash
# 正本: AGENTS.md §4セグメント・4ゲート / §不変条件I8 / .agent-skill-chain/config/roles.yaml adapters.* / .agent-skill-chain/config/agent-skill-chain.yaml review.adapter
#
# gate.yml の判定ステップから呼ばれ、config(review.adapter, 既定claude)で選択したアダプタの
# launch_gate_reviewer を起動して pending gate-report を判定済みへ遷移させる（または deferred を表明する）。
#
# 終了コード（gate.yml が分岐する唯一の入力）:
#   0        判定完了（verify→publish へ）
#   3        deferred（human 非同期。action_required 発行・pending 拒否スキップ・job は緑）
#   その他    error（フェイルセーフ。action_required 発行 + step 赤で可視化）
#
# I8 安全側ラチェット: 起動失敗・timeout・未構成・inconclusive は決して 0 を返さない。アダプタが
# final を書き残さなかった異常時も、本スクリプトが安全網として final=human_required を書いて error を返す
# （＝決して approve/success へ倒さない）。
#
# 引数: <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>

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
GATE_ID="${2:-}"
PROFILE="${3:-}"
REPORT_PATH="${4:-}"
TARGET_SHA="${5:-}"

if [[ -z "$ISSUE_ID" || -z "$GATE_ID" || -z "$PROFILE" || -z "$REPORT_PATH" || -z "$TARGET_SHA" ]]; then
  echo "使い方: gate-launch-reviewer.sh <issue_id> <gate_id> <profile> <gate_report_path> <target_sha>" >&2
  exit 1
fi

# config からアダプタを解決する（review.adapter、未設定時 claude）。
ADAPTER="$(_cli gate reviewer-context "$ISSUE_ID" | sed -n 's/^adapter=//p')"
ADAPTER="${ADAPTER:-claude}"
ADAPTER_FILE="$ADAPTERS_DIR/${ADAPTER}.sh"

if [[ ! -f "$ADAPTER_FILE" ]]; then
  echo "アダプタが見つかりません: $ADAPTER_FILE（review.adapter=$ADAPTER）。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

# アダプタを読み込み、launch_gate_reviewer を起動する。Standardは従来のdirect pathを維持し、
# Strictだけをtrusted sessionの固定2 slotへ分岐する。
# shellcheck source=/dev/null
source "$ADAPTER_FILE"
if ! declare -F launch_gate_reviewer >/dev/null; then
  echo "アダプタ $ADAPTER に launch_gate_reviewer が定義されていません。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

if [[ "$PROFILE" == "standard" ]]; then
  set +e
  launch_gate_reviewer "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$REPORT_PATH" "$TARGET_SHA"
  CODE=$?
  set -e
else
  set +e
  PREPARE_OUTPUT="$(_cli gate strict-prepare "$ISSUE_ID" "$REPORT_PATH")"
  PREPARE_CODE=$?
  if [[ "$PREPARE_CODE" -ne 0 ]]; then
    echo "Strict review sessionの準備に失敗しました。フェイルセーフで human_required へ倒します" >&2
    _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
    exit 2
  fi

  _prepared_value() {
    local key="$1"
    sed -n "s#^${key}: ##p" <<<"$PREPARE_OUTPUT"
  }
  MANIFEST_PATH="$(_prepared_value session_manifest_path)"
  REPORT_1="$(_prepared_value reviewer-1_report_path)"
  REPORT_2="$(_prepared_value reviewer-2_report_path)"
  INVOCATION_1="$(_prepared_value reviewer-1_invocation_id)"
  INVOCATION_2="$(_prepared_value reviewer-2_invocation_id)"
  if [[ -z "$MANIFEST_PATH" || -z "$REPORT_1" || -z "$REPORT_2" || -z "$INVOCATION_1" || -z "$INVOCATION_2" ]]; then
    echo "Strict review sessionの出力が不完全です。フェイルセーフで human_required へ倒します" >&2
    _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
    exit 2
  fi

  _launch_strict_slot() {
    local slot="$1" scratch_report="$2" invocation_id="$3"
    set +e
    launch_gate_reviewer \
      "$ISSUE_ID" "$GATE_ID" strict "$scratch_report" "$TARGET_SHA" "$slot" "$invocation_id"
    local slot_code=$?
    if [[ "$slot_code" -ne 0 ]]; then
      _cli gate mark-human-required "$scratch_report" >/dev/null 2>&1 || true
    fi
    return "$slot_code"
  }

  set +e
  _launch_strict_slot reviewer-1 "$REPORT_1" "$INVOCATION_1" &
  PID_1=$!
  _launch_strict_slot reviewer-2 "$REPORT_2" "$INVOCATION_2" &
  PID_2=$!
  wait "$PID_1"
  CODE_1=$?
  wait "$PID_2"
  CODE_2=$?

  AGGREGATE_OUTPUT="$(_cli gate aggregate-strict "$REPORT_PATH" "$MANIFEST_PATH")"
  AGGREGATE_CODE=$?
  set -e
  if [[ "$AGGREGATE_CODE" -ne 0 ]]; then
    echo "Strict sub-verdictのtrusted aggregationに失敗しました" >&2
    _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
    CODE=2
  else
    AGGREGATE_FINAL="$(sed -n 's/^final: //p' <<<"$AGGREGATE_OUTPUT")"
    if [[ "$CODE_1" -ne 0 && "$CODE_1" -ne 3 ]] || [[ "$CODE_2" -ne 0 && "$CODE_2" -ne 3 ]]; then
      CODE=2
    elif [[ "$CODE_1" -eq 3 || "$CODE_2" -eq 3 ]]; then
      CODE=3
    elif [[ "$AGGREGATE_FINAL" == "human_required" ]]; then
      CODE=2
    else
      CODE=0
    fi
  fi
fi

# 安全網（I8）: error（0でも3でもない）なのに final が pending のまま残っていたら human_required を書く。
if [[ "$CODE" -ne 0 && "$CODE" -ne 3 ]]; then
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
fi

exit "$CODE"
