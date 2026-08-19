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
# GitHubが返したbase SHAを一時cloneへcheckoutし、信頼実行コード一式をこのclone配下へ用意する。
# 以降はこの隔離clone内のCLI/adapterだけを使用し、source worktreeの生成物を実行しない。
TRUSTED_TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-skill-chain-local-review.XXXXXX")"
trap 'rm -rf -- "$TRUSTED_TMP"' EXIT
TRUSTED_ROOT="$TRUSTED_TMP/repo"
git clone --quiet --no-checkout "$REPO_ROOT" "$TRUSTED_ROOT"
git -C "$TRUSTED_ROOT" checkout --quiet --detach "$BASE_SHA"
# reviewerにcredential-bearing remote URLやglobal Git設定を見せない。target objectはlocal clone済みなので
# remoteを削除してもgit showによるread-only成果物参照は維持できる。
git -C "$TRUSTED_ROOT" remote remove origin
# Issue #759: 削除処理の存在ではなく「remoteが1件も無い」状態そのものを検査する
# （削除が失われた場合に検査が沈黙しないようにするため）。
if [[ -n "$(git -C "$TRUSTED_ROOT" remote)" ]]; then
  echo "隔離cloneにremoteが残っています。review evidenceを投稿しません。" >&2
  exit 1
fi

# Issue #759: 準備段の目的は「信頼実行環境の用意」に限る。consumer固有のビルド処理は起動せず、
# その成否も前提にしない。判定入力はbase SHAのコミット内容だけであり、作業ツリー状態・環境変数・
# PATH・npmの有無を用いない（審査対象や実行環境からモードを動かせないようにするため）。
PROCUREMENT_MODE="package_copy"
if TRUSTED_PACKAGE_JSON="$(git -C "$TRUSTED_ROOT" show "${BASE_SHA}:package.json" 2>/dev/null)"; then
  if printf '%s' "$TRUSTED_PACKAGE_JSON" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let pkg;
      try { pkg = JSON.parse(raw); } catch (error) { process.exit(1); }
      const hasEntry =
        (typeof pkg.bin === "string" && pkg.name === "agent-skill-chain") ||
        (pkg.bin && typeof pkg.bin === "object" && typeof pkg.bin["agent-skill-chain"] === "string");
      process.exit(pkg && pkg.name === "agent-skill-chain" && hasEntry ? 0 : 1);
    });
  '; then
    PROCUREMENT_MODE="clone_build"
  fi
fi

PROCUREMENT_SOURCE=""
PROCUREMENT_DIGEST=""
if [[ "$PROCUREMENT_MODE" == "clone_build" ]]; then
  # 隔離clone自身がagent-skill-chain本体のソースを持つ場合に限り、そのCLIを生成する。
  # ここで走るbuildはagent-skill-chain自身のCLI生成であり、consumer固有のビルドではない。
  (
    cd -- "$TRUSTED_ROOT"
    npm ci --ignore-scripts
    npm run build
  )
  PROCUREMENT_SOURCE="clone_build:${BASE_SHA}"
else
  # Issue #759: `.git/info/exclude` はuntracked pathにのみ作用する。base SHAが node_modules/ 配下を
  # tracked にしている場合、調達物の配置がtracked pathの変更として現れ「隔離したprotected base clone
  # がcleanである」という前提が破れる。安全側（I8）へ倒し、調達へ進まずに停止する。
  if [[ -n "$(git -C "$TRUSTED_ROOT" ls-tree -r --name-only "$BASE_SHA" -- node_modules)" ]]; then
    echo "base SHAが node_modules/ 配下をtrackしているため信頼実行環境を用意できません。前提: 調達物の配置先（隔離clone直下の node_modules/）がbase SHAのtracked pathと重ならないこと。是正: default branchで node_modules/ の追跡を外してから再実行してください。" >&2
    exit 1
  fi
  # 調達物の配置先だけを除外する。それ以外の差分検知能力は変えない。
  printf '/node_modules/\n' >> "$TRUSTED_ROOT/.git/info/exclude"

  TRUSTED_CLI_RESOLVE="$TRUSTED_ROOT/.agent-skill-chain/scripts/cli-resolve.sh"
  if [[ ! -r "$TRUSTED_CLI_RESOLVE" ]]; then
    echo "隔離clone内にCLI解決の共有実装がありません（探索パス: ${TRUSTED_CLI_RESOLVE}）。前提: base SHAが調達段の実装を含むこと。是正: 調達段を含む版をdefault branchへ反映してから再実行してください。" >&2
    exit 1
  fi
  # 呼び出し元（protected base worktreeの作業ツリー版）で代替しない。代替すると証跡のlauncher digestが
  # 指すbase SHAの実装と、実際に走った調達コードが食い違う。
  # shellcheck source=/dev/null
  source "$TRUSTED_CLI_RESOLVE"
  if ! declare -F asc_procure_trusted_cli >/dev/null; then
    echo "隔離clone内のCLI解決実装に調達段の公開関数がありません（探索パス: ${TRUSTED_CLI_RESOLVE}）。前提: base SHAが調達段の実装を含むこと。是正: 調達段を含む版をdefault branchへ反映してから再実行してください。" >&2
    exit 1
  fi
  PROCUREMENT_OUTPUT="$(asc_procure_trusted_cli "$TRUSTED_ROOT" "$BASE_SHA" "$REPO_ROOT")"
  PROCUREMENT_MODE="$(sed -n 's/^procurement_mode: //p' <<<"$PROCUREMENT_OUTPUT")"
  PROCUREMENT_SOURCE="$(sed -n 's/^procurement_source: //p' <<<"$PROCUREMENT_OUTPUT")"
  PROCUREMENT_DIGEST="$(sed -n 's/^procurement_digest: //p' <<<"$PROCUREMENT_OUTPUT")"
  if [[ "$PROCUREMENT_MODE" != "package_copy" || -z "$PROCUREMENT_SOURCE" || -z "$PROCUREMENT_DIGEST" ]]; then
    echo "調達結果（調達モード・調達元識別子・実体digest）を確定できませんでした。" >&2
    exit 1
  fi
