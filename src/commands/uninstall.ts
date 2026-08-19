import path from 'node:path';
import fs from 'node:fs';
import { ASSET_NAMESPACE } from '../lib/paths.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES } from '../lib/asset-manifest.js';
import { versionMarkerRelativePath } from '../lib/version-marker.js';
import { trustedCliMarkerRelativePath } from '../lib/trusted-cli-marker.js';
import { git } from '../lib/exec.js';
import { listWorktrees } from '../lib/worktree.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain uninstall [target_dir] [--dry-run]

target_dir: 撤去対象リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実削除を行わず、削除予定のファイル一覧と安全確認結果のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。削除したファイル一覧を標準出力へ。
  失敗時（安全確認NG）: 終了コード1以上。未commit差分・残存worktree等の理由を標準エラー出力へ。

意図的に --force は提供しない（安全確認の迂回経路を持たない）。
`;

const PROJECT_KEEP_NOTICE = '.agent-skill-chain/project/ は保持されます（削除対象に含まれません）';

/**
 * ROOT_LEVEL_ENTRIES + NAMESPACED_ENTRIES(project除く、元々含まれない) + .github
 * + `.installed_version`（Issue #169 F2: これが撤去対象に含まれないと、完全撤去後も
 * doctorが「init 導入済み」と誤表示し続けるため削除対象に含める）のうち、実在するもの。
 */
function managedRelativePaths(targetDir: string): string[] {
  const candidates = [
    ...ROOT_LEVEL_ENTRIES,
    ...NAMESPACED_ENTRIES.map((entry) => path.join(ASSET_NAMESPACE, entry)),
    '.github',
    versionMarkerRelativePath(),
    // Issue #759: `.installed_version` と同じ実行時状態であり、撤去後に残すと参照者不在の
    // 期待値だけがリポジトリへ残る。
    trustedCliMarkerRelativePath(),
  ];
  return candidates.filter((relative) => fs.existsSync(path.join(targetDir, relative)));
}

/**
 * 安全確認（未commit差分なし・残存worktreeなし）を経てから、init/upgradeが管理する一式
 * （project/を除く）を削除する。--force は提供しない（意図的な摩擦、ADR系設計方針）。
 */
export async function uninstall(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();

    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      return fail(`gitリポジトリではありません: ${targetDir}`);
    }

    const managed = managedRelativePaths(targetDir);
    if (managed.length === 0) {
      return fail('導入済みの資産が見つかりません（init未実行、または既に削除済みの可能性）。');
    }

    const status = git(['status', '--porcelain', '--', ...managed], targetDir);
    if (status.status !== 0) {
      return fail(`git status の実行に失敗しました: ${status.stderr.trim()}`);
    }
    if (status.stdout.trim().length > 0) {
      return fail(
        `未commitの変更が .agent-skill-chain/ 配下等に存在するため削除できません:\n${status.stdout.trim()}`,
      );
    }

    let worktrees;
    try {
      worktrees = listWorktrees(targetDir);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    const worktreesRoot = path.join(targetDir, '.worktrees') + path.sep;
    const remaining = worktrees.filter((w) => path.resolve(w.path).startsWith(worktreesRoot));
    if (remaining.length > 0) {
      return fail(
        `cleanup.sh未実行の残存worktreeが存在するため削除できません:\n${remaining.map((w) => w.path).join('\n')}`,
      );
    }

    const prefix = dryRun ? 'planned removed: ' : 'removed: ';
    const summary = managed.map((relative) => `${prefix}${path.join(targetDir, relative)}`);
    summary.push(dryRun ? `(dry-run) ${PROJECT_KEEP_NOTICE}` : PROJECT_KEEP_NOTICE);

    if (dryRun) {
      return ok(summary.join('\n'));
    }

    for (const relative of managed) {
      fs.rmSync(path.join(targetDir, relative), { recursive: true, force: true });
    }

    return ok(summary.join('\n'));
  });
}
