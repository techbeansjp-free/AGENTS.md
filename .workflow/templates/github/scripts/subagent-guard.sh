#!/usr/bin/env bash
# subagent-guard.sh — PR/Push 時に enforcement の失敗条件の一部を検出する。
# 判定ルール・差し戻し先: .agents/enforcement/README.md §失敗条件と差し戻し に従う。
#
# 本 script で検証するもの:
#   - ログは workflow.db のみ。.workflow 配下の .md にログっぽい frontmatter（issue_id 等）禁止
#   - .workflow/**/logs/ への .md 追加禁止（廃止）
#   - 内部参照禁止: 変更された .md 内に .workflow/ や docs/ へのリンクがあれば失敗（PR テンプレ違反に相当）
# 失敗時は 04_review に戻さず、03_実装計画.md または該当 issue ドキュメントに差し戻し。

set -euo pipefail
ROLLBACK_MSG="ROLLBACK: Fix in 03_実装計画.md or the issue doc under .workflow/{issue}/ then re-run verify-and-close. See .agents/enforcement/README.md §失敗条件と差し戻し."

# リビジョン範囲: CI では GITHUB_BASE_SHA..GITHUB_SHA、それ以外は HEAD~1..HEAD
if [[ -n "${GITHUB_BASE_SHA:-}" && -n "${GITHUB_SHA:-}" ]]; then
  REV_RANGE="$GITHUB_BASE_SHA..$GITHUB_SHA"
else
  REV_RANGE="HEAD~1..HEAD"
fi

# 1) ログは workflow.db のみ。.workflow 配下の .md にログっぽい frontmatter（issue_id 等）があれば検知
BAD=$(git diff --name-only --diff-filter=AM "$REV_RANGE" 2>/dev/null | grep -E "\.workflow/.+\.md$" || true)
if [[ -n "$BAD" ]]; then
  while read -r f; do
    [[ -z "$f" ]] && continue
    if grep -qE "^issue_id:" "$f" 2>/dev/null; then
      echo "[subagent-guard] ERROR: log-like frontmatter in .md (logs are workflow.db only; .workflow/**/logs/ is deprecated): $f"
      echo "[subagent-guard] $ROLLBACK_MSG"
      exit 1
    fi
  done <<< "$BAD"
fi

# 2) .workflow/**/logs/ への .md 追加は廃止違反（ログは workflow.db のみ）
LOG_FILES=$(git diff --name-only --diff-filter=AM "$REV_RANGE" 2>/dev/null | grep -E "^\.workflow/.+/logs/.+\.md$" || true)
if [[ -n "$LOG_FILES" ]]; then
  echo "[subagent-guard] ERROR: .workflow/**/logs/ is deprecated. Logs must be written to workflow.db only: $LOG_FILES"
  echo "[subagent-guard] $ROLLBACK_MSG"
  exit 1
fi

# 3) 内部参照禁止（PR テンプレ違反）: 変更された .md に .workflow/ や docs/ へのリンクがあれば失敗
CHANGED_MD=$(git diff --name-only --diff-filter=AM "$REV_RANGE" 2>/dev/null | grep -E '\.md$' || true)
if [[ -n "$CHANGED_MD" ]]; then
  while read -r f; do
    [[ -z "$f" ]] && continue
    # ](./.workflow/ や ](../docs/ や ](.workflow/ 等のパターン
    if grep -qE '\]\([^)]*\.workflow/|\]\([^)]*/docs/|\]\(\./\.workflow|\]\(\.\./docs/' "$f" 2>/dev/null; then
      echo "[subagent-guard] ERROR: 内部参照禁止 (internal link to .workflow/ or docs/ not allowed). File: $f. See 99_PR.md."
      echo "[subagent-guard] $ROLLBACK_MSG"
      exit 1
    fi
  done <<< "$CHANGED_MD"
fi

echo "[subagent-guard] OK"
