import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, repoRoot, resolveAsset, ASSET_NAMESPACE } from '../lib/paths.js';
import { copyTreeFailOnConflict, copyTreeMirror } from '../lib/fs-copy.js';
import { readYamlFile } from '../lib/yaml-io.js';
import { gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const SETUP_USAGE = `
使い方: agent-skill-chain setup [target_dir]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。導入した内容の一覧を標準出力へ。
  失敗時: 終了コード1以上。標準エラー出力に理由。
`;

const GITHUB_USAGE = `
使い方: agent-skill-chain setup github [target_dir]

出力:
  成功時: 終了コード0。sync-templates・setup-labels・setup-ruleset の実行結果を標準出力へ。
  失敗時: 終了コード1以上。どの下位処理で失敗したかを標準エラー出力に明示。
`;

const LABELS_USAGE = `
使い方: agent-skill-chain setup labels [owner/repo]

出力:
  成功時: 終了コード0。作成・更新したラベル一覧を標準出力へ。
  失敗時: 終了コード1以上。gh api のエラーを標準エラー出力に転記。
`;

const RULESET_USAGE = `
使い方: agent-skill-chain setup ruleset [owner/repo]

出力:
  成功時: 終了コード0。適用したrulesetの内容を標準出力へ。
  失敗時: 終了コード1以上。gh api のエラーを標準エラー出力に転記。
`;

// root直下に残す物のみ（AGENTS.md §ディレクトリ構成）。他は .agent-skill-chain/ 配下へ。
const ROOT_LEVEL_ENTRIES = ['AGENTS.md', 'CLAUDE.md', path.join('docs', 'GLOSSARY.md')];
const NAMESPACED_ENTRIES = ['standards', 'templates', 'schemas', 'config', 'adapters', 'scripts', 'ci'];

export async function setup(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(SETUP_USAGE);
      return 0;
    }
    const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
    fs.mkdirSync(targetDir, { recursive: true });

    const summary: string[] = [];
    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeFailOnConflict(src, path.join(targetDir, entry));
      summary.push(...results.map((r) => `${r.action}: ${r.path}`));
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!fs.existsSync(src)) continue;
      const results = copyTreeFailOnConflict(src, path.join(targetDir, ASSET_NAMESPACE, entry));
      summary.push(...results.map((r) => `${r.action}: ${r.path}`));
    }

    const githubResult = githubBundle(targetDir);
    if (githubResult.status !== 0) {
      return fail(`setup github で失敗しました:\n${githubResult.message}`);
    }
    summary.push(githubResult.message);

    return ok(summary.join('\n'));
  });
}

function githubBundle(targetDir: string): { status: number; message: string } {
  const lines: string[] = [];
  const syncExit = syncStep(targetDir);
  if (syncExit.status !== 0) return { status: 1, message: `[sync templates] ${syncExit.message}` };
  lines.push(`[sync templates]\n${syncExit.message}`);

  const labelsExit = labelsStep(undefined, targetDir);
  if (labelsExit.status !== 0) return { status: 1, message: `[setup labels] ${labelsExit.message}` };
  lines.push(`[setup labels]\n${labelsExit.message}`);

  const rulesetExit = rulesetStep(undefined, targetDir);
  if (rulesetExit.status !== 0) return { status: 1, message: `[setup ruleset] ${rulesetExit.message}` };
  lines.push(`[setup ruleset]\n${rulesetExit.message}`);

  return { status: 0, message: lines.join('\n') };
}

function syncStep(targetDir: string): { status: number; message: string } {
  const source = resolveAsset(path.join('templates', 'github', '.github'), targetDir);
  const dest = path.join(targetDir, '.github');
  try {
    const results = copyTreeMirror(source, dest);
    return { status: 0, message: results.map((r) => `${r.action}: ${r.path}`).join('\n') || '(同期対象なし)' };
  } catch (error) {
    return { status: 1, message: error instanceof Error ? error.message : String(error) };
  }
}

interface LabelDef {
  name: string;
  color: string;
  description: string;
}

function repoFlag(ownerRepo?: string): string[] {
  return ownerRepo ? ['--repo', ownerRepo] : [];
}

function labelsStep(ownerRepo: string | undefined, cwd: string): { status: number; message: string } {
  const labelsPath = resolveAsset(path.join('templates', 'github', 'provisioning', 'labels.yaml'), cwd);
  const doc = readYamlFile<{ labels: LabelDef[] }>(labelsPath);
  const applied: string[] = [];
  for (const label of doc.labels) {
    const result = gh(
      [
        'label',
        'create',
        label.name,
        '--color',
        label.color,
        '--description',
        label.description,
        '--force',
        ...repoFlag(ownerRepo),
      ],
      cwd,
    );
    if (result.status !== 0) {
      return { status: 1, message: `ラベル '${label.name}' の適用に失敗しました: ${result.stderr.trim()}` };
    }
    applied.push(label.name);
  }
  return { status: 0, message: applied.join(', ') };
}

function rulesetStep(ownerRepo: string | undefined, cwd: string): { status: number; message: string } {
  const rulesetPath = resolveAsset(path.join('templates', 'github', 'provisioning', 'rulesets', 'main.json'), cwd);
  const ruleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf8')) as { name: string };
  const prefix = ownerRepo ? `repos/${ownerRepo}` : 'repos/{owner}/{repo}';

  const list = gh(['api', `${prefix}/rulesets`], cwd);
  if (list.status !== 0) return { status: 1, message: `既存ruleset一覧の取得に失敗しました: ${list.stderr.trim()}` };
  let existingId: number | undefined;
  try {
    const rulesets = JSON.parse(list.stdout) as { id: number; name: string }[];
    existingId = rulesets.find((r) => r.name === ruleset.name)?.id;
  } catch {
    // 空応答等は「未作成」として扱う。
  }

  const body = fs.readFileSync(rulesetPath, 'utf8');
  const apiPath = existingId ? `${prefix}/rulesets/${existingId}` : `${prefix}/rulesets`;
  const method = existingId ? 'PUT' : 'POST';
  const result = gh(['api', '-X', method, apiPath, '--input', '-'], cwd, body);
  if (result.status !== 0) return { status: 1, message: `ruleset 適用に失敗しました: ${result.stderr.trim()}` };
  return { status: 0, message: result.stdout.trim() };
}

export async function github(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(GITHUB_USAGE);
      return 0;
    }
    const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
    const result = githubBundle(targetDir);
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}

export async function labels(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(LABELS_USAGE);
      return 0;
    }
    const result = labelsStep(args[0], repoRoot());
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}

export async function ruleset(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RULESET_USAGE);
      return 0;
    }
    const result = rulesetStep(args[0], repoRoot());
    if (result.status !== 0) return fail(result.message);
    return ok(result.message);
  });
}
