#!/usr/bin/env bash
# protected baseのローカルadapterで独立reviewerを起動し、GitHub PR Review APIへ証跡を残す。
# AIをGitHub Actions内で起動しない。Issue worktree/candidate codeからの実行はsubmit-evidenceが拒否する。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"

ISSUE_ID="${1:-}"
GATE_ID="${2:-}"
PROFILE="${3:-}"
TARGET_SHA="${4:-}"
BASE_SHA="${5:-}"
PR_NUMBER="${6:-}"
ADAPTER="${7:-}"

if [[ -z "$ISSUE_ID" || -z "$GATE_ID" || -z "$PROFILE" || -z "$TARGET_SHA" || -z "$BASE_SHA" || -z "$PR_NUMBER" || -z "$ADAPTER" ]]; then
  echo "使い方: gate-local-review.sh <issue_id> <gate_id> <standard|strict> <target_sha> <base_sha> <pr_number> <codex|claude|human>" >&2
  exit 1
fi
case "$ADAPTER" in codex | claude | human) ;; *) echo "未登録adapterです: $ADAPTER" >&2; exit 1 ;; esac

CURRENT_ROOT="$(git -C "$REPO_ROOT" rev-parse --show-toplevel)"
CURRENT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ "$CURRENT_ROOT" != "$REPO_ROOT" || "$CURRENT_SHA" != "$BASE_SHA" ]]; then
  echo "protected base worktree/SHAから実行してください（root=$CURRENT_ROOT, HEAD=$CURRENT_SHA, expected=$BASE_SHA）" >&2
  exit 1
fi
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "protected base worktreeがdirtyです。review evidenceを投稿しません。" >&2
  exit 1
fi

REVIEW_OUTPUT="$("$SCRIPT_DIR/gate-review.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$TARGET_SHA")"
REPORT_PATH="$(sed -n 's/^gate_report_path: //p' <<<"$REVIEW_OUTPUT")"
if [[ -z "$REPORT_PATH" ]]; then
  echo "gate-report scaffoldを生成できませんでした" >&2
  exit 1
fi

COUNT=1
[[ "$PROFILE" == "strict" ]] && COUNT=2
for slot in $(seq 1 "$COUNT"); do
  run_id="review-${GATE_ID}-${TARGET_SHA:0:12}-${slot}-$$"
  ASC_BASE_REF="$BASE_SHA" \
  ASC_EVIDENCE_BASE_SHA="$BASE_SHA" \
  ASC_TRUSTED_BASE_SHA="$BASE_SHA" \
  ASC_EVIDENCE_PR_NUMBER="$PR_NUMBER" \
  ASC_REVIEWER_RUN_ID="$run_id" \
  ASC_REVIEWER_SLOT="$slot" \
  ASC_REVIEW_ADAPTER_REQUESTED="$ADAPTER" \
    "$SCRIPT_DIR/gate-launch-reviewer.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$REPORT_PATH" "$TARGET_SHA"
done
