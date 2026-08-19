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
  echo "指定baseがrepository default branchまたはGitHub PR metadataと一致しません（ref=$PR_BASE_REF, default=$DEFAULT_BRANCH, base=$PR_BASE_SHA, head=${PR_HEAD_SHA}）" >&2
  exit 1
fi

CURRENT_ROOT="$(git -C "$REPO_ROOT" rev-parse --show-toplevel)"
if [[ "$CURRENT_ROOT" != "$REPO_ROOT" ]]; then
  echo "protected base worktreeのrootが一致しません（resolved=$CURRENT_ROOT, configured=${REPO_ROOT}）" >&2
  exit 1
fi
CURRENT_BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD || true)"
if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
  echo "repository default branchのworktreeから実行してください（current=${CURRENT_BRANCH:-detached}, default=${DEFAULT_BRANCH}）" >&2
  exit 1
fi
if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$BASE_SHA" HEAD; then
  echo "指定base_shaはrepository default branchから到達不能です（base_sha=$BASE_SHA, branch=${DEFAULT_BRANCH}）" >&2
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
TRUSTED_ROOT="$TRUSTED_TMP/repo"

# Issue #733: gate-report scaffold を生成してからレビュアを起動するまでの区間で非ゼロ終了すると、
# conformance/falsification/final がいずれも pending の scaffold だけが残り、判定の欠落が無言で放置される。
# set -euo pipefail 下では attempt 記録の POST 失敗のようにこの区間のどの失敗も即時終了になるため、
# 失敗箇所ごとに包むのではなく区間全体を EXIT trap で安全側へ倒す（AGENTS.md I8）。
# レビュア起動後は gate-launch-reviewer.sh 側の安全網が最終判定を確定させるので、起動直前に
# PENDING_REPORT_PATH を空へ戻し、deferred 表明や記録済みの判定を本 trap が上書きしないようにする。
PENDING_REPORT_PATH=""
_asc_local_review_exit() {
  local code=$?
  if [[ "$code" -ne 0 && -n "$PENDING_REPORT_PATH" && -f "$TRUSTED_ROOT/bin/agents-md.js" ]]; then
    echo "レビュアを起動できないまま終了しました。gate-report を human_required へ倒します（${PENDING_REPORT_PATH}）" >&2
    node "$TRUSTED_ROOT/bin/agents-md.js" gate mark-human-required "$PENDING_REPORT_PATH" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TRUSTED_TMP"
}
trap _asc_local_review_exit EXIT
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
EFFECTIVE_PROFILE="$(sed -n 's/^review_profile: //p' <<<"$REVIEW_OUTPUT")"
if [[ -z "$REPORT_PATH" ]]; then
  echo "gate-report scaffoldを生成できませんでした" >&2
  exit 1
fi
if [[ "$EFFECTIVE_PROFILE" != "standard" && "$EFFECTIVE_PROFILE" != "strict" ]]; then
  echo "gate reviewの実効レビュープロファイルを解決できませんでした" >&2
  exit 1
fi
PROFILE="$EFFECTIVE_PROFILE"
PENDING_REPORT_PATH="$REPORT_PATH"

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

attempt_request="$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const [tokenFile, issueId, gate, targetSha] = process.argv.slice(1);
  const token = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const { consumed_slots: _consumedSlots, ...tokenPayload } = token;
  const launcherTokenDigest = `sha256:${crypto.createHash("sha256").update(canonical(tokenPayload)).digest("hex")}`;
  const attempt = {
    schema_version: "agent-skill-chain/gate-review-attempt/v1",
    issue_id: issueId,
    gate,
    profile: token.profile,
    target_sha: targetSha,
    attempt_id: token.attempt_id,
    expected_count: token.expected_count,
    execution: {
      trusted_base_sha: token.base_sha,
      launcher_token_digest: launcherTokenDigest,
    },
    reviewers: token.slots,
  };
  const body = `<!-- agent-skill-chain:gate-review-attempt -->\n\`\`\`json\n${JSON.stringify(attempt, null, 2)}\n\`\`\`\n`;
  process.stdout.write(JSON.stringify({body, event: "COMMENT", commit_id: targetSha}));
' "$TOKEN_FILE" "$ISSUE_ID" "$GATE_ID" "$TARGET_SHA")"
gh api -X POST "repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews" --input - <<<"$attempt_request" >/dev/null

PENDING_REPORT_PATH=""
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

# Issue #680: Check Run発行にはGitHub Appが必要だが、本プロジェクトはGitHub Appを
# 使わず受信workflowも置かないため、repository_dispatchは送出しない。
