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
# env: ASC_BASE_REF（差分基点）、ASC_REVIEW_SUBJECT（ordinary|core_audit。Coordination Backend正本から導出）
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

# project policy を含む reviewer context を一度だけ解決する。分類不能は非コアへ推測しない。
if ! CONTEXT_OUTPUT="$(
  _cli gate reviewer-context \
    "$ISSUE_ID" "$TARGET_SHA" "${ASC_BASE_REF:-}" "${ASC_REVIEW_SUBJECT:-}" "${ASC_REVIEW_ADAPTER_REQUESTED:-}"
)"; then
  echo "reviewer context の解決に失敗しました。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

ADAPTER="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^adapter=//p')"
ADAPTER="${ADAPTER:-claude}"
ADAPTER_FILE="$ADAPTERS_DIR/${ADAPTER}.sh"

ASC_CORE_REVIEW_REQUIRED="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^core_review_required=//p')"
ASC_CORE_REVIEW_STATUS="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^core_review_status=//p')"
ASC_GITHUB_TRUSTED_POLICY_STATUS="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^github_trusted_policy_status=//p')"
ASC_GITHUB_TRUSTED_POLICY_REASON="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^github_trusted_policy_reason=//p')"
ASC_CORE_REQUIRED_PROFILE="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^core_required_profile=//p')"
ASC_CORE_MODEL_TIER="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^core_model_tier=//p')"
ASC_CORE_REASONING_TIER="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^core_reasoning_tier=//p')"
ASC_CODEX_REQUIRED_MODEL="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^codex_required_model=//p')"
ASC_CODEX_REQUIRED_REASONING_EFFORT="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^codex_required_reasoning_effort=//p')"
ASC_REVIEW_BASE_SHA="$(printf '%s\n' "$CONTEXT_OUTPUT" | sed -n 's/^review_base_sha=//p')"
ASC_REVIEW_ADAPTER="$ADAPTER"
export ASC_CORE_REVIEW_REQUIRED ASC_CORE_REVIEW_STATUS ASC_CORE_REQUIRED_PROFILE
export ASC_GITHUB_TRUSTED_POLICY_STATUS ASC_GITHUB_TRUSTED_POLICY_REASON
export ASC_CORE_MODEL_TIER ASC_CORE_REASONING_TIER ASC_CODEX_REQUIRED_MODEL ASC_CODEX_REQUIRED_REASONING_EFFORT
export ASC_REVIEW_ADAPTER ASC_REVIEW_BASE_SHA

if [[ "$ASC_GITHUB_TRUSTED_POLICY_STATUS" == "human_required" ]]; then
  echo "GitHub trusted review policyが未構成です（reason=$ASC_GITHUB_TRUSTED_POLICY_REASON）。human_requiredへ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi
if [[ "$ASC_CORE_REVIEW_STATUS" == "unresolved" ]]; then
  echo "コアレビュー対象の分類を完了できませんでした。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi
if [[ "$ASC_CORE_REVIEW_REQUIRED" == "true" && "$PROFILE" != "$ASC_CORE_REQUIRED_PROFILE" ]]; then
  echo "コアレビューには profile=$ASC_CORE_REQUIRED_PROFILE が必要です（指定: $PROFILE）。human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

if [[ ! -f "$ADAPTER_FILE" ]]; then
  echo "アダプタが見つかりません: $ADAPTER_FILE（review.adapter=$ADAPTER）。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

# アダプタを読み込み、launch_gate_reviewer を起動する。終了コードは job 分岐へそのまま伝播する。
# shellcheck source=/dev/null
source "$ADAPTER_FILE"
if ! declare -F launch_gate_reviewer >/dev/null; then
  echo "アダプタ $ADAPTER に launch_gate_reviewer が定義されていません。フェイルセーフで human_required へ倒します" >&2
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
  exit 2
fi

set +e
launch_gate_reviewer "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$REPORT_PATH" "$TARGET_SHA"
CODE=$?
set -e

# 安全網（I8）: error（0でも3でもない）なのに final が pending のまま残っていたら human_required を書く。
if [[ "$CODE" -ne 0 && "$CODE" -ne 3 ]]; then
  _cli gate mark-human-required "$REPORT_PATH" >/dev/null 2>&1 || true
fi

exit "$CODE"
