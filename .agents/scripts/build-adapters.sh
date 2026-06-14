#!/usr/bin/env bash
# build-adapters.sh — 正本 .agents/ から各ツール向けアダプタを .adapters/<tool>/ に生成する統合ディスパッチャ。
#
# 方針: 仕様の正本はリポジトリルートの .agents/。本スクリプトの出力(.adapters/<tool>/ 配下)は
#       100% 生成物であり手で編集しない。手書きの土台は .adapters/ の外（正本側）に置く:
#         - Claude:  .agents/platforms/claude/plugin.json（plugin.json の正本）
#         - Cursor:  .agents/enforcement/cursor/agents-core.mdc（ルールの正本）
#       スキル正本は .agents/skills/{domain}/{capability}/。配備先は {domain}__{capability}。
# 対象ツール: 現状 claude / cursor のみ。gemini/copilot/codex は配置パス確認待ちのため未実装
#            （adapter_<tool>() を足し SUPPORTED_TOOLS に登録すれば拡張可能）。
# 参照: docs/maintainer/adapters.md, .agents/platforms/SKILLS.md, .agents/platforms/DESIGN_SYNC_SKILLS_NAMING.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # .agents/scripts -> repo root
AGENTS="$REPO_ROOT/.agents"
ADAPTERS_ROOT="$REPO_ROOT/.adapters"

# 実装済みツール（adapter_<tool>() が存在するもの）。将来 gemini/copilot/codex を追加する際はここに足す。
SUPPORTED_TOOLS="claude cursor"

