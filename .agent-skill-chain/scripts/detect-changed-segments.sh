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

# Use a temp file instead of process substitution so that `set -e` catches
# `git diff` failures (process substitution exit codes are invisible to
# `set -e` per bash semantics).
tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

if ! git diff --name-only "$BASE_REV...HEAD" >"$tmpfile"; then
  echo "git diff failed for $BASE_REV...HEAD" >&2
  exit 1
fi

declare -A selected=()
while IFS= read -r changed; do
  case "$changed" in
    SPEC.md) selected[spec]=1 ;;
    DESIGN.md|PLAN.md|docs/adr/*) selected[design]=1 ;;
    VALIDATION.md) selected[validation]=1 ;;
    src/*|test/*|package.json|package-lock.json|tsconfig.json) selected[implementation]=1 ;;
  esac
done < "$tmpfile"

for segment in spec design implementation validation; do
  if [[ -n "${selected[$segment]:-}" ]]; then
    printf '%s\n' "$segment"
  fi
done
