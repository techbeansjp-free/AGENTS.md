import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, ASSET_NAMESPACE } from '../lib/paths.js';
import { copyTreeFailOnConflict } from '../lib/fs-copy.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES, packageVersion } from '../lib/asset-manifest.js';
import { writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain init [target_dir] [--dry-run]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実ファイルを書き込まず、作成予定のファイル一覧のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。作成したファイル一覧（またはdry-run時は作成予定一覧）を標準出力へ。
  失敗時（既存ファイルと内容衝突）: 終了コード1以上。衝突ファイルパスと理由を標準エラー出力へ。
`;

/**
 * setup（bare）が持つローカルファイル操作部分（gh API呼び出しを伴わない部分）を吸収した新設
 * コマンド。GitHub API（labels/ruleset）には触れない（ADR-1）。
 */
export async function init(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();
    if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

    const conflictCheckedEntries: Array<{ src: string; dest: string }> = [];
    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!fs.existsSync(src)) continue;
      conflictCheckedEntries.push({ src, dest: path.join(targetDir, entry) });
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!fs.existsSync(src)) continue;
      conflictCheckedEntries.push({ src, dest: path.join(targetDir, ASSET_NAMESPACE, entry) });
    }

    // 衝突検出時は他ファイルへの書込みも一切行わない（部分適用しない）。
    // そのため、実書き込みの前に全対象を dryRun:true で先読み検査する
    // （Issue #169 F1: 逐次書込みだと衝突検出前のエントリが既にディスクへ書かれてしまう不備の是正）。
    if (!dryRun) {
      for (const { src, dest } of conflictCheckedEntries) {
        copyTreeFailOnConflict(src, dest, { dryRun: true, root: targetDir });
      }
    }

    const prefix = dryRun ? 'planned ' : '';
    const summary: string[] = [];

    for (const { src, dest } of conflictCheckedEntries) {
      const results = copyTreeFailOnConflict(src, dest, { dryRun, root: targetDir });
      summary.push(...results.map((r) => `${prefix}${r.action}: ${r.path}`));
    }

    if (!dryRun) {
      writeInstalledVersion(targetDir, packageVersion());
    }
    summary.push('GitHub workflowは未展開です。必要な場合だけ setup github を明示実行してください。');
    summary.push(`${prefix}installed_version: ${packageVersion()}`);

    return ok(summary.join('\n'));
  });
}
