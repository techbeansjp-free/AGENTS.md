import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, resolveAsset, ASSET_NAMESPACE } from '../lib/paths.js';
import { copyTreeMirror } from '../lib/fs-copy.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES, packageVersion } from '../lib/asset-manifest.js';
import { readInstalledVersion, writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { CliError } from '../lib/issue.js';

const USAGE = `
使い方: agent-skill-chain upgrade [target_dir] [--dry-run]

target_dir: 更新先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実ファイルを書き込まず、更新予定のファイル一覧のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。更新前後のバージョン・更新ファイル一覧を標準出力へ。
  失敗時（未導入）: 終了コード1以上。「先にinitを実行してください」を標準エラー出力へ。
`;

function relativeFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new CliError(`managed template directoryを読めません: ${root}`);
  }
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
      else throw new CliError(`managed assetの種別を判定できません: ${absolute}`);
    }
  };
  walk(root);
  return files.sort();
}

/** 全managed GitHub assetをold template・deployed・new templateの三者でcopy前に検査する。 */
function preflightManagedGithubAssets(targetDir: string): void {
  const oldRoot = path.join(targetDir, ASSET_NAMESPACE, 'templates', 'github', '.github');
  const deployedRoot = path.join(targetDir, '.github');
  const newRoot = path.join(packageRoot(), ASSET_NAMESPACE, 'templates', 'github', '.github');
  const oldFiles = new Set(relativeFiles(oldRoot));
  const newFiles = new Set(relativeFiles(newRoot));

  for (const relative of [...new Set([...oldFiles, ...newFiles])].sort()) {
    const oldPath = path.join(oldRoot, relative);
    const deployedPath = path.join(deployedRoot, relative);
    const newPath = path.join(newRoot, relative);
    if (oldFiles.has(relative)) {
      if (!fs.existsSync(deployedPath) || !fs.statSync(deployedPath).isFile()) {
        throw new CliError(`managed assetの展開物が欠落しupgradeを判定できません: ${deployedPath}`);
      }
      if (!fs.readFileSync(oldPath).equals(fs.readFileSync(deployedPath))) {
        throw new CliError(`managed assetにlocal customization競合があるためupgradeを無変更で停止しました: ${deployedPath}`);
      }
      if (!newFiles.has(relative)) {
        throw new CliError(`package new templateからmanaged assetが欠落しupgradeを判定できません: ${newPath}`);
      }
    } else if (fs.existsSync(deployedPath)) {
      throw new CliError(`new managed filenameが既存custom assetと衝突するためupgradeを無変更で停止しました: ${deployedPath}`);
    }
  }
}

/**
 * init済みプロジェクトの正本アセット（.agent-skill-chain/project/を除く）を現行パッケージ
 * バージョンへミラー更新する。NAMESPACED_ENTRIES定数にprojectを含めないことで、
 * project/への不可侵性を構造的に保証する（ADR-1関連）。
 */
export async function upgrade(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();

    const oldVersion = readInstalledVersion(targetDir);
    if (!oldVersion) {
      return fail('未導入のプロジェクトです。先に init を実行してください。');
    }
    const newVersion = packageVersion();

    // Issue #271: 旧workflowのAPI credential/CI内AI依存を安全に除去する。preflightは全copyより前に
    // 行い、競合時に他アセットやinstalled_versionを部分更新しない。
    preflightManagedGithubAssets(targetDir);

    const prefix = dryRun ? 'planned ' : '';
    const summary: string[] = [`${oldVersion} -> ${newVersion}`];

    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeMirror(src, path.join(targetDir, entry), { dryRun });
      summary.push(...results.map((r) => `${prefix}${r.action}: ${r.path}`));
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeMirror(src, path.join(targetDir, ASSET_NAMESPACE, entry), { dryRun });
      summary.push(...results.map((r) => `${prefix}${r.action}: ${r.path}`));
    }

    const githubSrc = resolveAsset(path.join('templates', 'github', '.github'), targetDir);
    const githubResults = copyTreeMirror(githubSrc, path.join(targetDir, '.github'), { dryRun });
    summary.push(...githubResults.map((r) => `${prefix}${r.action}: ${r.path}`));

    if (!dryRun) {
      writeInstalledVersion(targetDir, newVersion);
    }

    return ok(summary.join('\n'));
  });
}
