import fs from 'node:fs';
import path from 'node:path';
import { createIssueStaging, validateIssue } from './domain/issue.js';
import { bootstrapProject, validateSpecs } from './domain/spec.js';
import { evaluateReview } from './domain/review.js';
import { createPullRequest, authorizeMerge } from './domain/delivery.js';
import { createWorktree, inspectFinalizeState } from './domain/worktree.js';
import { buildFinalizeReport, applyFinalize } from './domain/finalize.js';
import { init, upgrade, uninstall, doctor } from './domain/lifecycle.js';
import { loadTrustedPolicy } from './domain/policy.js';
import { validateScenarioTrace } from './domain/trace.js';
import { github } from './adapters/github.js';
import { git } from './lib/process.js';

/** @param {string[]} args */
function parse(args) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  const positionals = [];
  for (const arg of args) {
    if (!arg.startsWith('--')) positionals.push(arg);
    else {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      if (flags[rawKey] !== undefined) throw new Error(`オプションが重複しています: --${rawKey}`);
      flags[rawKey] = rest.length ? rest.join('=') : true;
    }
  }
  return { flags, positionals };
}

/** @param {Record<string, string|boolean>} flags @param {string} key */
function required(flags, key) {
  const value = flags[key];
  if (typeof value !== 'string' || value === '') throw new Error(`--${key}=...が必要です`);
  return value;
}

/** @param {unknown} value */
function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

/** @param {Record<string, string|boolean>} flags */
function applyMode(flags) {
  if (flags.apply === true && flags['dry-run'] === true) throw new Error('--applyと--dry-runは同時に指定できません');
  if (flags.apply !== true && flags['dry-run'] !== true) throw new Error('書き込み可能なコマンドには--dry-runまたは--applyが必要です');
  return flags.apply === true;
}

/** @param {string} root */
function defaultBranch(root) {
  const symbolic = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root, { allowFailure: true });
  if (symbolic.status === 0) return symbolic.stdout.trim().replace(/^origin\//, '');
  throw new Error('既定ブランチが不明です。origin/HEADを設定してください');
}

