import { git } from '../lib/exec.js';
import { repoRoot } from '../lib/paths.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { CliError } from '../lib/issue.js';
import { resolveCurrentBranch } from '../lib/worktree.js';

const USAGE = `
使い方: agent-skill-chain checkpoint <message>

message: commitメッセージ。

出力:
  成功時: 終了コード0。生成したcommit SHAを標準出力へ。
  失敗時: 終了コード1以上。標準エラー出力に理由。
`;

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [message] = args;
    if (!message) throw new CliError('message は必須です');

    const root = repoRoot();
    const add = git(['add', '-A'], root);
    if (add.status !== 0) return fail(`git add に失敗しました: ${add.stderr.trim()}`);

    const status = git(['status', '--porcelain'], root);
    if (status.stdout.trim().length === 0) {
      return fail('commit対象の変更がありません');
    }

    const commit = git(['commit', '-m', message], root);
    if (commit.status !== 0) return fail(`git commit に失敗しました: ${commit.stderr.trim()}`);

    const branch = resolveCurrentBranch(root);
    if (branch === undefined) {
      return fail(
        '現在のブランチ名を解決できません（detached HEADかつ GITHUB_HEAD_REF 未設定。commitは成功済み）: git push を手動で実行してください。',
      );
    }
    // -u で upstream 追跡を設定する（worktree add -b で作成した新規branchは追跡未設定のため、
    // 素の push だけでは lib/worktree.ts の hasUnpushedCommits が @{upstream} を解決できず、
    // push成功後も常に「未push」と誤判定してしまう）。
    // refspec は素の `branch` ではなく `HEAD:refs/heads/${branch}` を使う: 素の `branch` は
    // ローカルの同名branch refを指す refspec であり、detached HEAD状態（resolveCurrentBranch が
    // GITHUB_HEAD_REF へフォールバックした場合）では現在のHEADと一致しない可能性があり、
    // 今しがたcommitした内容ではなく古いbranch refの内容を push してしまう。HEAD を明示することで
    // 常に「今このcheckoutで作った commit」がpushされることを保証する（attached時は従来と同じ）。
    const push = git(['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], root);
    if (push.status !== 0) return fail(`git push に失敗しました（commitは成功済み）: ${push.stderr.trim()}`);

    const sha = git(['rev-parse', 'HEAD'], root).stdout.trim();
    return ok(sha);
  });
}
