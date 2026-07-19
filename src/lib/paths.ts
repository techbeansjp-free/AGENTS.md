import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * このパッケージ自身のルート（node_modules/agent-skill-chain/ またはこのリポジトリ直下）。
 * ビルド後は bin/agents-md.js から見て一つ上の階層（tsconfig: rootDir=src, outDir=bin、
 * いずれもパッケージルート直下）。
 */
export function packageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // src/lib/paths.ts（開発時, tsx等）または bin/lib/paths.js（ビルド後）のいずれからも
  // 2階層上がパッケージルートになるよう構成を揃えている。
  return path.resolve(moduleDir, '..', '..');
}

/** cwd から上へ辿り .git を含む最初のディレクトリ（対象リポジトリのルート）を返す。 */
export function repoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`.git が見つかりません（起点: ${startDir}）`);
    }
    dir = parent;
  }
}

/** AGENTS.md §ディレクトリ構成: standards/・templates/・schemas/・config/・adapters/・scripts/・ci/ は
 * 対象リポジトリ直下ではなく `.agent-skill-chain/` 配下に配置する（root直下は AGENTS.md・CLAUDE.md・
 * README.md・docs/・.github/・.worktrees/ のみ）。docs/ は対象外（root直下のまま）。 */
export const ASSET_NAMESPACE = '.agent-skill-chain';

/**
 * standards/・templates/・schemas/・config/・adapters/・scripts/・ci/ 配下アセットの解決順序:
 * 対象リポジトリ側の `.agent-skill-chain/`（setup展開後のコピー）を優先し、
 * 無ければパッケージ同梱版の `.agent-skill-chain/` へフォールバックする。
 */
export function resolveAsset(relativePath: string, root: string = repoRoot()): string {
  const inRepo = path.join(root, ASSET_NAMESPACE, relativePath);
  if (fs.existsSync(inRepo)) return inRepo;
  const inPackage = path.join(packageRoot(), ASSET_NAMESPACE, relativePath);
  if (fs.existsSync(inPackage)) return inPackage;
  throw new Error(`アセットが見つかりません: ${relativePath}（${inRepo} / ${inPackage} 共に無し）`);
}
