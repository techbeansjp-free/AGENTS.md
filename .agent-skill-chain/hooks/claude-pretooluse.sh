#!/usr/bin/env bash
# 正本: AGENTS.md §不変条件（I5） / .agent-skill-chain/project/自己拡張ワークフロー.md（2026-07-15事故記録）
#
# Claude Code PreToolUse hook 本体。`agent-skill-chain enforce on` が対象プロジェクトの
# .claude/settings.json へ配線するスクリプトそのもの。
#
# 設計方針（ADR-2: ツール名の一律allow/denyリストにしない狭い安全網）:
#   - matcher は tool_name=="Bash" のみ。非Bashツール（Agent/Task等）は本スクリプト自体が
#     呼ばれないため、構造的に評価対象外となる（2026-07-15型事故の再発防止）。
#   - 拒否パターンは以下2種類のみに限定する。それ以外の全Bashコマンドは無条件で通過する
#     （fail-open）。
#     (1) `agent-skill-chain cleanup`/`cleanup.sh` を経由しない `git worktree remove` の直接実行
#     (2) 命名規約（.agent-skill-chain/config/agent-skill-chain.yamlのbranch.pattern・
#         issue.allowed_types）に違反するブランチ作成
#
# 緊急解除（ADR-4）: 本hookはClaude CodeのBashツール呼び出し経路上でのみ発火する。人間が
# Claude Code外の通常シェルから直接 `agent-skill-chain enforce off` を実行する経路は対象外であり、
# 迂回コードを本スクリプトに実装しない。

set -euo pipefail

INPUT="$(cat)"

# tool_name・tool_input.command を抽出する。JSON解析にjq依存を持ち込まない
# （本パッケージがnode>=20を必須要件としているため、既存依存のnodeのみで完結させる）。
# 値はbase64化して受け渡す: commandに改行・特殊文字が含まれてもbash側の行分割処理を壊さないため。
DECODED="$(node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  let toolName = "";
  let command = "";
  try {
    const json = JSON.parse(data);
    toolName = typeof json.tool_name === "string" ? json.tool_name : "";
    if (json.tool_input && typeof json.tool_input.command === "string") {
      command = json.tool_input.command;
    }
  } catch {
    // 解析失敗時は両方空文字のまま fail-open（下流のtool_name判定でexit 0になる）。
  }
  process.stdout.write(Buffer.from(toolName, "utf8").toString("base64") + "\n");
  process.stdout.write(Buffer.from(command, "utf8").toString("base64") + "\n");
});
' <<<"$INPUT")"

TOOL_NAME_B64="$(sed -n '1p' <<<"$DECODED")"
COMMAND_B64="$(sed -n '2p' <<<"$DECODED")"
TOOL_NAME="$(printf '%s' "$TOOL_NAME_B64" | base64 -d 2>/dev/null || true)"
COMMAND="$(printf '%s' "$COMMAND_B64" | base64 -d 2>/dev/null || true)"

# matcher: tool_name=="Bash" のみを検査対象とする（ADR-2の核心）。
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# 拒否パターン1: cleanupを経由しない git worktree remove の直接実行。
if [[ "$COMMAND" == *"git worktree remove"* ]] && [[ "$COMMAND" != *"cleanup"* ]]; then
  echo "拒否: git worktree remove の直接実行は禁止されています。agent-skill-chain cleanup <issue_id> を使用してください。" >&2
  exit 2
fi

# 拒否パターン2: 命名規約に違反するブランチ作成（git branch <name> 作成形 /
# git checkout -b|-B <name> / git switch -c|-C <name>）。
BRANCH_NAME=""
if [[ "$COMMAND" =~ git[[:space:]]+branch[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*([^-[:space:]][^[:space:]]*) ]]; then
  BRANCH_NAME="${BASH_REMATCH[2]}"
elif [[ "$COMMAND" =~ git[[:space:]]+checkout[[:space:]]+-[bB][[:space:]]+([^[:space:]]+) ]]; then
  BRANCH_NAME="${BASH_REMATCH[1]}"
elif [[ "$COMMAND" =~ git[[:space:]]+switch[[:space:]]+-[cC][[:space:]]+([^[:space:]]+) ]]; then
  BRANCH_NAME="${BASH_REMATCH[1]}"
fi

if [[ -n "$BRANCH_NAME" ]]; then
  ALLOWED_TYPES="feature|bugfix|hotfix|refactor|docs|process"
  CONFIG_PATH=""
  for candidate in \
    "$(pwd)/.agent-skill-chain/config/agent-skill-chain.yaml" \
    "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)/config/agent-skill-chain.yaml"
  do
    if [[ -f "$candidate" ]]; then
      CONFIG_PATH="$candidate"
      break
    fi
  done
  if [[ -n "$CONFIG_PATH" ]]; then
    CONFIG_TYPES="$(grep -E '^\s*allowed_types:' "$CONFIG_PATH" | sed -E 's/.*\[(.*)\].*/\1/' | tr -d ' ' | tr ',' '|')"
    if [[ -n "$CONFIG_TYPES" ]]; then
      ALLOWED_TYPES="$CONFIG_TYPES"
    fi
  fi
  # branch.pattern の既定形 "{type}/{issue_id}-{slug}" に対応する形式のみ許可する。
  if ! [[ "$BRANCH_NAME" =~ ^(${ALLOWED_TYPES})/[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "拒否: ブランチ名が命名規約 <type>/<issue_id>-<slug> に違反しています: ${BRANCH_NAME}" >&2
    exit 2
  fi
fi

exit 0
