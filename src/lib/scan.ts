import fs from 'node:fs';
import path from 'node:path';
import { ASSET_NAMESPACE } from './paths.js';

const TEXT_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.sh', '.json', '.ts']);

/** 検査対象は「生きたファイル」（AGENTS.md・.agent-skill-chain/{standards,templates,config,
 * schemas,scripts,ci}/・src/ 等）であり、memo/等の非追跡scratchは対象外。lint references の
 * デフォルト対象として使う（禁止参照が指す見出しは templates/adr/ADR.md 等、除外中の
 * ディレクトリ内にも存在するため、見出し解決には完全な一覧が必要）。
 *
 * `src/`（TypeScript 実装本体）は Issue #187 で対象へ追加した。`bin/` は `.gitignore` 対象の
 * ビルド生成物（追跡対象外）であり、実体は `src/` に完全に存在するため意図的に対象外のまま
 * とする。 */
export function defaultLiveFileRoots(repoRoot: string): string[] {
  const roots = [path.join(repoRoot, 'AGENTS.md'), path.join(repoRoot, 'docs', 'GLOSSARY.md')];
  for (const dir of ['standards', 'templates', 'config', 'schemas', 'scripts', 'ci']) {
    roots.push(path.join(repoRoot, ASSET_NAMESPACE, dir));
  }
  roots.push(path.join(repoRoot, 'src'));
  return roots.filter((p) => fs.existsSync(p));
}

/** lint vocab のデフォルト対象。defaultLiveFileRoots から docs/GLOSSARY.md（恒久的な除外）のみを
 * 除外する。GLOSSARY.md自体が「禁止同義語」列で禁止語を文字通り列挙する用語定義文書であり、
 * 構造上必然的に自分自身の禁止語検査に引っかかる（スペルチェッカーが自分の「既知の誤字一覧」
 * ファイルを誤字として検出するのと同種の自己言及）。lint references の禁止参照解決には引き続き
 * GLOSSARY.mdの見出しが必要なため、defaultLiveFileRootsからは除外しない。
 *
 * templates/config/schemas/scripts は識別子・YAMLキー・CLIサブコマンド文脈を認識するスキャナ
 * （src/commands/lint.ts の isIdentifierContext）を実装したことにより対象復帰済み
 * （defaultLiveFileRootsと同一集合）。 */
export function defaultVocabFileRoots(repoRoot: string): string[] {
  const excluded = new Set([path.join(repoRoot, 'docs', 'GLOSSARY.md')]);
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