fi

if [[ -n "$(git -C "$TRUSTED_ROOT" status --porcelain)" ]]; then
  echo "隔離したprotected base cloneがbuild後にdirtyです。review evidenceを投稿しません。" >&2
  exit 1
fi
TRUSTED_SCRIPT_DIR="$TRUSTED_ROOT/.agent-skill-chain/scripts"

attempt_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
attempt_id="attempt-${GATE_ID}-${TARGET_SHA:0:12}-${attempt_nonce}"
REVIEW_OUTPUT="$(
  ASC_TRUSTED_CLI_ROOT="$TRUSTED_ROOT" \
  ASC_EVIDENCE_BASE_SHA="$BASE_SHA" \
  ASC_EVIDENCE_PR_NUMBER="$PR_NUMBER" \
  ASC_REVIEW_ATTEMPT_ID="$attempt_id" \
    "$TRUSTED_SCRIPT_DIR/gate-review.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$TARGET_SHA"
)"
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

COUNT=1
[[ "$PROFILE" == "strict" ]] && COUNT=2
declare -a run_ids=()
for slot in $(seq 1 "$COUNT"); do
  run_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
  run_ids+=("review-${GATE_ID}-${TARGET_SHA:0:12}-${slot}-${run_nonce}")
done
TOKEN_FILE="$TRUSTED_TMP/launcher-token.json"
token_nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
node -e '
  const fs = require("node:fs");
  const [
    file, attemptId, expectedCount, profile, targetSha, baseSha, prNumber, nonce,
    trustedRoot, procurementMode, procurementSource, procurementDigest, ...runIds
  ] = process.argv.slice(1);
  const token = {
    schema_version: "agent-skill-chain/launcher-token/v1",
    attempt_id: attemptId,
    expected_count: Number(expectedCount),
    profile,
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: prNumber,
    nonce,
    trusted_root: trustedRoot,
    procurement: {
      mode: procurementMode,
      source: procurementSource,
      ...(procurementDigest ? {digest: procurementDigest} : {}),
    },
    slots: runIds.map((run_id, index) => ({slot: index + 1, run_id})),
    consumed_slots: [],
  };
  fs.writeFileSync(file, JSON.stringify(token) + "\n", {mode: 0o600, flag: "wx"});
' "$TOKEN_FILE" "$attempt_id" "$COUNT" "$PROFILE" "$TARGET_SHA" "$BASE_SHA" "$PR_NUMBER" "$token_nonce" \
  "$TRUSTED_ROOT" "$PROCUREMENT_MODE" "$PROCUREMENT_SOURCE" "$PROCUREMENT_DIGEST" "${run_ids[@]}"

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
  ASC_TRUSTED_CLI_ROOT="$TRUSTED_ROOT" \
    "$TRUSTED_SCRIPT_DIR/gate-launch-reviewer.sh" "$ISSUE_ID" "$GATE_ID" "$PROFILE" "$REPORT_PATH" "$TARGET_SHA"
done
if [[ -e "$TOKEN_FILE" ]]; then
  echo "launcher tokenが全slotで消費されませんでした" >&2
  exit 1
fi

# Issue #680: Check Run発行にはGitHub Appが必要だが、本プロジェクトはGitHub Appを
# 使わず受信workflowも置かないため、repository_dispatchは送出しない。
