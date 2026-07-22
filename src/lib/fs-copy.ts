import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './issue.js';

export interface CopyResult {
  path: string;
  action: 'created' | 'unchanged' | 'overwritten';
  /** true の場合、実際にはファイルシステムへ書き込まれていない（`dryRun: true` で算出した予定）。 */
  planned?: boolean;
}

export interface CopyOptions {
  /** true の場合、衝突検知・戻り値算出は通常どおり行うが、ファイルシステムへは一切書き込まない。 */
  dryRun?: boolean;
}

/**
 * 既存ファイルと内容が同一なら idempotent に skip、異なれば CliError で即座に停止する
 * （非破壊: 既存の異なる内容を暗黙に上書き・放置しない。setup 系コマンドの既定動作）。
 *
 * `dryRun: true` は「書込みをしない」だけで「検査をしない」わけではない（Issue #169:
 * 衝突検知は dry-run でも従来どおり行われる）。
 */
export function copyTreeFailOnConflict(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  const { dryRun = false } = options;
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      if (!dryRun) fs.mkdirSync(d, { recursive: true });
      for (const child of fs.readdirSync(s)) {
        walk(path.join(s, child), path.join(d, child));
      }
      return;
    }
    if (fs.existsSync(d)) {
      const same = fs.readFileSync(s).equals(fs.readFileSync(d));
      if (!same) {
        throw new CliError(
          `導入先に既存の異なる内容のファイルがあるため展開を中断しました: ${d}` +
            `（内容が競合しています。手動で確認・解消してから再実行してください）`,
        );
      }
      results.push({ path: d, action: 'unchanged', planned: dryRun });
      return;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
    results.push({ path: d, action: 'created', planned: dryRun });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}

/**
 * `.github/` は配布元 `.agent-skill-chain/templates/github/.github/` の展開結果そのもの
 * （AGENTS.md が定めるGitHub配布・マルチAI対応の方針）であり、常に完全一致させるミラーコピー。
 */
export function copyTreeMirror(src: string, dest: string, options: CopyOptions = {}): CopyResult[] {
  const { dryRun = false } = options;
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      if (!dryRun) fs.mkdirSync(d, { recursive: true });
      for (const child of fs.readdirSync(s)) {
        walk(path.join(s, child), path.join(d, child));
      }
      return;
    }
    const existed = fs.existsSync(d);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
    results.push({ path: d, action: existed ? 'overwritten' : 'created', planned: dryRun });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}
