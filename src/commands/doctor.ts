import path from 'node:path';
import { commandExists, run as exec } from '../lib/exec.js';
import { loadConfig } from '../lib/config.js';
import { repoRoot } from '../lib/paths.js';
import { readInstalledVersion } from '../lib/version-marker.js';
import { readSettings, isPreToolUseHookWired } from '../lib/claude-settings.js';
import { HOOK_RELATIVE_PATH } from './enforce.js';
import { isHelp, printUsage, guard } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain doctor

引数なし。

出力:
  成功時: 終了コード0。検査項目ごとのOK/NGを標準出力へ。
  失敗時（必須依存が欠落）: 終了コード1以上。不足している依存を標準エラー出力へ。
`;

interface Check {
  label: string;
  ok: boolean;
  reason?: string;
}

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }

    const checks: Check[] = [];
    checks.push({ label: 'git', ok: commandExists('git') });

    let root: string | undefined;
    try {
      root = repoRoot();
      checks.push({ label: 'git repository', ok: true });
    } catch (error) {
      checks.push({ label: 'git repository', ok: false, reason: (error as Error).message });
    }

    if (root) {
      try {
        const config = loadConfig(root);
        checks.push({ label: '.agent-skill-chain/config/agent-skill-chain.yaml', ok: true });

        if (config.coordination.backend === 'github') {
          const ghOk = commandExists('gh');
          checks.push({ label: 'gh CLI', ok: ghOk, reason: ghOk ? undefined : 'gh コマンドが見つかりません' });
          if (ghOk) {
            const auth = exec('gh', ['auth', 'status']);
            checks.push({
              label: 'gh auth status',
              ok: auth.status === 0,
              reason: auth.status === 0 ? undefined : auth.stderr.trim() || 'gh 未認証',
            });
          }
        }
      } catch (error) {
        checks.push({ label: '.agent-skill-chain/config/agent-skill-chain.yaml', ok: false, reason: (error as Error).message });
      }
    }

    for (const check of checks) {
      const line = check.ok ? `OK  ${check.label}` : `NG  ${check.label}: ${check.reason ?? '不明な理由'}`;
      process.stdout.write(`${line}\n`);
    }

    // Issue #169 T8: init導入済み・enforce配線状態は情報表示のみ（失敗要因にしない）。
    // 未導入・非配線はいずれも安全な既定状態であり、doctorの成否判定には影響させない。
    if (root) {
      const installedVersion = readInstalledVersion(root);
      process.stdout.write(
        `情報  init 導入済み: ${installedVersion ? `OK (${installedVersion})` : 'NG（未導入）'}\n`,
      );

      let enforceOn = false;
      try {
        const settingsPath = path.join(root, '.claude', 'settings.json');
        const settings = readSettings(settingsPath);
        enforceOn = isPreToolUseHookWired(settings, HOOK_RELATIVE_PATH);
      } catch {
        enforceOn = false;
      }
      process.stdout.write(`情報  enforce の配線状態: ${enforceOn ? 'ON' : 'OFF'}\n`);
    }

    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      process.stderr.write(`不足している依存/条件: ${failed.map((c) => c.label).join(', ')}\n`);
      return 1;
    }
    return 0;
  });
}
