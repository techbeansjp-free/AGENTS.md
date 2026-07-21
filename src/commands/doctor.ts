import fs from 'node:fs';
import path from 'node:path';
import { commandExists, run as exec } from '../lib/exec.js';
import { loadConfig } from '../lib/config.js';
import { repoRoot, resolveAsset } from '../lib/paths.js';
import { readInstalledVersion } from '../lib/version-marker.js';
import { readSettings, isPreToolUseHookWired } from '../lib/claude-settings.js';
import { HOOK_RELATIVE_PATH } from './enforce.js';
import { isHelp, printUsage, guard } from '../lib/cli-io.js';
import { listWorktrees, worktreePathRegex, hasUncommittedChanges } from '../lib/worktree.js';
import { computeTemplateSyncDiffs } from '../lib/template-sync.js';
import { readYamlFile } from '../lib/yaml-io.js';

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

        // Issue #174 AC-1: worktree一覧が worktree.path_pattern に適合するかを検査する。
        // `git worktree list --porcelain` の先頭は常に主worktree自身であり、Issue用worktreeの
        // 命名規則には決して適合しないため対象から外す（doctorがどのworktreeから実行されても
        // 正しく主worktreeを判定できるよう、cwd由来のrootとのパス比較ではなく先頭要素を除外する）。
        try {
          const regex = worktreePathRegex(config);
          const targets = listWorktrees(root)
            .slice(1)
            .map((w) => w.path);
          const bad = targets.filter((p) => !regex.test(path.basename(p)));
          checks.push({
            label: 'worktree命名規約',
            ok: bad.length === 0,
            reason: bad.length === 0 ? undefined : `${bad.join(', ')} は worktree.path_pattern に適合しません`,
          });
        } catch (error) {
          checks.push({ label: 'worktree命名規約', ok: false, reason: (error as Error).message });
        }

        // Issue #174 AC-3: .github/ が templates/github/.github/（配布元の正本）と同期しているかを検査する。
        try {
          const diffs = computeTemplateSyncDiffs(root);
          checks.push({
            label: 'template-sync',
            ok: diffs.length === 0,
            reason: diffs.length === 0 ? undefined : diffs.join('; '),
          });
        } catch (error) {
          checks.push({ label: 'template-sync', ok: false, reason: (error as Error).message });
        }

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

      // Issue #174 AC-2: main worktree（repoRootが指すworktree）に未commit差分が無いかを検査する。
      // config読込の成否に依存しないため、上記try/catchの外側で独立して実行する。
      try {
        const entries = listWorktrees(root);
        const mainPath = entries[0]?.path;
        if (!mainPath) throw new Error('git worktree list --porcelain の結果が空です');
        const clean = !hasUncommittedChanges(mainPath);
        checks.push({
          label: 'main worktreeのclean状態',
          ok: clean,
          reason: clean ? undefined : `未commitの変更があります: ${mainPath}`,
        });
      } catch (error) {
        checks.push({ label: 'main worktreeのclean状態', ok: false, reason: (error as Error).message });
      }

      // Issue #174 AC-4: .agent-skill-chain/schemas/*.yaml がYAML構文として妥当かを検査する
      // （JSON Schemaとしての意味的妥当性ではなく、YAML構文としてのparse可否のみを見る）。
      // config読込に依存しないため、config読込失敗時も独立して実行する。
      try {
        const schemasDir = resolveAsset('schemas', root);
        const files = fs.readdirSync(schemasDir).filter((f) => f.endsWith('.yaml'));
        const errors: string[] = [];
        for (const file of files) {
          try {
            readYamlFile(path.join(schemasDir, file));
          } catch (error) {
            errors.push(`${file}: ${(error as Error).message}`);
          }
        }
        checks.push({
          label: 'schemas構文妥当性',
          ok: errors.length === 0,
          reason: errors.length === 0 ? undefined : errors.join('; '),
        });
      } catch (error) {
        checks.push({ label: 'schemas構文妥当性', ok: false, reason: (error as Error).message });
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
