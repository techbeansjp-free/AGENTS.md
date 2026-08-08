#!/usr/bin/env bash
# 正本: docs/adr/ADR-0023-agent-skill-chain-as-skill-feasibility.md 調査1(h) /
#       AGENTS.md 前文（UNIX哲学: 検査はgrepできる形で書く）
#
# .agent-skill-chain/templates/claude/skills/*/SKILL.md のYAMLフロントマターから
# description・when_to_use（存在する場合）の文字数を実測し、スキルごとの内訳と合計を
# 標準出力へ出す。特定モデルの文脈長数値やその分母を用いた比率計算は行わない
# （生データの実測・記録のみが目的、ADR-0023実装Issueの要件8参照）。
#
# 単体のシェルスクリプトであり、agent-skill-chain CLIサブコマンドへの委譲は持たない
# （本Issueの対象はスキル説明文の生データ実測のみであり、新たなCLIサブコマンド化は
# 対応する要求が無い機能追加のため行わない）。
#
# 使い方: skill-description-budget.sh [skills_dir]
#   skills_dir: SKILL.md群のディレクトリ（省略時: .agent-skill-chain/templates/claude/skills）
#
# 出力: markdown表形式（skill・description文字数・when_to_use文字数・合計文字数）を標準出力へ。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"
SKILLS_DIR="${1:-$REPO_ROOT/.agent-skill-chain/templates/claude/skills}"

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "スキルディレクトリが見つかりません: $SKILLS_DIR" >&2
  exit 1
fi

# フロントマターの `key: value` 行から値部分を取り出し、前後の空白を除去して文字数を数える
# （C.utf8ロケールでマルチバイト文字を1文字として数える）。
count_field() {
  local file="$1" key="$2"
  local value
  value="$(awk -v key="$key" '
    BEGIN { in_fm = 0 }
    /^---[ \t]*$/ { in_fm++; next }
    in_fm == 1 && $0 ~ "^" key ":" {
      sub("^" key ":[ \t]*", "");
      print;
      exit;
    }
  ' "$file")"
  if [[ -z "$value" ]]; then
    echo 0
    return
  fi
  LC_ALL=C.utf8 printf '%s' "$value" | LC_ALL=C.utf8 wc -m
}

echo "| skill | description_chars | when_to_use_chars | total_chars |"
echo "|---|---|---|---|"

total_description=0
total_when_to_use=0

for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
  [[ -f "$skill_md" ]] || continue
  skill_name="$(basename "$(dirname "$skill_md")")"
  description_chars="$(count_field "$skill_md" "description")"
  when_to_use_chars="$(count_field "$skill_md" "when_to_use")"
  skill_total=$((description_chars + when_to_use_chars))
  total_description=$((total_description + description_chars))
  total_when_to_use=$((total_when_to_use + when_to_use_chars))
  # skill名はバッククォートで囲む（`.agent-skill-chain/scripts/lint-vocab.sh` の散文検査対象になる
  # 出力先 DESCRIPTION_BUDGET.md 上で、識別子の一部が禁止語と偶然一致する場合の誤検出を避けるため）。
  echo "| \`$skill_name\` | $description_chars | $when_to_use_chars | $skill_total |"
done

grand_total=$((total_description + total_when_to_use))
echo "| **合計** | $total_description | $total_when_to_use | $grand_total |"
