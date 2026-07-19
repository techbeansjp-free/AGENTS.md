import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './issue.js';

export interface CopyResult {
  path: string;
  action: 'created' | 'unchanged' | 'overwritten';
}

/**
 * 既存ファイルと内容が同一なら idempotent に skip、異なれば CliError で即座に停止する
 * （非破壊: 既存の異なる内容を暗黙に上書き・放置しない。setup 系コマンドの既定動作）。
 */
export function copyTreeFailOnConflict(src: string, dest: string): CopyResult[] {
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
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
      results.push({ path: d, action: 'unchanged' });
      return;
    }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    results.push({ path: d, action: 'created' });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}

/**
 * `.github/` は配布元 `.agent-skill-chain/templates/github/.github/` の展開結果そのもの
 * （AGENTS.md §GitHub配布・マルチAI対応）であり、常に完全一致させるミラーコピー。
 */
export function copyTreeMirror(src: string, dest: string): CopyResult[] {
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      for (const child of fs.readdirSync(s)) {
        walk(path.join(s, child), path.join(d, child));
      }
      return;
    }
    const existed = fs.existsSync(d);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    results.push({ path: d, action: existed ? 'overwritten' : 'created' });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}
