import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';
import { isWorkerSegment, resolveWorkerSelection, resolveModelForTier } from '../lib/worker-selection.js';

const CONTEXT_USAGE = `
使い方: agent-skill-chain worker context <issue_id> [segment]

launch_worker 起動ラッパー（worker-launch.sh）・アダプタが必要とするコンテキストを
KEY=VALUE 形式で標準出力へ出す。
  adapter=<claude|codex|human>          セグメント別上書き→worker.adapter→human の順で解決
  backend=<github|local>                coordination.backend
  issue_number=<n>                      issue_id から抽出した番号
  model_tier=<highest_capability>       セグメント別上書きに指定がある場合のみ出力
  model=<具体的なモデル文字列>          model_tierが指定されている場合、worker.model_tiers
                                         を引いて解決した値
  reasoning_effort=<medium|high|xhigh>  セグメント別上書きに指定がある場合のみ出力

segment（spec|design|implementation|validation）を省略した場合は adapter・backend・
issue_number の3行のみを返す（従来互換）。segment を指定すると、そのセグメントに
適用される worker.segment_overrides.<segment> の値を解決結果へ反映する。model_tier が
指定されているのに worker.model_tiers から具体的なモデル文字列を解決できない場合
（対応表が無い・当該ティアのエントリが無い・当該アダプタ用のモデルが無い）は、値を
推測せずこのコマンドがエラーで終了する。

恒久設定の変更: worker.segment_overrides.<segment>・worker.model_tiers（および
worker.adapter）は .agent-skill-chain/config/agent-skill-chain.yaml の直接編集で更新する。
専用の書き換えコマンドは存在しない。具体的なモデル文字列を書いてよいのは
worker.model_tiers だけであり、モデル世代の更新時はこの対応表の値だけを書き換える。
実行主体は writer lease を保持するセグメント作業ワーカーであり、当該変更を扱う Issue の
実装セグメントで編集する。進行役は調整状態のみを読み書きし（不変条件I5）、設定ファイルと
いう成果物側の資産は編集しない——対話で受けた指示は Issue への記録とワーカー起動に限って
反映する。現在の解決結果はこのコマンド（<issue_id> <segment>）で確認できる。
`;

/** worker.adapter・coordination.backend・Issue番号（・指定segmentのモデルティア/具体モデル/
 * reasoning effort）を解決する（launch_worker起動ラッパー用）。 */
export async function context(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(CONTEXT_USAGE);
      return 0;
    }
    const [issueIdRaw, segmentRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    if (!segmentRaw) {
      const adapter = config.worker.adapter ?? 'human';
      return ok([`adapter=${adapter}`, `backend=${config.coordination.backend}`, `issue_number=${number}`].join('\n'));
    }

    if (!isWorkerSegment(segmentRaw)) {
      throw new CliError(`segment は spec|design|implementation|validation のいずれかである必要があります: ${segmentRaw}`);
    }

    const selection = resolveWorkerSelection(config, segmentRaw);
    const lines = [`adapter=${selection.adapter}`, `backend=${config.coordination.backend}`, `issue_number=${number}`];
    if (selection.model_tier) {
      lines.push(`model_tier=${selection.model_tier}`);
      const resolution = resolveModelForTier(config, selection.model_tier, selection.adapter);
      if (!resolution.ok) throw new CliError(resolution.reason);
      lines.push(`model=${resolution.model}`);
    }
    if (selection.reasoning_effort) lines.push(`reasoning_effort=${selection.reasoning_effort}`);
    return ok(lines.join('\n'));
  });
}
