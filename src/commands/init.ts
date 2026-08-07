import path from 'node:path';
import fs from 'node:fs';
import { copyTreeFailOnConflict } from '../lib/fs-copy.js';
import { collectManagedAssetMappings, packageVersion } from '../lib/asset-manifest.js';
import { writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';
import { digestOfFile } from '../lib/digest.js';
import {
  toOwnershipKey,
  readOwnershipRecord,
  writeOwnershipRecord,
  mergeRetainedOwnershipFiles,
  ownershipRecordPath,
} from '../lib/ownership-record.js';

const USAGE = `
使い方: agent-skill-chain init [target_dir] [--dry-run]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実ファイルを書き込まず、作成予定のファイル一覧のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。作成したファイル一覧（またはdry-run時は作成予定一覧）を標準出力へ。
  失敗時（既存ファイルと内容衝突）: 終了コード1以上。衝突ファイルパスと理由を標準エラー出力へ。
`;

/**
 * setup（bare）が持つローカルファイル操作部分（gh API呼び出しを伴わない部分）を吸収した新設
 * コマンド。GitHub API（labels/ruleset）には触れない（ADR-1）。
 */
export async function init(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();
    if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

    // Issue #492: `upgrade`が削除候補判定の基準集合として認識するファイル集合と同一の走査ロジック
    // （`collectManagedAssetMappings`）から導出する。2箇所の独立ループの乖離により削除候補判定が
    // 誤るリスクを構造的に排除する（手動implementation-gateレビュー指摘: stale-delete-scope-invariant-untested）。
    const conflictCheckedEntries = collectManagedAssetMappings(targetDir);

    // 衝突検出時は他ファイルへの書込みも一切行わない（部分適用しない）。
    // そのため、実書き込みの前に全対象を dryRun:true で先読み検査する
    // （Issue #169 F1: 逐次書込みだと衝突検出前のエントリが既にディスクへ書かれてしまう不備の是正）。
    if (!dryRun) {
      for (const { src, dest } of conflictCheckedEntries) {
        copyTreeFailOnConflict(src, dest, { dryRun: true, root: targetDir });
      }
    }

    const prefix = dryRun ? 'planned ' : '';
    const summary: string[] = [];
    const ownedFiles: Record<string, string> = {};

    for (const { src, dest } of conflictCheckedEntries) {
      const results = copyTreeFailOnConflict(src, dest, { dryRun, root: targetDir });
      summary.push(...results.map((r) => `${prefix}${r.action}: ${r.path}`));
      if (!dryRun) {
        for (const r of results) {
          ownedFiles[toOwnershipKey(targetDir, r.path)] = digestOfFile(r.path);
        }
      }
    }

    if (!dryRun) {
      writeInstalledVersion(targetDir, packageVersion());
      // Issue #492: 初回導入時点は既存記録が無いため、そのまま現行配布ファイルの一覧を書き込む。
      // 2回目以降の実行（同一target_dirへの再init）では、既存記録に残っていたretainedエントリ
      // （upgradeが保護目的で保持していた、現行配布元には無いファイル等）を消失させないよう
      // マージしてから書き込む。既存記録が破損している場合はupgrade.tsと同様に上書きをスキップし
      // 警告する（手動implementation-gateレビュー指摘）。
      const { record: previousOwnershipRecord, warning: ownershipRecordWarning } = readOwnershipRecord(targetDir);
      if (ownershipRecordWarning) {
        summary.push(
          `所有権記録（${ownershipRecordPath(targetDir)}）が破損しているため、今回は記録の更新をスキップしました。記録ファイルを手動で確認・修正するか削除してから再実行してください。`,
        );
      } else {
        writeOwnershipRecord(targetDir, {
          version: packageVersion(),
          files: mergeRetainedOwnershipFiles(previousOwnershipRecord, ownedFiles),
        });
      }
    }
    summary.push('GitHub workflowは未展開です。必要な場合だけ setup github を明示実行してください。');
    summary.push(`${prefix}installed_version: ${packageVersion()}`);

    return ok(summary.join('\n'));
  });
}
