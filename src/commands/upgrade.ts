import path from 'node:path';
import fs from 'node:fs';
import { packageRoot, ASSET_NAMESPACE } from '../lib/paths.js';
import { copyTreeMirror } from '../lib/fs-copy.js';
import { ROOT_LEVEL_ENTRIES, NAMESPACED_ENTRIES, packageVersion } from '../lib/asset-manifest.js';
import { readInstalledVersion, writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { detectLegacyAssets, formatLegacyAssetWarning } from '../lib/legacy-migration.js';
import { resolveTemplateMappings } from '../lib/template-sync.js';
import { digestOfFile } from '../lib/digest.js';
import {
  readOwnershipRecord,
  writeOwnershipRecord,
  toOwnershipKey,
  fromOwnershipKey,
  ownershipRecordPath,
} from '../lib/ownership-record.js';
import { resolveStaleAssets, type StaleAssetOutcome } from '../lib/stale-assets.js';
import type { CopyResult } from '../lib/fs-copy.js';

const USAGE = `
使い方: agent-skill-chain upgrade [target_dir] [--dry-run]

target_dir: 更新先リポジトリのルートディレクトリ（省略時はカレントディレクトリ）。
--dry-run:  実ファイルを書き込まず、更新予定のファイル一覧のみを標準出力へ表示する。

出力:
  成功時: 終了コード0。更新前後のバージョン・更新ファイル一覧を標準出力へ。
  失敗時（未導入）: 終了コード1以上。「先にinitを実行してください」を標準エラー出力へ。
`;

/**
 * init済みプロジェクトの正本アセット（.agent-skill-chain/project/を除く）を現行パッケージ
 * バージョンへミラー更新する。NAMESPACED_ENTRIES定数にprojectを含めないことで、
 * project/への不可侵性を構造的に保証する（ADR-1関連）。
 */
export async function upgrade(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const dryRun = args.includes('--dry-run');
    const positional = args.find((a) => a !== '--dry-run');
    const targetDir = positional ? path.resolve(positional) : process.cwd();

    const oldVersion = readInstalledVersion(targetDir);
    if (!oldVersion) {
      return fail('未導入のプロジェクトです。先に init を実行してください。');
    }
    const newVersion = packageVersion();

    const prefix = dryRun ? 'planned ' : '';
    const summary: string[] = [`${oldVersion} -> ${newVersion}`];

    // Issue #492: 削除候補判定の入力となる、直前の所有権記録を読み取る。読み取り不能・破損時は
    // 例外を投げず「記録なし」として扱われ、警告のみ提示される（安全側、AGENTS.md I8）。
    // 記録が破損している場合、過去に記録されていたファイル一覧を今回の書き込みで失うと以後
    // 二度と削除候補として検出できなくなるため、削除候補判定だけでなく記録の書き込みも
    // 今回はスキップする（手動implementation-gateレビュー指摘: corrupt-record-silently-overwritten）。
    const { record: previousOwnershipRecord, warning: ownershipRecordWarning } = readOwnershipRecord(targetDir);
    if (ownershipRecordWarning) {
      summary.push(
        `所有権記録（${ownershipRecordPath(targetDir)}）が破損しているため、今回は削除候補の判定・記録更新の両方をスキップしました。記録ファイルを手動で確認・修正するか削除してから再実行してください。`,
      );
    }

    // 今回コピー対象になる現行配布元のファイルパス集合（削除候補差分計算の入力）。dry-run時も
    // 常に同一の集合が得られる（`copyTreeMirror` はdry-run有無に関わらず同じ計画を返すため）。
    const currentKeys = new Set<string>();
    // `dryRun: false` の時のみ、実際に書き込んだ内容から次回所有権記録のベースを作る。
    const currentFiles: Record<string, string> = {};

    function trackCopyResults(results: CopyResult[]): void {
      summary.push(...results.map((r) => `${prefix}${r.action}: ${r.path}`));
      for (const r of results) {
        const key = toOwnershipKey(targetDir, r.path);
        currentKeys.add(key);
        if (!dryRun) currentFiles[key] = digestOfFile(r.path);
      }
    }

    for (const entry of ROOT_LEVEL_ENTRIES) {
      const src = path.join(packageRoot(), entry);
      if (!fs.existsSync(src)) continue;
      trackCopyResults(copyTreeMirror(src, path.join(targetDir, entry), { dryRun, root: targetDir }));
    }
    for (const entry of NAMESPACED_ENTRIES) {
      const src = path.join(packageRoot(), ASSET_NAMESPACE, entry);
      if (!fs.existsSync(src)) continue;
      trackCopyResults(copyTreeMirror(src, path.join(targetDir, ASSET_NAMESPACE, entry), { dryRun, root: targetDir }));
    }
    const claudeAgents = resolveTemplateMappings(targetDir).find((mapping) => mapping.id === 'claude_agents');
    if (claudeAgents) {
      trackCopyResults(copyTreeMirror(claudeAgents.source, claudeAgents.dest, { dryRun, root: targetDir }));
    }

    // Issue #492: 配布元で廃止されたファイルの削除候補判定・（非dry-runなら）削除実行。
    const staleResult = resolveStaleAssets(
      targetDir,
      previousOwnershipRecord,
      currentKeys,
      dryRun ? undefined : currentFiles,
      dryRun,
    );
    summary.push(...staleResult.outcomes.map((outcome) => formatStaleAssetOutcome(outcome, prefix, targetDir)));

    summary.push(
      `${prefix}GitHub workflowは未更新です。配布templateを確認後、必要な場合だけ setup github を明示実行してください。`,
    );

    // Issue #352: 再設計以前の旧世代アセット（LEGACY_SOURCE_DIRが指す旧sourceディレクトリ・
    // 単体ファイルの.claude/hooks/PreToolUse.sh・settings.jsonの旧hook参照）は現行upgradeの同期対象ではなく、
    // 検知しなければサイレントに残留し新旧enforcementが矛盾する（AGENTS.md I8: 既定は安全側）。
    const legacyFindings = detectLegacyAssets(targetDir);
    const legacyWarning = formatLegacyAssetWarning(legacyFindings);
    if (legacyWarning) {
      summary.push('', legacyWarning);
    }

    if (!dryRun) {
      writeInstalledVersion(targetDir, newVersion);
      // Issue #492: 削除失敗の有無に関わらず、処理完了後に所有権記録を更新する
      // （削除に成功したエントリのみ除去、失敗・読み取り不能エントリは再試行のため保持）。
      // ただし記録自体が破損していた場合は書き込まない（上記コメント参照）。破損した記録ファイルを
      // 「現行配布ファイルのみ」の記録で上書きすると、過去の所有ファイル一覧が永久に失われるため。
      if (!ownershipRecordWarning) {
        writeOwnershipRecord(targetDir, { version: newVersion, files: staleResult.nextFiles ?? currentFiles });
      }
    }

    if (staleResult.hasDeleteFailure) {
      // Issue #492 要件6・要件11: 成功した全結果を含むsummaryを先に出力してから異常終了する
      // （既存の ok()/fail() の単純な二者択一ではなく、両方の出力を順に行う）。
      process.stdout.write(`${summary.join('\n')}\n`);
      const failedPaths = staleResult.outcomes
        .filter((outcome) => outcome.action === 'delete-failed')
        .map((outcome) => fromOwnershipKey(targetDir, outcome.key));
      return fail(`ファイルの削除に失敗しました: ${failedPaths.join(', ')}`);
    }

    return ok(summary.join('\n'));
  });
}

/** 削除候補の分類結果を、既存の`copyTreeMirror`結果と同一フォーマット・同一パス表現へ整形する（Issue #492）。 */
function formatStaleAssetOutcome(outcome: StaleAssetOutcome, prefix: string, targetDir: string): string {
  const displayPath = fromOwnershipKey(targetDir, outcome.key);
  if (outcome.action === 'deleted') return `deleted: ${displayPath}`;
  if (outcome.action === 'planned-deleted') return `${prefix}deleted: ${displayPath}`;
  return outcome.message ?? displayPath;
}
