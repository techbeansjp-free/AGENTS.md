import path from 'node:path';
import { copyTreeMirror } from '../lib/fs-copy.js';
import { resolveTemplateMappings } from '../lib/template-sync.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain sync templates [target_dir] [--dry-run]

target_dir: 同期先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  .github/・.claude/agents/・.claude/skills/ への実書込みを一切行わず、
            同期予定のファイル一覧のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。.github/・.claude/agents/・.claude/skills/へ同期したファイル一覧
          （--dry-run時は同期予定一覧）を標準出力へ。
  失敗時: 終了コード1以上。差分検知失敗等の理由を標準エラー出力へ。
`;

export async function templates(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();
    const prefix = dryRun ? 'planned ' : '';
    const mappings = resolveTemplateMappings(targetDir);
    // ISSUE-538: 大文字小文字のみ異なる既存ファイルとの衝突検知は dryRun の値に関わらず
    // 常に有効にする（衝突検知は計画段階で行われ、dryRunでも実書込み無しに同じ結果になる）。
    // 衝突検出時は他マッピングへの書込みも一切行わない（部分適用しない）。そのため、実書き込みの
    // 前に全マッピングを dryRun:true で先読み検査する（init.ts と同一の2段階パターン。マッピングを
    // またいだ場合に後段の衝突検知前で先行マッピングが既にディスクへ書かれてしまう不備の是正）。
    if (!dryRun) {
      for (const { source, dest } of mappings) {
        copyTreeMirror(source, dest, { root: targetDir, dryRun: true, detectCaseCollision: true });
      }
    }
    const results = mappings.flatMap(({ source, dest }) =>
      copyTreeMirror(source, dest, { root: targetDir, dryRun, detectCaseCollision: true }),
    );
    return ok(results.map((r) => `${prefix}${r.action}: ${r.path}`).join('\n') || '(同期対象なし)');
  });
}
