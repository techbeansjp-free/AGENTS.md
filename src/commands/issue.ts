import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { git, gh } from '../lib/exec.js';
import { defaultBranch, findIssueWorktree } from '../lib/worktree.js';
import { expandPattern } from '../lib/pattern.js';
import { formatToRegex } from '../lib/timestamp.js';
import { parseIssueId, validateSlug, validateType, CliError } from '../lib/issue.js';
import { stateFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const START_USAGE = `
使い方: agent-skill-chain issue start <issue_id> <type> <slug> <issue_created_at>

issue_id:         ISSUE-<番号> 形式のIssue ID
type:             config/agent-skill-chain.yaml issue.allowed_types のいずれか
                   （feature|bugfix|hotfix|refactor|docs|process）
slug:             ブランチ名・worktreeパスに用いるslug（worktree.slug_max_length以下）
issue_created_at: Issue起票日時（Asia/Tokyo、worktree.timestamp.format に従う）

出力:
  成功時: 終了コード0。生成したブランチ名・worktreeパスを標準出力へ。
  失敗時: 終了コード1以上。規約違反の理由を標準エラー出力へ。
`;

const RESUME_USAGE = `
使い方: agent-skill-chain issue resume <issue_id>

issue_id: ISSUE-<番号> 形式のIssue ID。

出力:
  成功時: 終了コード0。復元したworktreeパス・segment・gate状態を標準出力へ。
  失敗時: 終了コード1以上。push済み状態が存在しない等の理由を標準エラー出力へ。
`;

export async function start(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(START_USAGE);
      return 0;
    }
    const [issueIdRaw, type, slug, issueCreatedAt] = args;
    if (!issueIdRaw || !type || !slug || !issueCreatedAt) {
      throw new CliError('issue_id, type, slug, issue_created_at はすべて必須です');
    }

    const { number } = parseIssueId(issueIdRaw);
    const root = repoRoot();
    const config = loadConfig(root);

    validateType(type, config.issue.allowed_types);
    validateSlug(slug, config.worktree.slug_max_length);
    if (!formatToRegex(config.worktree.timestamp.format).test(issueCreatedAt)) {
      throw new CliError(
        `issue_created_at は ${config.worktree.timestamp.format} 形式である必要があります: '${issueCreatedAt}'`,
      );
    }

    const branch = expandPattern(config.branch.pattern, { type, issue_id: number, slug });
    const worktreeRel = expandPattern(config.worktree.path_pattern, {
      issue_created_at: issueCreatedAt,
      type,
      issue_id: number,
      slug,
    });
    const worktreePath = path.join(root, config.worktree.root, worktreeRel);

    if (git(['rev-parse', '--verify', branch], root).status === 0) {
      throw new CliError(`branch は既に存在します: ${branch}`);
    }
    if (fs.existsSync(worktreePath)) {
      throw new CliError(`worktree パスは既に存在します: ${worktreePath}`);
    }

    const base = defaultBranch(root);
    const add = git(['worktree', 'add', '-b', branch, worktreePath, base], root);
    if (add.status !== 0) {
      return fail(`git worktree add に失敗しました: ${add.stderr.trim()}`);
    }

    if (config.coordination.backend === 'local') {
      // I8: risk != normal（unclassified含む）OR autonomy == full → review_profile: strict
      const reviewProfile =
        config.risk.default !== 'normal' || config.autonomy.default === 'full' ? 'strict' : 'standard';
      const state = {
        schema_version: 'agent-skill-chain/state/v1',
        id: issueIdRaw,
        autonomy: config.autonomy.default,
        risk: config.risk.default,
        review_profile: reviewProfile,
        segment: { id: 'spec', status: 'pending', blockers: [] },
        gate: {
          id: 'spec',
          profile: reviewProfile,
          conformance: { verdict: 'pending', evidence: [] },
          falsification: { verdict: 'pending', counterexamples_tested: [] },
        },
      };
      const outcome = validateAgainstSchema('state', state, root);
      if (!outcome.valid) {
        return fail(`初期state生成がスキーマに適合しません: ${outcome.errors.join('; ')}`);
      }
      writeYamlFileAtomic(stateFilePath(root, number), state);
    }

    return ok(`${branch}\n${worktreePath}`);
  });
}

export async function resume(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RESUME_USAGE);
      return 0;
    }
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    const entry = findIssueWorktree(root, config, number);
    if (!entry) {
      throw new CliError(
        `ISSUE-${number} に対応する worktree が見つかりません（git worktree list --porcelain に実体無し。push済み状態が復元できません）`,
      );
    }

    const lines = [`worktree: ${entry.path}`, `branch: ${entry.branch ?? '(detached)'}`];

    if (config.coordination.backend === 'local') {
      const state = tryReadYamlFile<{ segment: { id: string; status: string }; gate: { id: string; final?: string } }>(
        stateFilePath(root, number),
      );
      if (!state) {
        throw new CliError(`state.yaml が見つかりません: ${stateFilePath(root, number)}`);
      }
      lines.push(`segment: ${state.segment.id} (${state.segment.status})`);
      lines.push(`gate: ${state.gate.id}`);
    } else if (entry.branch) {
      const prView = gh(['pr', 'list', '--head', entry.branch, '--json', 'url,number,state,statusCheckRollup']);
      if (prView.status === 0 && prView.stdout.trim() !== '[]') {
        lines.push(`gh pr: ${prView.stdout.trim()}`);
      } else {
        lines.push('gh pr: 見つかりません（gh未認証、またはDraft PR未作成の可能性）');
      }
    }

    return ok(lines.join('\n'));
  });
}
