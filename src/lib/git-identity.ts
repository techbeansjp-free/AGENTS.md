import { git } from './exec.js';

/**
 * mainへ直接反映する機械生成commit（release bump・root-cleanup等）の著者名義として使う
 * fallback identity。人間の開発者identityを上書きしない（`ensureGitIdentity` 参照）。
 */
export const FALLBACK_GIT_AUTHOR_NAME = 'github-actions[bot]';
export const FALLBACK_GIT_AUTHOR_EMAIL = 'github-actions[bot]@users.noreply.github.com';

/** `git config <key>` が非空に解決できるか（ローカル→グローバル→システムの既定解決順）を
 * 副作用なしに判定する（Issue #198）。 */
function isIdentityConfigured(root: string, key: 'user.name' | 'user.email'): boolean {
  const result = git(['config', key], root);
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * commit作成前に `user.name`/`user.email` が実効的に解決可能であることを保証する（Issue #198）。
 * 既存identityが解決可能な場合は何もしない（非破壊性）。未解決の場合のみ、対象リポジトリの
 * ローカル設定へ（`--global` を使わず）fallback identityを書き込む。
 *
 * release bump（Issue #196/#198/#204）・root-cleanup run（Issue #208）が共通で用いる
 * git identity保証ロジック。
 */
export function ensureGitIdentity(root: string): string | undefined {
  if (!isIdentityConfigured(root, 'user.name')) {
    const setName = git(['config', 'user.name', FALLBACK_GIT_AUTHOR_NAME], root);
    if (setName.status !== 0) return `git config user.name に失敗しました: ${setName.stderr.trim()}`;
  }
  if (!isIdentityConfigured(root, 'user.email')) {
    const setEmail = git(['config', 'user.email', FALLBACK_GIT_AUTHOR_EMAIL], root);
    if (setEmail.status !== 0) return `git config user.email に失敗しました: ${setEmail.stderr.trim()}`;
  }
  return undefined;
}
