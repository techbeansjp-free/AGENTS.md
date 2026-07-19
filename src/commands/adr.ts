import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, parseAdrId, CliError } from '../lib/issue.js';
import { findIssueWorktree } from '../lib/worktree.js';
import { reviewFilePath } from '../lib/local-state.js';
import { tryReadYamlFile } from '../lib/yaml-io.js';
import { digestOf } from '../lib/digest.js';
import { git } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain adr finalize <issue_id> <adr_id>

adr_id: ADR-<番号> 形式のADR ID（docs/adr/ 配下）

出力:
  成功時: 終了コード0。status: accepted へ更新したcommit SHAを標準出力へ。
  失敗時: 終了コード1以上。content digest不一致等の理由を標準エラー出力へ。
`;

interface GateReport {
  gate: { approved_artifacts: { path: string; digest: string }[] };
}

export async function finalize(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, adrIdRaw] = args;
    if (!issueIdRaw || !adrIdRaw) throw new CliError('issue_id, adr_id はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    const { adrId } = parseAdrId(adrIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) throw new CliError(`ISSUE-${number} の worktree が見つかりません`);

    const adrDir = path.join(entry.path, 'docs', 'adr');
    const candidates = fs.existsSync(adrDir)
      ? fs.readdirSync(adrDir).filter((f) => f.startsWith(`${adrId}-`) && f.endsWith('.md'))
      : [];
    if (candidates.length !== 1) {
      throw new CliError(`docs/adr/ 配下に ${adrId}-*.md が一意に見つかりません（${candidates.length}件）`);
    }
    const adrPath = path.join(adrDir, candidates[0]);
    const adrRelPath = path.relative(entry.path, adrPath);

    const designGate = tryReadYamlFile<GateReport>(reviewFilePath(root, number, 'design'));
    if (!designGate) {
      throw new CliError(`design gate の gate-report が見つかりません（先に design gate を publish してください）`);
    }
    const approved = designGate.gate.approved_artifacts.find((a) => a.path === adrRelPath);
    if (!approved) {
      throw new CliError(`design gate-report の approved_artifacts に ${adrRelPath} が記録されていません`);
    }

    const currentDigest = digestOf(fs.readFileSync(adrPath));
    if (currentDigest !== approved.digest) {
      return fail(
        `content digest が design gate 承認時と一致しません（承認時: ${approved.digest}, 現在: ${currentDigest}）`,
      );
    }

    const text = fs.readFileSync(adrPath, 'utf8');
    const fenceMatch = /```yaml\n([\s\S]*?)```/.exec(text);
    if (!fenceMatch) throw new CliError(`${adrRelPath} に templates/adr/ADR.md 準拠のyamlフロントマターが見つかりません`);
    const frontmatter = fenceMatch[1];
    if (!/^status:\s*proposed\s*$/m.test(frontmatter)) {
      throw new CliError(`${adrRelPath} は status: proposed ではありません（既に accepted 済み、または不正な状態）`);
    }
    const updatedFrontmatter = frontmatter.replace(/^status:\s*proposed\s*$/m, 'status: accepted');
    const updatedText = text.replace(frontmatter, updatedFrontmatter);
    fs.writeFileSync(adrPath, updatedText, 'utf8');

    const add = git(['add', adrRelPath], entry.path);
    if (add.status !== 0) return fail(`git add に失敗しました: ${add.stderr.trim()}`);
    const commit = git(['commit', '-m', `chore(adr): ${adrId} を accepted へ更新`], entry.path);
    if (commit.status !== 0) return fail(`git commit に失敗しました: ${commit.stderr.trim()}`);
    const branch = entry.branch;
    if (branch) {
      const push = git(['push', 'origin', branch], entry.path);
      if (push.status !== 0) return fail(`git push に失敗しました（commitは成功済み）: ${push.stderr.trim()}`);
    }

    const sha = git(['rev-parse', 'HEAD'], entry.path).stdout.trim();
    return ok(sha);
  });
}
