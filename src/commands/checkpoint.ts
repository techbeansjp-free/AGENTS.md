import { git } from '../lib/exec.js';
import { repoRoot } from '../lib/paths.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { CliError } from '../lib/issue.js';

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

    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).stdout.trim();
    const push = git(['push', 'origin', branch], root);
    if (push.status !== 0) return fail(`git push に失敗しました（commitは成功済み）: ${push.stderr.trim()}`);

    const sha = git(['rev-parse', 'HEAD'], root).stdout.trim();
    return ok(sha);
  });
}
