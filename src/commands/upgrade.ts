import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, ASSET_NAMESPACE } from '../lib/paths.js';
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
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    throw new CliError(`managed template directoryを読めません: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new CliError(`managed template directoryがsymlinkまたは通常directoryではありません: ${root}`);
  }
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) files.push(path.relative(root, absolute));
      else throw new CliError(`managed assetがsymlinkまたは通常fileではありません: ${absolute}`);
    }
  };
  walk(root);
  return files.sort();
}

function lstatIfPresent(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertNormalParents(root: string, filePath: string, allowMissing = false): void {
  const relative = path.relative(root, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError(`managed assetが検査境界外です: ${filePath}`);
  }
  const parentRelative = path.dirname(relative);
  const components = parentRelative === '.' ? [] : parentRelative.split(path.sep);
  let current = root;
  for (const component of ['', ...components]) {
    if (component) current = path.join(current, component);
    const stat = lstatIfPresent(current);
    if (!stat && allowMissing) return;
    if (!stat || !stat.isDirectory()) {
      throw new CliError(`managed assetの親がsymlinkまたは通常directoryではありません: ${current}`);
    }
  }
}

function assertNormalDirectoryPath(boundary: string, directory: string): void {
  const relative = path.relative(boundary, directory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError(`managed directoryが検査境界外です: ${directory}`);
  }
  const components = relative === '' ? [] : relative.split(path.sep);
  let current = boundary;
  for (const component of ['', ...components]) {
    if (component) current = path.join(current, component);
    const stat = lstatIfPresent(current);
    if (!stat || !stat.isDirectory()) {
      throw new CliError(`managed directoryがsymlinkまたは通常directoryではありません: ${current}`);
    }
  }
}

function readRegularFileNoFollow(root: string, filePath: string, missingMessage: string): Buffer {
  assertNormalParents(root, filePath);
  const before = lstatIfPresent(filePath);
  if (!before) throw new CliError(`${missingMessage}: ${filePath}`);
  if (!before.isFile()) {
    throw new CliError(`managed assetがsymlink・special file・directoryのため追従せず停止しました: ${filePath}`);
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new CliError(`managed assetが検査後に置換されたため停止しました: ${filePath}`);
    }
    const content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs
    ) {
      throw new CliError(`managed assetが読取り中に変更されたため停止しました: ${filePath}`);
    }
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** 全managed GitHub assetをold template・deployed・new templateの三者でcopy前に検査する。 */
function preflightManagedGithubAssets(targetDir: string): void {
  const oldRoot = path.join(targetDir, ASSET_NAMESPACE, 'templates', 'github', '.github');
  const deployedRoot = path.join(targetDir, '.github');
  const newRoot = path.join(packageRoot(), ASSET_NAMESPACE, 'templates', 'github', '.github');
  assertNormalDirectoryPath(targetDir, oldRoot);
  assertNormalDirectoryPath(targetDir, deployedRoot);
  assertNormalDirectoryPath(packageRoot(), newRoot);
  const oldFiles = new Set(relativeFiles(oldRoot));
  const newFiles = new Set(relativeFiles(newRoot));

  for (const relative of [...new Set([...oldFiles, ...newFiles])].sort()) {
    const oldPath = path.join(oldRoot, relative);
    const deployedPath = path.join(deployedRoot, relative);
    const newPath = path.join(newRoot, relative);
    if (oldFiles.has(relative)) {
      const oldContent = readRegularFileNoFollow(oldRoot, oldPath, 'old managed templateが欠落しています');
      const deployedContent = readRegularFileNoFollow(
        deployedRoot,
        deployedPath,
        'managed assetの展開物が欠落しupgradeを判定できません',
      );
      if (!oldContent.equals(deployedContent)) {
        throw new CliError(`managed assetにlocal customization競合があるためupgradeを無変更で停止しました: ${deployedPath}`);
      }
      if (!newFiles.has(relative)) {
        throw new CliError(`package new templateからmanaged assetが欠落しupgradeを判定できません: ${newPath}`);
      }
      readRegularFileNoFollow(newRoot, newPath, 'package new templateからmanaged assetが欠落しています');
    } else {
      readRegularFileNoFollow(newRoot, newPath, 'package new templateからmanaged assetが欠落しています');
      assertNormalParents(deployedRoot, deployedPath, true);
      if (lstatIfPresent(deployedPath)) {
        throw new CliError(
          `new managed filenameが既存custom assetと衝突するためupgradeを無変更で停止しました: ${deployedPath}`,
        );
      }
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

    const githubSrc = path.join(packageRoot(), ASSET_NAMESPACE, 'templates', 'github', '.github');
    const operations: Array<{ source: string; destination: string }> = [
      { source: githubSrc, destination: path.join(targetDir, '.github') },
    ];
    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!lstatIfPresent(src)) continue;
      operations.push({ source: src, destination: path.join(targetDir, entry) });
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!lstatIfPresent(src)) continue;
      operations.push({ source: src, destination: path.join(targetDir, ASSET_NAMESPACE, entry) });
    }

    // root/namespaced/.githubの全コピー先を先に検査し、後段の危険なentryで部分更新を生じさせない。
    const planned = operations.map((operation) =>
      copyTreeMirror(operation.source, operation.destination, {
        dryRun: true,
        destinationBoundary: targetDir,
        sourceBoundary: packageRoot(),
      }),
    );

    const prefix = dryRun ? 'planned ' : '';
    const summary: string[] = [`${oldVersion} -> ${newVersion}`];
    if (!dryRun) {
      // old/deployed比較からcopyまでの窓を狭め、identity/contentをcopy直前にも再検証する。
      preflightManagedGithubAssets(targetDir);
    }
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      const results = dryRun
        ? planned[index]!
        : copyTreeMirror(operation.source, operation.destination, {
            destinationBoundary: targetDir,
            sourceBoundary: packageRoot(),
          });
      summary.push(...results.map((result) => `${prefix}${result.action}: ${result.path}`));
    }

    if (!dryRun) {
      writeInstalledVersion(targetDir, newVersion);
    }

    return ok(summary.join('\n'));
  });
}
