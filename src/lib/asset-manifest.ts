import path from 'node:path';
import fs from 'node:fs';
import { packageRoot } from './paths.js';

/**
 * root直下に残す物のみ（AGENTS.md §ディレクトリ構成）。他は .agent-skill-chain/ 配下へ。
 * `init`/`upgrade`/`uninstall`/`setup` が共有する定数（Issue #169: 重複定義の解消）。
 */
export const ROOT_LEVEL_ENTRIES = ['AGENTS.md', 'CLAUDE.md', path.join('docs', 'GLOSSARY.md')];

/**
 * `.agent-skill-chain/` 配下の名前空間一覧。`project/` は意図的に含めない
 * （consumer project 固有ポリシーであり、`upgrade`/`uninstall` の対象から常に除外するため）。
 */
export const NAMESPACED_ENTRIES = ['standards', 'templates', 'schemas', 'config', 'adapters', 'scripts', 'ci', 'hooks'];

/** 本パッケージ自身の package.json version（`.installed_version` へ記録する値）。 */
export function packageVersion(): string {
  const pkgPath = path.join(packageRoot(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}
