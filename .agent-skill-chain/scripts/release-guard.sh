#!/usr/bin/env bash
# Issue #271: #274単体releaseを機械的に防ぐ一時的なself-repository rollout guard。
# official self-repositoryかつsentinel不在の場合だけtrueを返す。repository未設定・別repository・
# sentinel存在のいずれもfalseであり、consumerへ配布されたworkflowがreleaseを生成する余地を閉じる。
# Issue #283のtrusted rollout完了commitだけがsentinelを削除し、最初の許可releaseには
# Issue #271とIssue #283の両変更を含める。sentinelは設定/schema入力ではなくconsumerへ配布しない。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"
SENTINEL="$REPO_ROOT/.agent-skill-chain/RELEASE_BLOCKED_UNTIL_ISSUE_283"

release_allowed=false
if [[ "${GITHUB_REPOSITORY:-}" == "techbeansjp-free/AGENTS.md" && ! -e "$SENTINEL" ]]; then
  release_allowed=true
elif [[ -e "$SENTINEL" ]]; then
  printf '%s\n' 'Issue #271: release is blocked until Issue #283 removes the rollout sentinel.'
else
  printf '%s\n' 'Issue #271: release is allowed only in techbeansjp-free/AGENTS.md.'
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'release_allowed=%s\n' "$release_allowed" >> "$GITHUB_OUTPUT"
else
  printf 'release_allowed=%s\n' "$release_allowed"
fi