[[ -d "$AGENTS" ]] || { echo "エラー: .agents が見つかりません: $AGENTS" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 共通配備関数（出力ルートを引数化）。各ツールの adapter_<tool>() から呼ぶ。
# ----------------------------------------------------------------------------

# deploy_skills <out_skills_dir>
#   .agents/skills/{domain}/{capability}/ を {domain}__{capability}/ で配備する。
#   ドメイン直下に SKILL.md があるケース（例: agent/）は {domain} で配備する。
#   命名規約 {domain}__{capability} の単一定義はここに集約する（参照: DESIGN_SYNC_SKILLS_NAMING.md）。
deploy_skills() {
  local out_skills="$1"
  local n_skill=0
  mkdir -p "$out_skills"
  for domain_dir in "$AGENTS"/skills/*/; do
    [[ -d "$domain_dir" ]] || continue
    local domain
    domain=$(basename "$domain_dir")
    # ドメイン直下に SKILL.md があるケース（例: agent/）
    if [[ -f "$domain_dir/SKILL.md" ]]; then
      mkdir -p "$out_skills/$domain"
      cp "$domain_dir/SKILL.md" "$out_skills/$domain/SKILL.md"
      [[ -f "$domain_dir/README.md" ]] && cp "$domain_dir/README.md" "$out_skills/$domain/README.md"
      n_skill=$((n_skill+1))
    fi
    # capability 配下の SKILL.md
    local cap_dir cap dest
    for cap_dir in "$domain_dir"*/; do
      [[ -d "$cap_dir" ]] || continue
      cap=$(basename "$cap_dir")
      [[ -f "$cap_dir/SKILL.md" ]] || continue
      dest="$out_skills/${domain}__${cap}"
      mkdir -p "$dest"
      cp -R "$cap_dir"/* "$dest"/ 2>/dev/null || true
      n_skill=$((n_skill+1))
    done
  done
  echo "[build] skills を $n_skill 件配備しました。"
}

# deploy_commands <out_commands_dir>
#   commands（skill chain 定義）を配備する。
deploy_commands() {
  local out_commands="$1"
  local n_cmd=0
  mkdir -p "$out_commands"
  if compgen -G "$AGENTS/commands/*.md" > /dev/null; then
    local f
    for f in "$AGENTS"/commands/*.md; do
      cp "$f" "$out_commands/$(basename "$f")"
      n_cmd=$((n_cmd+1))
    done
  fi
  echo "[build] commands を $n_cmd 件配備しました。"
}

# deploy_agents <out_agents_dir>
#   agents（オーケストレーション役。README.md は除く）を配備する。
deploy_agents() {
  local out_agents="$1"
  local n_agent=0
  mkdir -p "$out_agents"
  if compgen -G "$AGENTS/agents/*.md" > /dev/null; then
    local f base
    for f in "$AGENTS"/agents/*.md; do
      base=$(basename "$f")
      [[ "$base" == "README.md" ]] && continue
      cp "$f" "$out_agents/$base"
      n_agent=$((n_agent+1))
    done
  fi
  echo "[build] agents を $n_agent 件配備しました。"
}

# bundle_agents_src <out_dir>
#   .agents/ を同梱（アダプタを自己完結させる。フック・command 本文がこれを参照する）。
#   保守/導入専用スクリプトは同梱不要（アダプタでは使わない・二重管理回避）。
bundle_agents_src() {
  local out="$1"
  rm -rf "$out/.agents"
  cp -R "$AGENTS" "$out/.agents"
  rm -f "$out/.agents/scripts/setup.sh" \
        "$out/.agents/scripts/build-plugin-claude.sh" \
        "$out/.agents/scripts/build-adapters.sh"
  echo "[build] .agents を同梱しました（保守/導入専用スクリプトは除外）。"
}

# write_generated_marker <out_dir>
#   生成物であることの目印を置く。
write_generated_marker() {
  local out="$1"
  cat > "$out/GENERATED.md" <<'MD'
<!-- このディレクトリ配下(.claude-plugin/ と この目印を除く)は .agents/ からの生成物です。手で編集しないでください。 -->
<!-- 再生成: bash .agents/scripts/build-plugin-claude.sh -->
MD
}

# ----------------------------------------------------------------------------
# ツール別アダプタ
# ----------------------------------------------------------------------------

# adapter_claude — Claude Code プラグインを .adapters/claude/ に生成する。
#   出力: skills/commands/agents/hooks/.agents 同梱・.claude-plugin/plugin.json（正本コピー）・GENERATED.md。
adapter_claude() {
  local out="$ADAPTERS_ROOT/claude"
  [[ -f "$AGENTS/platforms/claude/plugin.json" ]] || {
    echo "エラー: $AGENTS/platforms/claude/plugin.json が見つかりません（手書きの正本が必要）" >&2; exit 1; }

  echo "[build] 正本:       $AGENTS"
  echo "[build] 出力先:     $out"

  # 生成パートを掃除（.adapters/claude/ は 100% 生成物なので .claude-plugin/ も含めて再生成）
  rm -rf "$out/skills" "$out/commands" "$out/agents" "$out/hooks" "$out/.agents" "$out/.claude-plugin"
  mkdir -p "$out/skills" "$out/commands" "$out/agents" "$out/hooks"

  # 0) plugin.json を正本からコピー生成（手書き正本: .agents/platforms/claude/plugin.json）
  mkdir -p "$out/.claude-plugin"
  cp "$AGENTS/platforms/claude/plugin.json" "$out/.claude-plugin/plugin.json"
  echo "[build] .claude-plugin/plugin.json を正本からコピーしました。"

  # 1) .agents/ を同梱
  bundle_agents_src "$out"

  # 2) skills を Agent Skills 形式で配備（{domain}__{capability}）
  deploy_skills "$out/skills"

  # 3) commands（skill chain 定義）
  deploy_commands "$out/commands"

  # 4) agents（オーケストレーション役）
  deploy_agents "$out/agents"

  # 5) hooks: enforcement/claude のフックを同梱 .agents 基準で呼ぶ。
  #    フックは AGENTS_ROOT で正本パスを差し替え可能（参照: enforcement/claude/PreToolUse.sh）。
  cat > "$out/hooks/hooks.json" <<'JSON'
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
  write_generated_marker "$out"

  echo "[build] 完了。試用: claude --plugin-dir .adapters/claude"
}

# adapter_cursor — Cursor 用アダプタを .adapters/cursor/ に生成する（claude と対称）。
#   出力: .cursor/rules/agents-core.mdc（正本コピー）・.cursor/skills/{domain}__{capability}/・.agents 同梱・GENERATED.md。
#   Cursor のパス規約は platforms/SKILLS.md（.cursor/skills/<name>/）に整合させる。
adapter_cursor() {
  local out="$ADAPTERS_ROOT/cursor"
  [[ -f "$AGENTS/enforcement/cursor/agents-core.mdc" ]] || {
    echo "エラー: $AGENTS/enforcement/cursor/agents-core.mdc が見つかりません（ルールの正本が必要）" >&2; exit 1; }

  echo "[build] 正本:       $AGENTS"
  echo "[build] 出力先:     $out"

  # 生成パートを掃除（.adapters/cursor/ は 100% 生成物）
  rm -rf "$out/.cursor" "$out/.agents"
  mkdir -p "$out/.cursor/rules" "$out/.cursor/skills"

  # 0) ルールを正本からコピー生成（手書き正本: .agents/enforcement/cursor/agents-core.mdc）
  cp "$AGENTS/enforcement/cursor/agents-core.mdc" "$out/.cursor/rules/agents-core.mdc"
  echo "[build] .cursor/rules/agents-core.mdc を正本からコピーしました。"

  # 1) .agents/ を同梱（command 本文・正本参照を自己完結させる）
  bundle_agents_src "$out"

  # 2) skills を Agent Skills 形式で配備（{domain}__{capability}）
  deploy_skills "$out/.cursor/skills"

  # 生成物であることの目印
  write_generated_marker "$out"

  echo "[build] 完了。Cursor ルール: .adapters/cursor/.cursor/rules/agents-core.mdc"
}

# ----------------------------------------------------------------------------
# ディスパッチ
# ----------------------------------------------------------------------------

is_supported() {
  local tool="$1" t
  for t in $SUPPORTED_TOOLS; do
    [[ "$t" == "$tool" ]] && return 0
  done
  return 1
}

main() {
  # 対象ツールの決定: 引数 > 環境変数 TOOLS > 全対象ツール
  local tools
  if [[ $# -gt 0 ]]; then
    tools="$*"
  elif [[ -n "${TOOLS:-}" ]]; then
    tools="${TOOLS//,/ }"
  else
    tools="$SUPPORTED_TOOLS"
  fi

  local tool
  for tool in $tools; do
    if ! is_supported "$tool"; then
      echo "エラー: 未対応のツールです: '$tool'（対応: $SUPPORTED_TOOLS）" >&2
      exit 1
    fi
  done

  for tool in $tools; do
    echo "[build] === アダプタ生成: $tool ==="
    "adapter_$tool"
  done
}

main "$@"
