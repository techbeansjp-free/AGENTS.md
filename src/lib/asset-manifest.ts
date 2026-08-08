import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, ASSET_NAMESPACE } from './paths.js';
import { resolveTemplateMappings } from './template-sync.js';
import type { AgentSkillChainConfig } from './config.js';

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

/** `.agent-skill-chain/config/agent-skill-chain.yaml` の配布元候補（軽量プロファイル用の別テンプレート）。 */
const LIGHTWEIGHT_CONFIG_SOURCE = path.join('.agent-skill-chain', 'templates', 'lightweight', 'agent-skill-chain.yaml');
/** `CLAUDE.md` の配布元候補（軽量プロファイル用の別テンプレート）。 */
const LIGHTWEIGHT_CLAUDE_MD_SOURCE = path.join('.agent-skill-chain', 'templates', 'lightweight', 'CLAUDE.md');

/**
 * `ROOT_LEVEL_ENTRIES`・`NAMESPACED_ENTRIES`・`claude_agents`/`claude_skills` テンプレートマッピングの
 * 統合した、正本アセットの配布元→展開先マッピング一覧を返す。`init`が所有権記録へ書き込むキー集合
 * と`upgrade`が削除候補判定の基準（現行配布ファイル）として認識するキー集合は、この単一の走査
 * ロジックから導出されることで一致が構造的に保証される（Issue #492 手動implementation-gateレビュー
 * 指摘: stale-delete-scope-invariant-untested。2つの独立ループが将来乖離すると、乖離分の現行配布
 * ファイルが誤って削除候補と分類されうる）。
 *
 * `profile`（ADR-0023、Issue #503）: `lightweight` の場合、`CLAUDE.md`・`config`（`agent-skill-chain.yaml`
 * のみ）の配布元を軽量プロファイル専用テンプレートへ切り替える。省略時は `standard`（現行動作）。
 *
 * `overrideConfig`（Issue #503 手動implementation-gateレビュー指摘の派生修正）: 対象ディレクトリの
 * configファイルが破損・不正値を含み、かつ書き換えられない（`upgrade --dry-run`）場合に、
 * 呼び出し側が算出済みの「修復後相当」のconfig内容をそのまま `claude_agents`/`claude_skills`
 * テンプレート解決へ渡すための経路。省略時は対象ディレクトリの実ファイルを読む（従来動作）。
 */
export function collectManagedAssetMappings(
  targetDir: string,
  profile: 'standard' | 'lightweight' = 'standard',
  overrideConfig?: AgentSkillChainConfig,
): ManagedAssetMapping[] {
  const mappings: ManagedAssetMapping[] = [];
  for (const entry of ROOT_LEVEL_ENTRIES) {
    const isClaudeMd = entry === 'CLAUDE.md';
    const src =
      isClaudeMd && profile === 'lightweight'
        ? path.join(packageRoot(), LIGHTWEIGHT_CLAUDE_MD_SOURCE)
        : path.join(packageRoot(), entry);
    if (!fs.existsSync(src)) continue;
    mappings.push({ src, dest: path.join(targetDir, entry) });
  }
  for (const entry of NAMESPACED_ENTRIES) {
    const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
    if (!fs.existsSync(src)) continue;
    if (entry === 'config') {
      // `config` はディレクトリ単位コピーをせず、ファイル単位へ分解する。`agent-skill-chain.yaml`
      // のみプロファイル対応の配布元切替を行い、`roles.yaml`・`segments.yaml` 等は従来どおり
      // ディレクトリ内の個々のファイルとして配布元から複製する。
      const configDir = src;
      const configFileNames = fs
        .readdirSync(configDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
      for (const fileName of configFileNames) {
        const configFileSrc =
          fileName === 'agent-skill-chain.yaml' && profile === 'lightweight'
            ? path.join(packageRoot(), LIGHTWEIGHT_CONFIG_SOURCE)
            : path.join(configDir, fileName);
        if (!fs.existsSync(configFileSrc)) continue;
        mappings.push({ src: configFileSrc, dest: path.join(targetDir, ASSET_NAMESPACE, entry, fileName) });
      }
      continue;
    }
    mappings.push({ src, dest: path.join(targetDir, ASSET_NAMESPACE, entry) });
  }
  const templateMappings = resolveTemplateMappings(targetDir, overrideConfig);
  for (const id of ['claude_agents', 'claude_skills'] as const) {
    const mapping = templateMappings.find((m) => m.id === id);
    if (mapping) mappings.push({ src: mapping.source, dest: mapping.dest });
  }
  return mappings;
}
