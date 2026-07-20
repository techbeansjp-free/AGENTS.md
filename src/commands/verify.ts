import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveAsset } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { loadSegments } from '../lib/segments.js';
import { parseIssueId, validateSegment, CliError, type Segment } from '../lib/issue.js';
import {
  findIssueWorktree,
  worktreePathRegex,
  branchNameRegex,
  listWorktrees,
  defaultBranch,
  resolveCurrentBranch,
} from '../lib/worktree.js';
import { readYamlFile } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { digestOfFile } from '../lib/digest.js';
import { git } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

function violations(lines: string[]): number {
  if (lines.length === 0) return 0;
  process.stderr.write(`${lines.join('\n')}\n`);
  return 1;
}

// ---- branch-name ----
const BRANCH_NAME_USAGE = `
使い方: agent-skill-chain verify branch-name [branch_name]

出力: 0=適合、1=違反またはスタブ未実装
`;
export async function branchName(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(BRANCH_NAME_USAGE), 0;
    const root = repoRoot();
    const config = loadConfig(root);
    const target = args[0] ?? resolveCurrentBranch(root);
    if (target === undefined) {
      return fail(
        '現在のブランチ名を解決できません（detached HEADかつ GITHUB_HEAD_REF 未設定）。branch_name を明示的に指定してください。',
      );
    }
    const regex = branchNameRegex(config);
    if (!regex.test(target)) {
      return violations([`branch '${target}' は branch.pattern（${config.branch.pattern}）に適合しません`]);
    }
    return ok();
  });
}

// ---- worktree-path ----
const WORKTREE_PATH_USAGE = `
使い方: agent-skill-chain verify worktree-path [worktree_path...]

出力: 0=適合、1=違反またはスタブ未実装
`;
export async function worktreePath(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(WORKTREE_PATH_USAGE), 0;
    const root = repoRoot();
    const config = loadConfig(root);
    const regex = worktreePathRegex(config);
    // 引数省略時は git worktree list --porcelain の全entryが対象になるが、その先頭は常に
    // 主worktree（root自身）であり、Issue worktree命名規則には決して適合しないため、
    // 除外しないと1件以上のworktreeが存在する限り必ず違反してしまう。
    const targets =
      args.length > 0 ? args : listWorktrees(root).map((w) => w.path).filter((p) => path.resolve(p) !== path.resolve(root));
    const bad = targets.filter((p) => !regex.test(path.basename(p)));
    return violations(bad.map((p) => `worktree '${p}' は worktree.path_pattern（${config.worktree.path_pattern}）に適合しません`));
  });
}

// ---- doc-length ----
const DOC_LENGTH_USAGE = `
使い方: agent-skill-chain verify doc-length

出力: 0=全対象ファイルが上限以内、1=超過またはスタブ未実装
`;
export async function docLength(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(DOC_LENGTH_USAGE), 0;
    const root = repoRoot();
    const limits: [string, number][] = [[path.join(root, 'AGENTS.md'), 150]];
    const templatesDir = resolveAsset('templates', root);
    for (const rel of [
      path.join('issue', 'SPEC.md'),
      path.join('issue', 'DESIGN.md'),
      path.join('issue', 'PLAN.md'),
      path.join('issue', 'VALIDATION.md'),
      path.join('adr', 'ADR.md'),
    ]) {
      const p = path.join(templatesDir, rel);
      if (fs.existsSync(p)) limits.push([p, 100]);
    }
    const bad = limits
      .map(([file, limit]) => ({ file, limit, count: fs.readFileSync(file, 'utf8').split('\n').length }))
      .filter(({ count, limit }) => count > limit);
    return violations(bad.map((b) => `${b.file}: ${b.count}行（上限${b.limit}行を超過）`));
  });
}

