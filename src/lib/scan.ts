import fs from 'node:fs';
import path from 'node:path';
import { ASSET_NAMESPACE } from './paths.js';

const TEXT_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.sh', '.json', '.ts']);

/** AGENTS.md §参照・コメントの陳腐化防止 / §用語: 検査対象は「生きたファイル」（AGENTS.md・
 * .agent-skill-chain/{standards,templates,config,schemas,scripts,ci}/等）であり、
 * memo/等の非追跡scratchは対象外。lint references のデフォルト対象として使う（§参照が指す
 * 見出しは templates/adr/ADR.md 等、除外中のディレクトリ内にも存在するため、見出し解決には
 * 完全な一覧が必要）。 */
export function defaultLiveFileRoots(repoRoot: string): string[] {
  const roots = [path.join(repoRoot, 'AGENTS.md'), path.join(repoRoot, 'docs', 'GLOSSARY.md')];
  for (const dir of ['standards', 'templates', 'config', 'schemas', 'scripts', 'ci']) {
    roots.push(path.join(repoRoot, ASSET_NAMESPACE, dir));
  }
  return roots.filter((p) => fs.existsSync(p));
}

/** lint vocab のデフォルト対象。defaultLiveFileRoots から templates/config/schemas/scripts を
 * 一時的に除外する。これらの配下では "issue" 等の禁止語が YAML キー名（例: issue.allowed_types,
 * issue_id）・CLI サブコマンド名（例: issue start, issue resume）として識別子的に大量使用されて
 * おり、現行の lint-vocab スキャナは識別子・技術参照と散文中の誤用を区別できず大量誤検出を
 * 起こす。識別子・YAMLキー・CLIサブコマンド名を認識するスキャナ実装後、follow-up issueで
 * この3ディレクトリを対象復帰する。standards・ciはこの問題が無いため対象に残す。 */
export function defaultVocabFileRoots(repoRoot: string): string[] {
  const excluded = new Set(
    ['templates', 'config', 'schemas', 'scripts'].map((dir) => path.join(repoRoot, ASSET_NAMESPACE, dir)),
  );
  return defaultLiveFileRoots(repoRoot).filter((p) => !excluded.has(p));
}

export function walkTextFiles(entryPaths: string[]): string[] {
  const files: string[] = [];
  function walk(p: string): void {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(p)) walk(path.join(p, child));
      return;
    }
    if (TEXT_EXTENSIONS.has(path.extname(p))) files.push(p);
  }
  for (const entry of entryPaths) {
    if (fs.existsSync(entry)) walk(entry);
  }
  return files;
}
