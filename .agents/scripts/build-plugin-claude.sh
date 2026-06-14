#!/usr/bin/env bash
# build-plugin-claude.sh — 正本 .agents/ から Claude Code プラグインを .adapters/claude/ に生成する。
#
# 方針: 仕様の正本はリポジトリルートの .agents/。本スクリプトの出力(.adapters/claude/ 配下)は
#       100% 生成物であり手で編集しない。手書きの土台は .adapters/ の外（正本側）に置く:
#       手書き正本は .agents/platforms/claude/plugin.json と docs/maintainer/adapters.md。
# 参照: docs/maintainer/adapters.md, .agents/platforms/SKILLS.md, .agents/platforms/DESIGN_SYNC_SKILLS_NAMING.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # .agents/scripts -> repo root
AGENTS="$REPO_ROOT/.agents"
OUT="$REPO_ROOT/.adapters/claude"

[[ -d "$AGENTS" ]] || { echo "エラー: .agents が見つかりません: $AGENTS" >&2; exit 1; }
[[ -f "$AGENTS/platforms/claude/plugin.json" ]] || { echo "エラー: $AGENTS/platforms/claude/plugin.json が見つかりません（手書きの正本が必要）" >&2; exit 1; }

echo "[build] 正本:       $AGENTS"
echo "[build] 出力先:     $OUT"

# 生成パートを掃除（.adapters/claude/ は 100% 生成物なので .claude-plugin/ も含めて再生成）
rm -rf "$OUT/skills" "$OUT/commands" "$OUT/agents" "$OUT/hooks" "$OUT/.agents" "$OUT/.claude-plugin"
mkdir -p "$OUT/skills" "$OUT/commands" "$OUT/agents" "$OUT/hooks"

# 0) plugin.json を正本からコピー生成（手書き正本: .agents/platforms/claude/plugin.json）
mkdir -p "$OUT/.claude-plugin"
cp "$AGENTS/platforms/claude/plugin.json" "$OUT/.claude-plugin/plugin.json"
echo "[build] .claude-plugin/plugin.json を正本からコピーしました。"

# 1) .agents/ を同梱（プラグインを自己完結させる。フック・command 本文がこれを参照する）
cp -R "$AGENTS" "$OUT/.agents"
# 保守/導入専用スクリプトは同梱不要（プラグインでは使わない・二重管理回避）
rm -f "$OUT/.agents/scripts/setup.sh" "$OUT/.agents/scripts/build-plugin-claude.sh"
echo "[build] .agents を同梱しました（保守/導入専用スクリプトは除外）。"

# 2) skills を Agent Skills 形式で配備（{domain}__{capability}、ドメイン直下 SKILL.md は {domain}）
n_skill=0
for domain_dir in "$AGENTS"/skills/*/; do
  [[ -d "$domain_dir" ]] || continue
  domain=$(basename "$domain_dir")
  # ドメイン直下に SKILL.md があるケース（例: agent/）
  if [[ -f "$domain_dir/SKILL.md" ]]; then
    mkdir -p "$OUT/skills/$domain"
    cp "$domain_dir/SKILL.md" "$OUT/skills/$domain/SKILL.md"
    [[ -f "$domain_dir/README.md" ]] && cp "$domain_dir/README.md" "$OUT/skills/$domain/README.md"
    n_skill=$((n_skill+1))
  fi
  # capability 配下の SKILL.md
  for cap_dir in "$domain_dir"*/; do
    [[ -d "$cap_dir" ]] || continue
    cap=$(basename "$cap_dir")
    [[ -f "$cap_dir/SKILL.md" ]] || continue
    dest="$OUT/skills/${domain}__${cap}"
    mkdir -p "$dest"
    cp -R "$cap_dir"/* "$dest"/ 2>/dev/null || true
    n_skill=$((n_skill+1))
  done
done
echo "[build] skills を $n_skill 件配備しました。"

# 3) commands（skill chain 定義）
n_cmd=0
if compgen -G "$AGENTS/commands/*.md" > /dev/null; then
  for f in "$AGENTS"/commands/*.md; do
    cp "$f" "$OUT/commands/$(basename "$f")"
    n_cmd=$((n_cmd+1))
  done
fi
echo "[build] commands を $n_cmd 件配備しました。"

# 4) agents（オーケストレーション役。README.md は除く）
n_agent=0
if compgen -G "$AGENTS/agents/*.md" > /dev/null; then
  for f in "$AGENTS"/agents/*.md; do
    base=$(basename "$f")
    [[ "$base" == "README.md" ]] && continue
    cp "$f" "$OUT/agents/$base"
    n_agent=$((n_agent+1))
  done
fi
echo "[build] agents を $n_agent 件配備しました。"

# 5) hooks: enforcement/claude のフックを同梱 .agents 基準で呼ぶ。
#    フックは AGENTS_ROOT で正本パスを差し替え可能（参照: enforcement/claude/PreToolUse.sh）。
cat > "$OUT/hooks/hooks.json" <<'JSON'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "AGENTS_ROOT=\"${CLAUDE_PLUGIN_ROOT}/.agents\" bash \"${CLAUDE_PLUGIN_ROOT}/.agents/enforcement/claude/PreToolUse.sh\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "AGENTS_ROOT=\"${CLAUDE_PLUGIN_ROOT}/.agents\" bash \"${CLAUDE_PLUGIN_ROOT}/.agents/enforcement/claude/PostToolUse.sh\""
          }
        ]
      }
    ]
  }
}
JSON
echo "[build] hooks/hooks.json を生成しました。"

# 生成物であることの目印
cat > "$OUT/GENERATED.md" <<'MD'
<!-- このディレクトリ配下(.claude-plugin/ と この目印を除く)は .agents/ からの生成物です。手で編集しないでください。 -->
<!-- 再生成: bash .agents/scripts/build-plugin-claude.sh -->
MD

echo "[build] 完了。試用: claude --plugin-dir .adapters/claude"
