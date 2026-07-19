import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../lib/paths.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain test run

cwd（対象worktree）の package.json に scripts.test が定義されていれば npm test を実行する。
.agent-skill-chain/standards/TEST_POLICY.md の「常時必須」のうちlint/format・型検査・単体テスト・
変更範囲の結合テストは対象プロジェクトのnpm testスクリプトへ委譲する想定（SAST・依存関係/secret
スキャンは対象プロジェクトのCI側で別途担保する）。

出力:
  成功時: 終了コード0。
  失敗時: 終了コード1以上。package.json不在・scripts.test未定義・npm test失敗の理由を標準エラー出力へ。
`;

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const root = repoRoot();
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return fail(`package.json が見つかりません（${pkgPath}）。npm以外のプロジェクトでは test run は未対応です`);
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.test) {
      return fail('package.json に scripts.test が定義されていません');
    }

    const result = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
      return fail(`npm test が失敗しました（終了コード ${result.status ?? 'unknown'}）`);
    }
    return ok();
  });
}
