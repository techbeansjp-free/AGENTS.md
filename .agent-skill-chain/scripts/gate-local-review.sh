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

PR_SHA_INFO="$(gh api "repos/{owner}/{repo}/pulls/$PR_NUMBER" --jq '.base.ref + " " + .base.sha + " " + .head.sha')"
read -r PR_BASE_REF PR_BASE_SHA PR_HEAD_SHA <<<"$PR_SHA_INFO"
DEFAULT_BRANCH="$(gh api "repos/{owner}/{repo}" --jq '.default_branch')"
if [[ -z "$DEFAULT_BRANCH" || "$PR_BASE_REF" != "$DEFAULT_BRANCH" || "$PR_BASE_SHA" != "$BASE_SHA" || "$PR_HEAD_SHA" != "$TARGET_SHA" ]]; then
  echo "指定baseがrepository default branchまたはGitHub PR metadataと一致しません（ref=$PR_BASE_REF, default=$DEFAULT_BRANCH, base=$PR_BASE_SHA, head=$PR_HEAD_SHA）" >&2
  exit 1
fi

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

# bin/ と node_modules/ はgitignoredであり、main worktreeのclean判定だけでは由来を証明できない。
# GitHubが返したbase SHAを一時cloneへcheckoutし、lockfileから依存を復元してbase sourceをbuildする。
# 以降はこの隔離clone内のCLI/adapterだけを使用し、source worktreeの生成物を実行しない。
TRUSTED_TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-skill-chain-local-review.XXXXXX")"
trap 'rm -rf -- "$TRUSTED_TMP"' EXIT
TRUSTED_ROOT="$TRUSTED_TMP/repo"
git clone --quiet --no-checkout "$REPO_ROOT" "$TRUSTED_ROOT"
git -C "$TRUSTED_ROOT" checkout --quiet --detach "$BASE_SHA"
# reviewerにcredential-bearing remote URLやglobal Git設定を見せない。target objectはlocal clone済みなので
# remoteを削除してもgit showによるread-only成果物参照は維持できる。
git -C "$TRUSTED_ROOT" remote remove origin
(
  cd -- "$TRUSTED_ROOT"
  npm ci --ignore-scripts
  npm run build
)
if [[ -n "$(git -C "$TRUSTED_ROOT" status --porcelain)" ]]; then
  echo "隔離したprotected base cloneがbuild後にdirtyです。review evidenceを投稿しません。" >&2
  exit 1
fi
TRUSTED_SCRIPT_DIR="$TRUSTED_ROOT/.agent-skill-chain/scripts"

REVIEW_OUTPUT="$("$TRUSTED_SCRIPT_DIR/gate-review.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$TARGET_SHA")"
REPORT_PATH="$(sed -n 's/^gate_report_path: //p' <<<"$REVIEW_OUTPUT")"
if [[ -z "$REPORT_PATH" ]]; then
  echo "gate-report scaffoldを生成できませんでした" >&2
  exit 1
fi

COUNT=1
[[ "$PROFILE" == "strict" ]] && COUNT=2
attempt_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
attempt_id="attempt-${GATE_ID}-${TARGET_SHA:0:12}-${attempt_nonce}"
declare -a run_ids=()
for slot in $(seq 1 "$COUNT"); do
  run_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
  run_ids+=("review-${GATE_ID}-${TARGET_SHA:0:12}-${slot}-${run_nonce}")
done
TOKEN_FILE="$TRUSTED_TMP/launcher-token.json"
token_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
node -e '
  const fs = require("node:fs");
  const [file, attemptId, expectedCount, profile, targetSha, baseSha, prNumber, nonce, ...runIds] = process.argv.slice(1);
  const token = {
    schema_version: "agent-skill-chain/launcher-token/v1",
    attempt_id: attemptId,
    expected_count: Number(expectedCount),
    profile,
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: prNumber,
    nonce,
    slots: runIds.map((run_id, index) => ({slot: index + 1, run_id})),
    consumed_slots: [],
  };
  fs.writeFileSync(file, JSON.stringify(token) + "\n", {mode: 0o600, flag: "wx"});
' "$TOKEN_FILE" "$attempt_id" "$COUNT" "$PROFILE" "$TARGET_SHA" "$BASE_SHA" "$PR_NUMBER" "$token_nonce" "${run_ids[@]}"

for slot in $(seq 1 "$COUNT"); do
  run_id="${run_ids[$((slot - 1))]}"
  ASC_BASE_REF="$BASE_SHA" \
  ASC_EVIDENCE_BASE_SHA="$BASE_SHA" \
  ASC_TRUSTED_BASE_SHA="$BASE_SHA" \
  ASC_EVIDENCE_PR_NUMBER="$PR_NUMBER" \
  ASC_REVIEW_ATTEMPT_ID="$attempt_id" \
  ASC_REVIEW_EXPECTED_COUNT="$COUNT" \
  ASC_LAUNCHER_TOKEN_FILE="$TOKEN_FILE" \
  ASC_REVIEWER_RUN_ID="$run_id" \
  ASC_REVIEWER_SLOT="$slot" \
  ASC_REVIEW_ADAPTER_REQUESTED="$ADAPTER" \
    "$TRUSTED_SCRIPT_DIR/gate-launch-reviewer.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$REPORT_PATH" "$TARGET_SHA"
done
if [[ -e "$TOKEN_FILE" ]]; then
  echo "launcher tokenが全slotで消費されませんでした" >&2
  exit 1
fi
