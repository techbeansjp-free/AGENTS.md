#!/usr/bin/env bash
set -euo pipefail

# 1) ログは workflow.db のみ。.workflow 配下の .md にログっぽい frontmatter（issue_id 等）があれば検知
BAD=$(git diff --name-only --diff-filter=AM 2>/dev/null | grep -E "\.workflow/.+\.md$" || true)
if [[ -n "$BAD" ]]; then
  while read -r f; do
    [[ -z "$f" ]] && continue
    if grep -qE "^issue_id:" "$f" 2>/dev/null; then
      echo "[subagent-guard] ERROR: log-like frontmatter in .md (logs are workflow.db only; .workflow/**/logs/ is deprecated): $f"
      exit 1
    fi
  done <<< "$BAD"
fi

# 2) .workflow/**/logs/ への .md 追加は廃止違反（ログは workflow.db のみ）
LOG_FILES=$(git diff --name-only --diff-filter=AM 2>/dev/null | grep -E "^\.workflow/.+/logs/.+\.md$" || true)
if [[ -n "$LOG_FILES" ]]; then
  echo "[subagent-guard] ERROR: .workflow/**/logs/ is deprecated. Logs must be written to workflow.db only: $LOG_FILES"
  exit 1
fi

echo "[subagent-guard] OK"
