import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { loadConfig, type AgentSkillChainConfig } from './config.js';
import { packageRoot } from './paths.js';

export interface TemplateMapping {
  id: 'github' | 'claude_agents' | 'claude_skills';
  source: string;
  dest: string;
}

function resolveConfiguredSource(targetRoot: string, configuredPath: string): string {
  const inTarget = path.resolve(targetRoot, configuredPath);
  if (fs.existsSync(inTarget)) return inTarget;
  const inPackage = path.resolve(packageRoot(), configuredPath);
  if (fs.existsSync(inPackage)) return inPackage;
  throw new Error(`template配布元が見つかりません: ${configuredPath}`);
}

/**
 * configの配布元・展開先を、未導入先ではパッケージ同梱既定へフォールバックして解決する。
 * `overrideConfig` を渡した場合は対象ディレクトリのconfigファイルを読み取らずそれを使う
 * （`upgrade --dry-run` が破損configを書き換えずに解決するための経路。`loadConfig` 参照）。
 */
export function resolveTemplateMappings(targetRoot: string, overrideConfig?: AgentSkillChainConfig): TemplateMapping[] {
  const config = loadConfig(targetRoot, overrideConfig);
  const claudeAgentsSource = config.templates.claude_agents_source ?? '.agent-skill-chain/templates/claude/agents';
  const claudeAgentsTarget = config.templates.claude_agents_target ?? '.claude/agents';
  // ADR-0023（Issue #503）: claude_agentsと同形式の任意設定・既定パスフォールバック。
  // プロファイルを問わず常に配置する（要件3）。
  const claudeSkillsSource = config.templates.claude_skills_source ?? '.agent-skill-chain/templates/claude/skills';
  const claudeSkillsTarget = config.templates.claude_skills_target ?? '.claude/skills';
  return [
    {
      id: 'github',
      source: resolveConfiguredSource(targetRoot, config.templates.github_source),
      dest: path.resolve(targetRoot, config.templates.github_target),
    },
    {
      id: 'claude_agents',
      source: resolveConfiguredSource(targetRoot, claudeAgentsSource),
      dest: path.resolve(targetRoot, claudeAgentsTarget),
    },
    {
      id: 'claude_skills',
      source: resolveConfiguredSource(targetRoot, claudeSkillsSource),
      dest: path.resolve(targetRoot, claudeSkillsTarget),
    },
  ];
}

/**
 * `mapping.source` に対する seed-only マニフェスト（`<source>.seed-only.yaml`、配布元ディレクトリの
 * 兄弟ファイルなので配布元ツリーの一部として展開先へコピーされない）を読み、初回配置後の内容乖離を
 * 許容するファイルの相対パス集合を返す。マニフェストが無ければ空集合（従来どおり完全一致必須）。
 * ISSUE-574: CODEOWNERS等、プロジェクトごとに正当にカスタマイズされうるファイルを、
 * ワークフロー本体等の完全一致必須ファイルと区別するための仕組み。
 */
function loadSeedOnlyPaths(source: string): Set<string> {
  const manifestPath = `${source}.seed-only.yaml`;
  if (!fs.existsSync(manifestPath)) return new Set();
  const parsed = parse(fs.readFileSync(manifestPath, 'utf8')) as { paths?: unknown } | null;
  const rawPaths = Array.isArray(parsed?.paths) ? parsed.paths : [];
  return new Set(rawPaths.filter((p): p is string => typeof p === 'string'));
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

/**
 * GitHub templateとClaude custom agent templateの配布元・展開先について、同期状態を検査し、
 * 差分（欠落・内容不一致）の説明文一覧を返す。
 * 差分が無ければ空配列を返す。`verify.ts` の `verify template-sync` と `doctor.ts` の
 * template-sync検査の両方から呼ばれる共有実装（DRY）。
 */
/** `.claude/` 配下の展開先表示パスの末尾component（`claude_agents`→`agents`、`claude_skills`→`skills`）。 */
const CLAUDE_NAMESPACE_DISPLAY_SEGMENT: Partial<Record<TemplateMapping['id'], string>> = {
  claude_agents: 'agents',
  claude_skills: 'skills',
};

export function computeTemplateSyncDiffs(targetRoot: string): string[] {
  const diffs: string[] = [];
  const packageSourceTree = path.resolve(targetRoot) === path.resolve(packageRoot());
  for (const mapping of resolveTemplateMappings(targetRoot)) {
    // パッケージ自身では .claude/ はローカル実行系の生成物としてGit管理外であり、clean checkoutには
    // 展開先が存在しない。配布元templateはGit管理・package同梱検査の対象なので、source tree自身に限り
    // 未展開を許容する。consumerではinit/upgrade後の削除・不整合を従来どおり欠落として検出する。
    const sourceFiles = listFilesRecursive(mapping.source).map((p) => path.relative(mapping.source, p));
    const destFiles = new Set(listFilesRecursive(mapping.dest).map((p) => path.relative(mapping.dest, p)));
    if (mapping.id !== 'github' && packageSourceTree && destFiles.size === 0) continue;
    const seedOnly = loadSeedOnlyPaths(mapping.source);
    for (const rel of sourceFiles) {
      const claudeSegment = CLAUDE_NAMESPACE_DISPLAY_SEGMENT[mapping.id];
      const displayPath = claudeSegment ? path.join('.claude', claudeSegment, rel) : rel;
      if (!destFiles.has(rel)) {
        diffs.push(`未同期（欠落）: ${displayPath}`);
        continue;
      }
      // seed-only: 初回配置の存在は保証するが、以降の内容カスタマイズ（例: CODEOWNERSの
      // プレースホルダー書き換え）は正当な乖離として許容し、完全一致検査の対象から外す。
      if (seedOnly.has(rel)) continue;
      if (!fs.readFileSync(path.join(mapping.source, rel)).equals(fs.readFileSync(path.join(mapping.dest, rel)))) {
        diffs.push(`未同期（差分あり）: ${displayPath}`);
      }
    }
  }
  return diffs;
}
