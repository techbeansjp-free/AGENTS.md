import fs from 'node:fs';
import path from 'node:path';
import { copyTreeMirror } from '../lib/fs-copy.js';
import { collectManagedAssetMappings, packageVersion } from '../lib/asset-manifest.js';
import { readInstalledVersion, writeInstalledVersion } from '../lib/version-marker.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { detectLegacyAssets, formatLegacyAssetWarning } from '../lib/legacy-migration.js';
import { digestOfFile } from '../lib/digest.js';
import { readYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { packageRoot } from '../lib/paths.js';
import {
  readOwnershipRecord,
  writeOwnershipRecord,
  toOwnershipKey,
  fromOwnershipKey,
  ownershipRecordPath,
} from '../lib/ownership-record.js';
import { resolveStaleAssets, type StaleAssetOutcome } from '../lib/stale-assets.js';
import type { CopyResult } from '../lib/fs-copy.js';

type Profile = 'standard' | 'lightweight';

/**
 * DESIGN.md 設計要素7: `agent-skill-chain.yaml` の `profile` 値のみをupgrade前後で保存・復元する。
 * 3ケースを機械的に区別する（対象ファイルが存在するか／`profile`フィールドが存在するか／
 * 値が既知enumか、の3条件のみで判定する）。
 *   ケースA（ファイル不在）        : 新規導入相当。standardが正しい既定値。警告なし。
 *   ケースB（profileフィールド欠落）: 本機能導入前からの正常な後方互換ケース。警告なし。
 *   ケースC（パース不能・不正値）  : 異常ケース。standardへフォールバックし警告する。
 */
function resolvePreservedProfile(targetDir: string): { profile: Profile; warning?: string } {
  const configPath = path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  if (!fs.existsSync(configPath)) {
    return { profile: 'standard' }; // ケースA
  }
  let parsed: unknown;
  try {
    parsed = readYamlFile(configPath);
  } catch {
    // ケースC（パース不能）: 対象ファイルの内容を行単位で修復することはできないため、
    // 後続処理（`collectManagedAssetMappings` 経由の `loadConfig(targetDir)`）が対象を
    // 読み取れるよう、決定済みの standard に対応する配布元既定値でその場修復する。
    // この内容は直後の通常コピー処理（`config` エントリのミラーコピー）でどのみち上書きされる
    // ため、ここでの書き込みは「読み取り可能にするための一時的な足場」に過ぎない。
    repairUnreadableConfig(configPath);
    return { profile: 'standard', warning: PROFILE_UNREADABLE_WARNING };
  }
  const rawProfile = (parsed as { profile?: unknown } | null | undefined)?.profile;
  if (rawProfile === undefined) {
    return { profile: 'standard' }; // ケースB
  }
  if (rawProfile === 'standard' || rawProfile === 'lightweight') {
    return { profile: rawProfile };
  }
  // ケースC（不正値）: `profile` フィールドのみをその場修復する（他フィールドは変更しない）。
  // これも直後のミラーコピーで上書きされる一時的な足場であり、他フィールドを保持する意味は
  // 「後続の`loadConfig`が同一ファイルの他フィールド〔`templates.*`等〕を読めること」のみにある。
  if (parsed !== null && typeof parsed === 'object') {
    writeYamlFileAtomic(configPath, { ...(parsed as Record<string, unknown>), profile: 'standard' });
  } else {
    repairUnreadableConfig(configPath);
  }
  return { profile: 'standard', warning: PROFILE_UNREADABLE_WARNING };
}

/** 対象の config/agent-skill-chain.yaml を、パッケージ同梱の既定（profile: standard）内容で置き換える。 */
function repairUnreadableConfig(configPath: string): void {
  const defaultSource = path.join(packageRoot(), '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  fs.copyFileSync(defaultSource, configPath);
}

const PROFILE_UNREADABLE_WARNING =
  '既存の agent-skill-chain.yaml の profile 設定を読み取れなかった（または不正な値だった）ため、既定値 standard として扱います。既に profile: lightweight を選択している場合は、upgrade 完了後に対象ファイルの profile フィールドを確認してください。';

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

    // Issue #503（ADR-0023）設計要素7: 既存の`profile`値を保存し、`collectManagedAssetMappings`へ
    // そのまま渡す。これにより`config`エントリの配布元（`agent-skill-chain.yaml`）が保存済み
    // profileに対応するテンプレートへ解決され、`profile`フィールド自体の値はupgradeで変更しない
    // （要件3・AC-3）。
    const { profile: preservedProfile, warning: profileWarning } = resolvePreservedProfile(targetDir);
    if (profileWarning) summary.push(profileWarning);

    // Issue #492: `init`が所有権記録へ書き込むキー集合と同一の走査ロジック
    // （`collectManagedAssetMappings`）から導出する。2箇所の独立ループの乖離により、削除候補判定の
    // 基準となる現行配布ファイル集合が誤る（黙って乖離しうる）リスクを構造的に排除する
    // （手動implementation-gateレビュー指摘: stale-delete-scope-invariant-untested）。
    for (const { src, dest } of collectManagedAssetMappings(targetDir, preservedProfile)) {
      trackCopyResults(copyTreeMirror(src, dest, { dryRun, root: targetDir }));
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
