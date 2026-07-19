import path from 'node:path';
import { resolveAsset } from '../lib/paths.js';
import { copyTreeMirror } from '../lib/fs-copy.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain sync templates [target_dir]

target_dir: 同期先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。

出力:
  成功時: 終了コード0。同期したファイル一覧を標準出力へ。
  失敗時: 終了コード1以上。差分検知失敗等の理由を標準エラー出力へ。
`;

export async function templates(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
    const source = resolveAsset(path.join('templates', 'github', '.github'));
    const dest = path.join(targetDir, '.github');

    const results = copyTreeMirror(source, dest);
    return ok(results.map((r) => `${r.action}: ${r.path}`).join('\n') || '(同期対象なし)');
  });
}
