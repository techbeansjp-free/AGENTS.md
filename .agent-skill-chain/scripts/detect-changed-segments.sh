#!/usr/bin/env bash
# PR差分から開始済みセグメントを固定順で出力する。未開始セグメントをCIの失敗対象にしないため、
# verify-artifacts と gate workflow が共通して利用する。

set -euo pipefail

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
  echo "使い方: detect-changed-segments.sh <base_ref>" >&2
  exit 1
fi

if git rev-parse --verify --quiet "origin/$BASE_REF" >/dev/null; then
  BASE_REV="origin/$BASE_REF"
elif git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  BASE_REV="$BASE_REF"
else
  echo "base branchを解決できません: $BASE_REF" >&2
  exit 1
fi

declare -A selected=()
CHANGED_PATHS="$(mktemp "${TMPDIR:-/tmp}/agent-skill-chain-changed-paths.XXXXXX")"
trap 'rm -f -- "$CHANGED_PATHS"' EXIT
git diff --name-only -z "$BASE_REV...HEAD" > "$CHANGED_PATHS"
while IFS= read -r -d '' changed; do
  case "$changed" in
    SPEC.md) selected[spec]=1 ;;
    DESIGN.md|PLAN.md|docs/adr/*) selected[design]=1 ;;
    VALIDATION.md) selected[validation]=1 ;;
    src/*|test/*|package.json|package-lock.json|tsconfig.json) selected[implementation]=1 ;;
  esac
done < "$CHANGED_PATHS"

for segment in spec design implementation validation; do
  if [[ -n "${selected[$segment]:-}" ]]; then
    printf '%s\n' "$segment"
  fi
done
