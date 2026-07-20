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

/** lint vocab のデフォルト対象。defaultLiveFileRoots から次の2種類を除外する。
 *
 * 1. templates/config/schemas/scripts（一時的な除外）: これらの配下では "issue" 等の禁止語が
 *    YAML キー名（例: issue.allowed_types, issue_id）・CLI サブコマンド名（例: issue start,
 *    issue resume）として識別子的に大量使用されており、現行の lint-vocab スキャナは識別子・
 *    技術参照と散文中の誤用を区別できず大量誤検出を起こす。識別子・YAMLキー・CLIサブコマンド名を
 *    認識するスキャナ実装後、follow-up issueでこの4ディレクトリを対象復帰する。standards・ciは
 *    この問題が無いため対象に残す。
 * 2. docs/GLOSSARY.md（恒久的な除外）: GLOSSARY.md自体が「禁止同義語」列で禁止語を文字通り
 *    列挙する用語定義文書であり、構造上必然的に自分自身の禁止語検査に引っかかる（スペル
 *    チェッカーが自分の「既知の誤字一覧」ファイルを誤字として検出するのと同種の自己言及）。
 *    lint referencesの§参照解決には引き続きGLOSSARY.mdの見出しが必要なため、
 *    defaultLiveFileRootsからは除外しない。 */
export function defaultVocabFileRoots(repoRoot: string): string[] {
  const excluded = new Set(
    ['templates', 'config', 'schemas', 'scripts']
      .map((dir) => path.join(repoRoot, ASSET_NAMESPACE, dir))
      .concat(path.join(repoRoot, 'docs', 'GLOSSARY.md')),
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
