import path from 'node:path';
import fs from 'node:fs';
import { resolveAsset } from '../lib/paths.js';
import { readSettings, writeSettings, addPreToolUseHook, removePreToolUseHook } from '../lib/claude-settings.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain enforce <on|off> [target_dir]

on:  PreToolUse hookを配線する。
off: PreToolUse hookを解除する（既に非配線なら何もせず成功する）。
target_dir: 対象リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。配線/解除したエントリ・保護対象パターン一覧を標準出力へ。
  失敗時（.claude/settings.json のJSON解析失敗）: 終了コード1以上。理由を標準エラー出力へ（ファイルは変更しない）。
`;

/** `.claude/settings.json` へ記録するhookのcommandパス（target_dirからの相対パス）。doctor拡張が照合にも使う。 */
export const HOOK_RELATIVE_PATH = path.join('.agent-skill-chain', 'hooks', 'claude-pretooluse.sh');

const ON_WARNING = [
  '配線したhookはBashツールのコマンド文字列のみを検査します。',
  '拒否対象: (1) git worktree remove の直接実行, (2) 命名規約に違反するブランチ作成。',
  'Agent/Task等の非Bashツール呼び出しは本hookの対象外であり、拒否されません。',
  '緊急時は Claude Code 外の通常シェルから `agent-skill-chain enforce off` を直接実行してください。',
].join('\n');

/**
 * 02_設計§3.4・ADR-2/ADR-4: `.claude/settings.json`のPreToolUse hookエントリを配線/非配線する。
 * matcherは`tool_name=="Bash"`固定（ツール名の一律allow/denyリストにしない狭い安全網）。
 */
export async function enforce(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const mode = args[0];
    if (mode !== 'on' && mode !== 'off') {
      printUsage(USAGE);
      return fail("enforce の第一引数は 'on' または 'off' である必要があります");
    }
    const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
    const settingsPath = path.join(targetDir, '.claude', 'settings.json');

    let settings;
    try {
      settings = readSettings(settingsPath);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }

    if (mode === 'on') {
      const hookSource = resolveAsset(path.join('hooks', 'claude-pretooluse.sh'), targetDir);
      const hookDest = path.join(targetDir, HOOK_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(hookDest), { recursive: true });
      fs.copyFileSync(hookSource, hookDest);
      fs.chmodSync(hookDest, 0o755);

      const next = addPreToolUseHook(settings, HOOK_RELATIVE_PATH);
      writeSettings(settingsPath, next);
      return ok(`配線しました: ${HOOK_RELATIVE_PATH}\n\n${ON_WARNING}`);
    }

    const next = removePreToolUseHook(settings, HOOK_RELATIVE_PATH);
    writeSettings(settingsPath, next);
    return ok(`解除しました: ${HOOK_RELATIVE_PATH}`);
  });
}
