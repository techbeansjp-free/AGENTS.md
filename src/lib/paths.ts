import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { git } from './exec.js';

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

/**
 * `dir` が linked worktree のルート（`.git` がファイル）であることが判明した場合に、
 * メイン（共通）作業ツリールートを解決する（ADR-0004）。
 *
 * 一次手段は git ネイティブの `git rev-parse --path-format=absolute --git-common-dir`
 * （worktree・porcelain を用いる時点で要求されるgit 2.31+が前提。worktree内・メインの
 * いずれから呼んでも共通 `.git` ディレクトリの絶対パスを返す）。git実行が失敗した場合のみ、
 * `.git` ファイルの `gitdir: <path>` を読み、そのディレクトリ内の `commondir`
 * （worktreeごとに置かれる共通.gitへの相対/絶対パス）を素のfsパースで解決するフォールバックを
 * 用いる。いずれも失敗した場合は silent に誤値を返さず明示エラーで停止する。
 */
function resolveMainWorktreeRoot(worktreeDir: string, startDir: string): string {
  const commonDirResult = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktreeDir);
  if (commonDirResult.status === 0) {
    const commonDir = commonDirResult.stdout.trim();
    if (commonDir) return path.dirname(commonDir);
  }

  try {
    const gitFileContent = fs.readFileSync(path.join(worktreeDir, '.git'), 'utf8');
    const match = /^gitdir:\s*(.+)$/m.exec(gitFileContent);
    if (match) {
      const gitdirPath = path.resolve(worktreeDir, match[1].trim());
      const commondirFile = path.join(gitdirPath, 'commondir');
      if (fs.existsSync(commondirFile)) {
        const commondirContent = fs.readFileSync(commondirFile, 'utf8').trim();
        if (commondirContent) {
          const commonDirAbs = path.resolve(gitdirPath, commondirContent);
          return path.dirname(commonDirAbs);
        }
      }
    }
  } catch {
    // フォールバックのfsパースも失敗した場合は下記で明示エラーにする。
  }

  throw new Error(
    `linked worktree の共通 .git ディレクトリを解決できませんでした（起点: ${startDir}, worktree: ${worktreeDir}）`,
  );
}

/**
 * 起点から上へ辿り `.git` エントリを持つ最初のディレクトリを、共通（メイン）作業ツリールートとして
 * 返す（ADR-0004）。ローカルバックエンドの coordination 状態・アセット解決の基点。
 *
 * `.git` の種別を判定する（fs.existsSync はファイル/ディレクトリを区別しないため用いない）:
 * - ディレクトリ（通常リポジトリのルート）: 従来どおりそのディレクトリを即返す
 *   （regressionゼロ・gitバイナリを呼ばない高速パス）。
 * - ファイル（`git worktree add` で作られた linked worktree の `gitdir:` ポインタ）:
 *   `resolveMainWorktreeRoot` でメイン作業ツリールートへ解決する。worktree内から呼んでも
 *   メインから呼んでも同一リポジトリに対して同一の基準ディレクトリを返すようにするため
 *   （coordination状態がworktree内へ分裂して書かれる問題の解消）。
 *
 * 「現在いる作業ツリー」自体のルートが必要な場合（commit/push等のmutatingなgit操作の cwd）は
 * 本関数ではなく `worktreeRoot()` を使うこと。
 */
export function repoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const gitPath = path.join(dir, '.git');
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(gitPath);
    } catch {
      stat = undefined;
    }
    if (stat) {
      if (stat.isDirectory()) return dir;
      return resolveMainWorktreeRoot(dir, startDir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`.git が見つかりません（起点: ${startDir}）`);
    }
    dir = parent;
  }
}

/**
 * 現在いる作業ツリー（linked worktreeならその worktree 自身、通常リポジトリならそのルート）の
 * ルートを返す（ADR-0004）。`git rev-parse --show-toplevel` を用いる（修正前の `repoRoot()` の
 * 返り値と等価）。commit/push等、作業コピーへのmutatingなgit操作のcwdとして使うこと
 * （coordination状態・リポジトリ同一性の基点には `repoRoot()` を使うこと）。
 */
export function worktreeRoot(startDir: string = process.cwd()): string {
  const result = git(['rev-parse', '--show-toplevel'], startDir);
  if (result.status !== 0) {
    throw new Error(
      `git rev-parse --show-toplevel に失敗しました（起点: ${startDir}）: ${result.stderr.trim()}`,
    );
  }
  const top = result.stdout.trim();
  if (!top) {
    throw new Error(`git rev-parse --show-toplevel が空を返しました（起点: ${startDir}）`);
  }
  return path.resolve(top);
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
