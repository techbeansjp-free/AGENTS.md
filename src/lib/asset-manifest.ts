import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, ASSET_NAMESPACE } from './paths.js';
import { resolveTemplateMappings } from './template-sync.js';

/**
 * root直下に残す物のみ（AGENTS.md のディレクトリ構成定義）。他は .agent-skill-chain/ 配下へ。
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

export interface ManagedAssetMapping {
  src: string;
  dest: string;
}

/**
 * `ROOT_LEVEL_ENTRIES`・`NAMESPACED_ENTRIES`・`claude_agents` テンプレートマッピングの3ソースを
 * 統合した、正本アセットの配布元→展開先マッピング一覧を返す。`init`が所有権記録へ書き込むキー集合
 * と`upgrade`が削除候補判定の基準（現行配布ファイル）として認識するキー集合は、この単一の走査
 * ロジックから導出されることで一致が構造的に保証される（Issue #492 手動implementation-gateレビュー
 * 指摘: stale-delete-scope-invariant-untested。2つの独立ループが将来乖離すると、乖離分の現行配布
 * ファイルが誤って削除候補と分類されうる）。
 */
export function collectManagedAssetMappings(targetDir: string): ManagedAssetMapping[] {
  const mappings: ManagedAssetMapping[] = [];
  for (const entry of ROOT_LEVEL_ENTRIES) {
    const src = path.join(packageRoot(), entry);
    if (!fs.existsSync(src)) continue;
    mappings.push({ src, dest: path.join(targetDir, entry) });
  }
  for (const entry of NAMESPACED_ENTRIES) {
    const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
    if (!fs.existsSync(src)) continue;
    mappings.push({ src, dest: path.join(targetDir, ASSET_NAMESPACE, entry) });
  }
  const claudeAgents = resolveTemplateMappings(targetDir).find((mapping) => mapping.id === 'claude_agents');
  if (claudeAgents) mappings.push({ src: claudeAgents.source, dest: claudeAgents.dest });
  return mappings;
}
