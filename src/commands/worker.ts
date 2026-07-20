import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const CONTEXT_USAGE = `
使い方: agent-skill-chain worker context <issue_id>

launch_worker 起動ラッパー（worker-launch.sh）・アダプタが必要とするコンテキストを
KEY=VALUE 形式で標準出力へ出す。
  adapter=<claude|codex|human>   worker.adapter（未設定時 human）
  backend=<github|local>          coordination.backend
  issue_number=<n>                issue_id から抽出した番号
`;

/** worker.adapter・coordination.backend・issue番号を解決する（launch_worker起動ラッパー用）。 */
export async function context(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(CONTEXT_USAGE);
      return 0;
    }
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const adapter = config.worker.adapter ?? 'human';
    return ok([`adapter=${adapter}`, `backend=${config.coordination.backend}`, `issue_number=${number}`].join('\n'));
  });
}
