import path from 'node:path';
import fs from 'node:fs';
import { copyTreeFailOnConflict } from '../lib/fs-copy.js';
import { collectManagedAssetMappings, packageVersion } from '../lib/asset-manifest.js';
import { writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';
import { digestOfFile } from '../lib/digest.js';
import { CliError } from '../lib/issue.js';
import {
  toOwnershipKey,
  readOwnershipRecord,
  writeOwnershipRecord,
  mergeRetainedOwnershipFiles,
  ownershipRecordPath,
} from '../lib/ownership-record.js';

const USAGE = `
使い方: agent-skill-chain init [target_dir] [--dry-run] [--profile=standard|lightweight]

target_dir: 導入先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実ファイルを書き込まず、作成予定のファイル一覧のみを標準出力へ表示する。
--profile:  standard（既定、常時規律モデル）| lightweight（軽量プロファイル、ADR-0023）。
            lightweight は CLAUDE.md への @AGENTS.md 常時importを行わず、
            coordination.backend: local を既定にし、強制層（setup github・enforce on）を
            適用しない。逸脱の機械的阻止が無いことを標準出力へ明示する。

出力:
  成功時: 終了コード0。作成したファイル一覧（またはdry-run時は作成予定一覧）を標準出力へ。
  失敗時（既存ファイルと内容衝突）: 終了コード1以上。衝突ファイルパスと理由を標準エラー出力へ。
`;

const PROFILE_FLAG_PATTERN = /^--profile=(.+)$/;

/**
 * `--profile`で始まるが`--profile=<値>`の形式に一致しない引数（`--profile`単体、
 * `--profile=`（値なし）、`--profile lightweight`のスペース区切り形式の`--profile`部分）を
 * 検出する。これを素通りさせるとpositional引数（導入先ディレクトリ）として誤解釈され、
 * `--profile`という文字列自体がディレクトリ名として`path.resolve`されてしまう
 * （手動implementation-gateレビュー指摘: init-profile-flag-parsing-edge）。
 */
function assertNoMalformedProfileFlag(args: string[]): void {
  const malformed = args.find((a) => a.startsWith('--profile') && !PROFILE_FLAG_PATTERN.test(a));
  if (malformed !== undefined) {
    throw new CliError('--profile は --profile=<値>（例: --profile=lightweight）の形式で指定してください。');
  }
}

function parseProfile(args: string[]): 'standard' | 'lightweight' {
  const match = args.map((a) => PROFILE_FLAG_PATTERN.exec(a)).find((m): m is RegExpExecArray => m !== null);
  if (!match) return 'standard';
  const value = match[1];
  if (value === 'standard' || value === 'lightweight') return value;
  throw new CliError(`--profile は standard または lightweight のいずれかである必要があります: ${value}`);
}

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
    assertNoMalformedProfileFlag(args);
    const dryRun = args.includes('--dry-run');
    const profile = parseProfile(args);
    const positional = args.find((a) => a !== '--dry-run' && !PROFILE_FLAG_PATTERN.test(a));
    const targetDir = positional ? path.resolve(positional) : process.cwd();
    if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

    // Issue #492: `upgrade`が削除候補判定の基準集合として認識するファイル集合と同一の走査ロジック
    // （`collectManagedAssetMappings`）から導出する。2箇所の独立ループの乖離により削除候補判定が
    // 誤るリスクを構造的に排除する（手動implementation-gateレビュー指摘: stale-delete-scope-invariant-untested）。
    // Issue #503（ADR-0023）: profileにより CLAUDE.md・config/agent-skill-chain.yaml の配布元が
    // 切り替わる以外、対象集合の拡大（.claude/skills/ の追加）はプロファイルを問わず適用される。
    const conflictCheckedEntries = collectManagedAssetMappings(targetDir, profile);

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
    if (profile === 'lightweight') {
      // 要件5・AC-5: 逸脱の機械的阻止が無いことを明示する（設計要素6）。
      summary.push(
        '軽量プロファイルで導入しました。PreToolUse hook（enforce on）・GitHub branch ruleset（setup github）などの強制層は導入されていません。本パッケージが定める規律（不変条件・4セグメント運用等）からの逸脱を機械的に阻止する手段は現状ありません。',
      );
    }

    return ok(summary.join('\n'));
  });
}
