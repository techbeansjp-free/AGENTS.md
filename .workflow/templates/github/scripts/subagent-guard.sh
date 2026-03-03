#!/usr/bin/env bash
set -euo pipefail

# 1) logs/ 以外のログっぽい .md を検知
BAD=$(git diff --name-only --diff-filter=AM 2>/dev/null | grep -E "\.md$" || true)
if [[ -n "$BAD" ]]; then
  while read -r f; do
    [[ -z "$f" ]] && continue
    if [[ "$f" != .workflow/*/logs/* ]]; then
      if grep -qE "^issue_id:" "$f" 2>/dev/null; then
        echo "[subagent-guard] ERROR: log-like frontmatter outside logs/: $f"
        exit 1
      fi
    fi
  done <<< "$BAD"
fi

# 2) logs/ 配下の必須キー検査
LOG_FILES=$(git diff --name-only --diff-filter=AM 2>/dev/null | grep -E "^\.workflow/.+/logs/.+\.md$" || true)
if [[ -n "$LOG_FILES" ]]; then
  while read -r f; do
    [[ -z "$f" ]] && continue
    for key in issue_id agent_id action_type timestamp target_artifact summary; do
      if ! grep -qE "^${key}:" "$f" 2>/dev/null; then
        echo "[subagent-guard] ERROR: missing key ${key} in: $f"
        exit 1
      fi
    done
  done <<< "$LOG_FILES"
fi

echo "[subagent-guard] OK"