// ---- artifacts ----
const ARTIFACTS_USAGE = `
使い方: agent-skill-chain verify artifacts <issue_id> <segment>

出力: 0=当該セグメントの必須成果物は全て存在、1=欠落・不正segment・スタブ未実装
`;
function checkOutputExists(worktreePath: string, output: string): boolean {
  switch (output) {
    case 'SPEC.md':
    case 'DESIGN.md':
    case 'PLAN.md':
      return fs.existsSync(path.join(worktreePath, output));
    case 'ADR': {
      const dir = path.join(worktreePath, 'docs', 'adr');
      return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.md'));
    }
    case 'code': {
      const base = defaultBranch(worktreePath);
      const diff = git(['diff', '--stat', `${base}...HEAD`, '--', '.', ':!docs', ':!SPEC.md', ':!DESIGN.md', ':!PLAN.md', ':!VALIDATION.md'], worktreePath);
      return diff.status === 0 && diff.stdout.trim().length > 0;
    }
    case 'unit_test_results':
    case 'acceptance_test_results':
    case 'regression_test_results':
      // VALIDATION.md（schemas/validation-report.schema.yaml）内に記録される抽象出力。
      // ファイル単体としては存在しないため、VALIDATION.md自体の存在で代替確認する。
      return fs.existsSync(path.join(worktreePath, 'VALIDATION.md'));
    case 'pr':
      return true; // pr作成有無は pr create / gate publish 側の責務。ここでは検査対象外。
    default:
      return false;
  }
}
export async function artifacts(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(ARTIFACTS_USAGE), 0;
    const [issueIdRaw, segment] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateSegment(segment);

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) return fail(`ISSUE-${number} の worktree が見つかりません`);

    const def = loadSegments(root).segments.find((s) => s.id === segment);
    if (!def) return fail(`config/segments.yaml に segment '${segment}' が定義されていません`);

    const missing = def.outputs.filter((output) => !checkOutputExists(entry.path, output));
    return violations(missing.map((o) => `segment '${segment}' の必須成果物が欠落しています: ${o}`));
  });
}

// ---- gate-report ----
const GATE_REPORT_USAGE = `
使い方: agent-skill-chain verify gate-report <gate_report_path>

出力: 0=スキーマ適合かつconformance・falsification記録済み、1=違反・未実装
`;
interface GateReport {
  gate: {
    conformance: string;
    falsification: string;
    final: string;
    blockers: { origin: string }[];
    approved_artifacts: { path: string; digest: string }[];
  };
}
export async function gateReport(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(GATE_REPORT_USAGE), 0;
    const [reportPath] = args;
    if (!reportPath) throw new CliError('gate_report_path は必須です');
    const root = repoRoot();
    const report = readYamlFile<GateReport>(reportPath);
    const outcome = validateAgainstSchema('gate-report', report, root);
    const errors = [...outcome.errors];
    if (report.gate.conformance === 'pending') errors.push('gate.conformance が pending のままです');
    if (report.gate.falsification === 'pending') errors.push('gate.falsification が pending のままです');
    if (report.gate.final === 'pending') errors.push('gate.final が pending のままです');
    for (const artifact of report.gate.approved_artifacts) {
      const abs = path.join(root, artifact.path);
      if (fs.existsSync(abs) && digestOfFile(abs) !== artifact.digest) {
        errors.push(`approved_artifacts の digest が現在のファイル内容と一致しません: ${artifact.path}`);
      }
    }
    return violations(errors);
  });
}

// ---- template-sync ----
const TEMPLATE_SYNC_USAGE = `
使い方: agent-skill-chain verify template-sync [repo_root]

出力: 0=.github/は同期済み、1=未同期・スタブ未実装
`;
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
export async function templateSync(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(TEMPLATE_SYNC_USAGE), 0;
    const targetRoot = args[0] ? path.resolve(args[0]) : process.cwd();
    const source = resolveAsset(path.join('templates', 'github', '.github'), targetRoot);
    const dest = path.join(targetRoot, '.github');

    const sourceFiles = listFilesRecursive(source).map((p) => path.relative(source, p));
    const destFiles = new Set(listFilesRecursive(dest).map((p) => path.relative(dest, p)));

    const diffs: string[] = [];
    for (const rel of sourceFiles) {
      if (!destFiles.has(rel)) {
        diffs.push(`未同期（欠落）: ${rel}`);
        continue;
      }
      if (!fs.readFileSync(path.join(source, rel)).equals(fs.readFileSync(path.join(dest, rel)))) {
        diffs.push(`未同期（差分あり）: ${rel}`);
      }
    }
    return violations(diffs);
  });
}