/** @param {string[]} argv */
export async function main(argv) {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    print({ usage: 'agent-skill-chain <issue|project|spec|review|worktree|pr|init|upgrade|doctor|uninstall> ...' });
    return 0;
  }
  if (command === 'issue' && subcommand === 'create') {
    const { flags } = parse(rest);
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    const assessment = JSON.parse(fs.readFileSync(required(flags, 'assessment'), 'utf8'));
    print(createIssueStaging(root, { title: required(flags, 'title'), answers: assessment }));
    return 0;
  }
  if (command === 'issue' && subcommand === 'validate') {
    const { flags, positionals } = parse(rest);
    const target = positionals[0] ?? required(flags, 'path');
    const result = validateIssue(path.resolve(target), { changedFiles: typeof flags.changed === 'string' ? flags.changed.split(',').filter(Boolean) : [] });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === 'issue' && subcommand === 'sync') {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const input = { operation: 'issue.sync', repository: required(flags, 'repo'), issue: Number(required(flags, 'issue')), bodyFile: path.resolve(required(flags, 'body-file')) };
    if (!apply) { print({ state: 'preview', ...input }); return 0; }
    if (flags.authorize !== 'approved') throw new Error('Issue同期には--authorize=approvedが必要です');
    print(github('issue.sync', input, process.cwd()));
    return 0;
  }
  if (command === 'project' && subcommand === 'bootstrap') {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    const kind = required(flags, 'kind');
    if (!['cli', 'api', 'service', 'library', 'batch', 'data', 'ui', 'theme', 'responsive', 'design-system'].includes(kind)) throw new Error('--kindが不正です');
    print(bootstrapProject(root, { apply, newProject: flags['new-project'] === true, onboardExisting: flags['onboard-existing'] === true, projectKind: /** @type {any} */ (kind) }));
    return 0;
  }
  if (command === 'spec' && subcommand === 'validate') {
    const { flags } = parse(rest);
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    const review = typeof flags.review === 'string' ? JSON.parse(fs.readFileSync(flags.review, 'utf8')) : undefined;
    const result = validateSpecs(root, { changedFiles: typeof flags.changed === 'string' ? flags.changed.split(',').filter(Boolean) : [], review });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === 'review' && subcommand === 'validate') {
    const { flags, positionals } = parse(rest);
    const file = positionals[0] ?? required(flags, 'file');
    const result = evaluateReview(JSON.parse(fs.readFileSync(file, 'utf8')));
    print(result);
    return result.approved ? 0 : 1;
  }
  if (command === 'trace' && subcommand === 'validate') {
    const { flags } = parse(rest);
    const result = validateScenarioTrace(required(flags, 'features-root'));
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === 'worktree' && subcommand === 'create') {
    const { flags } = parse(rest);
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    print(createWorktree({ repoRoot: root, worktreePath: required(flags, 'path'), branch: required(flags, 'branch'), base: required(flags, 'base'), expectedRepository: typeof flags.repo === 'string' ? flags.repo : undefined }));
    return 0;
  }
  if (command === 'worktree' && subcommand === 'finalize') {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(required(flags, 'root'));
    const target = path.resolve(required(flags, 'path'));
    const evidence = JSON.parse(fs.readFileSync(required(flags, 'evidence'), 'utf8'));
    const state = inspectFinalizeState(root, target, evidence);
    const report = buildFinalizeReport(state);
    if (!apply) { print(report); return report.safe ? 0 : 1; }
    const approvedHash = required(flags, 'report-hash');
    if (flags.authorize !== 'approved') throw new Error('完了処理の適用には--authorize=approvedが必要です');
    const result = applyFinalize({ report, approvedHash, currentState: inspectFinalizeState(root, target, evidence) }, (operation, payload) => {
      if (operation !== 'worktree.remove') throw new Error('未対応の完了処理です');
      git(['worktree', 'remove', payload.path], root);
    });
    print(result);
    return 0;
  }
  if (command === 'pr' && subcommand === 'create') {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const evidence = JSON.parse(fs.readFileSync(path.resolve(required(flags, 'evidence')), 'utf8'));
    const input = {
      apply, authorization: typeof flags.authorize === 'string' ? flags.authorize : undefined, repository: required(flags, 'repo'), issue: Number(required(flags, 'issue')),
      head: required(flags, 'head'), headSha: required(flags, 'head-sha'), base: required(flags, 'base'), evidence,
    };
    print(createPullRequest(input, (operation, payload) => github(operation, payload, process.cwd())));
    return 0;
  }
  if (command === 'pr' && subcommand === 'merge') {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    const repository = required(flags, 'repo');
    const pr = required(flags, 'pr');
    const method = required(flags, 'method');
    const base = defaultBranch(root);
    const trustedPolicy = loadTrustedPolicy(root, base);
    const inspected = github('pr.inspect', { repository, pr }, root);
    if (inspected.baseRefName !== base) throw new Error('PRの基点が検証済み既定ブランチではありません');
    const protection = github('branch.protection', { repository, branch: base }, root);
    const checks = (inspected.statusCheckRollup ?? []).filter((/** @type {any} */ item) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(item.conclusion ?? item.status)).map((/** @type {any} */ item) => item.name ?? item.context).filter(Boolean);
    const approvals = new Set((inspected.latestReviews ?? []).filter((/** @type {any} */ review) => review.state === 'APPROVED').map((/** @type {any} */ review) => review.author?.login).filter(Boolean)).size;
    const authorization = authorizeMerge({
      trustedPolicy, method, checks, reviews: approvals, branch: inspected.headRefName,
      humanApproval: flags['human-approved'] === true, repositoryVerified: true,
      shaVerified: Boolean(inspected.headRefOid && inspected.baseRefOid), protectionVerified: protection.known,
    });
    if (!authorization.allowed) throw new Error(`マージを拒否しました: ${authorization.reason}`);
    if (!apply) { print({ state: 'preview', authorization, pr: inspected.url, headSha: inspected.headRefOid, baseSha: inspected.baseRefOid }); return 0; }
    const rechecked = github('pr.inspect', { repository, pr }, root);
    if (rechecked.headRefOid !== inspected.headRefOid || rechecked.baseRefOid !== inspected.baseRefOid) throw new Error('マージ直前にPR状態が変化しました（TOCTOU）');
    print(github('pr.merge', { repository, pr, method }, root));
    return 0;
  }
  if (['init', 'upgrade', 'uninstall'].includes(command)) {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const apply = applyMode(flags);
    const root = path.resolve(positionals[0] ?? (typeof flags.root === 'string' ? flags.root : process.cwd()));
    print(command === 'init' ? init(root, { apply }) : command === 'upgrade' ? upgrade(root, { apply }) : uninstall(root, { apply }));
    return 0;
  }
  if (command === 'doctor') {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const root = path.resolve(positionals[0] ?? (typeof flags.root === 'string' ? flags.root : process.cwd()));
    const result = doctor(root);
    print(result);
    return result.healthy ? 0 : 1;
  }
  throw new Error(`不明なコマンドです: ${argv.join(' ')}`);
}
