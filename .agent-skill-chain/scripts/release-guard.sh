#!/usr/bin/env bash
# Issue #271: #274単体releaseを機械的に防ぐ一時的なself-repository rollout guard。
# `.agent-skill-chain/RELEASE_BLOCKED_UNTIL_ISSUE_283` が存在する間はfalseを返す。
# Issue #283のtrusted rollout完了commitだけがsentinelを削除し、最初の許可releaseには
# Issue #271とIssue #283の両変更を含める。sentinelは設定/schema入力ではなくconsumerへ配布しない。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"
SENTINEL="$REPO_ROOT/.agent-skill-chain/RELEASE_BLOCKED_UNTIL_ISSUE_283"

release_allowed=true
if [[ -e "$SENTINEL" ]]; then
  release_allowed=false
  printf '%s\n' 'Issue #271: release is blocked until Issue #283 removes the rollout sentinel.'
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'release_allowed=%s\n' "$release_allowed" >> "$GITHUB_OUTPUT"
else
  printf 'release_allowed=%s\n' "$release_allowed"
fi