// ---- adr ----
const ADR_USAGE = `
使い方: agent-skill-chain verify adr <adr_path>

出力: 0=ADRはライフサイクル・不変項目を遵守、1=違反・未実装
`;
export async function adr(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(ADR_USAGE), 0;
    const [adrPath] = args;
    if (!adrPath) throw new CliError('adr_path は必須です');
    const text = fs.readFileSync(adrPath, 'utf8');
    const fenceMatch = /```yaml\n([\s\S]*?)```/.exec(text);
    if (!fenceMatch) return violations([`${adrPath}: templates/adr/ADR.md 準拠のyamlフロントマターが見つかりません`]);
    const fm = fenceMatch[1];
    const errors: string[] = [];
    for (const required of ['id:', 'status:', 'supersedes:', 'superseded-by:']) {
      if (!fm.includes(required)) errors.push(`${adrPath}: フロントマターに '${required}' がありません`);
    }
    for (const section of ['## Context', '## Decision', '## Consequences']) {
      if (!text.includes(section)) errors.push(`${adrPath}: 必須セクション '${section}' がありません`);
    }
    const statusMatch = /^status:\s*(\S+)/m.exec(fm);
    if (statusMatch && !['proposed', 'accepted', 'superseded', 'deprecated'].includes(statusMatch[1])) {
      errors.push(`${adrPath}: 不正な status です: ${statusMatch[1]}`);
    }
    return violations(errors);
  });
}

// ---- ac-coverage ----
const AC_COVERAGE_USAGE = `
使い方: agent-skill-chain verify ac-coverage <issue_id>

出力: 0=全AC-IDの検証方法・証跡が対応済み、1=孤児AC・孤児テスト参照・証跡欠落・未実装
`;
interface ValidationReport {
  acceptance_criteria: { ac_id: string; verification: { mode: string }; evidence: string[] }[];
}
export async function acCoverage(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(AC_COVERAGE_USAGE), 0;
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) return fail(`ISSUE-${number} の worktree が見つかりません`);

    const specPath = path.join(entry.path, 'SPEC.md');
    const validationPath = path.join(entry.path, 'VALIDATION.md');
    if (!fs.existsSync(specPath)) return fail(`SPEC.md が見つかりません: ${specPath}`);
    if (!fs.existsSync(validationPath)) return fail(`VALIDATION.md が見つかりません: ${validationPath}`);

    const specAcIds = new Set([...fs.readFileSync(specPath, 'utf8').matchAll(/\bAC-[0-9]+\b/g)].map((m) => m[0]));
    const report = readYamlFile<ValidationReport>(validationPath);
    const outcome = validateAgainstSchema('validation-report', report, root);
    const errors = [...outcome.errors];

    const reportedIds = new Set(report.acceptance_criteria?.map((ac) => ac.ac_id) ?? []);
    for (const acId of specAcIds) {
      if (!reportedIds.has(acId)) errors.push(`孤児AC: ${acId} が VALIDATION.md に対応していません`);
    }
    for (const ac of report.acceptance_criteria ?? []) {
      if (!specAcIds.has(ac.ac_id)) errors.push(`孤児テスト参照: ${ac.ac_id} は SPEC.md に存在しません`);
      if (!ac.evidence || ac.evidence.length === 0) errors.push(`${ac.ac_id}: evidence が空です`);
    }
    return violations(errors);
  });
}
