#!/usr/bin/env bash
# agent-skill-chain CLI の3経路解決と自動導入フォールバックを共有する。
# CLI が未導入なら既定で npm install -g agent-skill-chain@latest を試行する。
# 対話環境では事前確認を行い、AGENT_SKILL_CHAIN_AUTO_INSTALL=0 で無効化できる。

_ASC_CLI_RESOLVE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_REPO_ROOT="$(cd -- "$_ASC_CLI_RESOLVE_DIR/../.." &>/dev/null && pwd)"
ASC_CLI=()

_asc_try_resolve() {
  ASC_CLI=()

  if [[ -f "$_ASC_CLI_REPO_ROOT/bin/agents-md.js" ]]; then
    ASC_CLI=(node "$_ASC_CLI_REPO_ROOT/bin/agents-md.js")
    return 0
  fi

  if [[ -x "$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    ASC_CLI=("$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain")
    return 0
  fi

  local path_cli
  if path_cli="$(command -v agent-skill-chain 2>/dev/null)" \
    && [[ -f "$path_cli" && -x "$path_cli" && -s "$path_cli" ]] \
    && "$path_cli" --help >/dev/null 2>&1; then
    ASC_CLI=("$path_cli")
    return 0
  fi

  return 1
}

_asc_auto_install() {
  if [[ "${AGENT_SKILL_CHAIN_AUTO_INSTALL:-}" == "0" ]]; then
    echo "agent-skill-chain CLI が見つからず、AGENT_SKILL_CHAIN_AUTO_INSTALL=0 のため自動導入を行いません。" >&2
    return 1
  fi

  if [[ -t 0 && -t 2 ]]; then
    local answer
    if ! read -r -p "agent-skill-chain CLI が見つかりません。npm でグローバル導入しますか? [y/N] " answer \
      || [[ ! "$answer" =~ ^([yY]|[yY][eE][sS])$ ]]; then
      echo "agent-skill-chain CLI の自動導入を利用者が拒否したため、CLIを解決できません。" >&2
      return 1
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "agent-skill-chain CLI が見つからず、自動導入に必要な npm コマンドも見つかりません。" >&2
    return 1
  fi

  echo "agent-skill-chain CLI が見つからないため、npm でグローバル導入を試行します。" >&2
  if ! npm install -g agent-skill-chain@latest >&2; then
    echo "agent-skill-chain CLI の自動導入に失敗しました（npm install -g agent-skill-chain@latest が非ゼロ終了）。" >&2
    return 1
  fi

  local global_prefix
  if ! global_prefix="$(npm prefix -g)"; then
    echo "agent-skill-chain CLI の自動導入は成功しましたが、npm のグローバル導入先を取得できないためCLI実体を再解決できません。" >&2
    return 1
  fi

  PATH="$global_prefix/bin${PATH:+:$PATH}"
  export PATH
  if ! _asc_try_resolve; then
    echo "agent-skill-chain CLI の自動導入は成功しましたが、導入先を含めてもCLI実体を再解決できません。" >&2
    return 1
  fi

  return 0
}

asc_resolve_cli() {
  if _asc_try_resolve; then
    return 0
  fi
  _asc_auto_install
}
