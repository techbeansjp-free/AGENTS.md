import fs from 'node:fs';
import { digestOf } from './digest.js';
import { fromOwnershipKey, isWithinRoot, type OwnershipRecord } from './ownership-record.js';

/**
 * `.agent-skill-chain/project/` は consumer project 固有ポリシーの不可侵境界（AGENTS.md）。
 * `NAMESPACED_ENTRIES`（`asset-manifest.ts`）が `project` を含まないため通常は候補集合に
 * 現れないが、本モジュール内でもパスprefix一致による防御的除外を行う（Issue #492 DESIGN.md 二重防御）。
 */
const PROTECTED_KEY_PREFIX = '.agent-skill-chain/project/';

/** 候補ファイルを実ファイルシステムに対して分類した結果（Issue #492 DESIGN.md 状態遷移）。 */
export type StaleCandidateStatus = 'Absent' | 'Unreadable' | 'TypeChanged' | 'ContentMatch' | 'ContentChanged';

/** `resolveStaleAssets` が返す個々の候補ファイルの最終的な扱い。`Absent` は出力を伴わないため含まない。 */
export type StaleAssetAction = 'deleted' | 'planned-deleted' | 'delete-failed' | 'unreadable' | 'content-changed';

export interface StaleAssetOutcome {
  key: string;
  action: StaleAssetAction;
  /** `delete-failed`・`unreadable`・`content-changed` のみ付与する利用者向け説明文。 */
  message?: string;
}

export interface ResolveStaleAssetsResult {
  /** キー昇順（決定的な出力順序のため）。`Absent` に該当した候補は含まれない。 */
  outcomes: StaleAssetOutcome[];
  /**
   * 次回所有権記録として書き込むべきファイル集合。`dryRun: true` の場合は必ず `undefined`
   * （dry-run時は記録ファイルへ一切書き込まない、Issue #492 DESIGN.md）。
   */
  nextFiles: Record<string, string> | undefined;
  /** 1件以上 `delete-failed` があったか（要件6・要件11: `upgrade` 全体の異常終了要否判定に使う）。 */
  hasDeleteFailure: boolean;
}

function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 直前の所有権記録エントリ集合と、今回コピー対象になる現行配布元のファイルパス集合との差分から
 * 削除候補集合を求める純関数（要件3: (a)(b) を満たすファイルのみが対象）。
 */
export function computeCandidateKeys(
  previous: OwnershipRecord | undefined,
  currentKeys: ReadonlySet<string>,
): string[] {
  if (!previous) return [];
  return Object.keys(previous.files)
    .filter((key) => !currentKeys.has(key))
    .filter((key) => !key.startsWith(PROTECTED_KEY_PREFIX));
}

/**
 * 候補ファイルを導入先の実ファイルシステムへ対して分類する（要件2(c)・要件7・要件8）。
 * - ENOENT（物理的に存在しない）: `Absent`（要件7）。
 * - ENOENT以外の理由での読み取り失敗: `Unreadable`（要件8）。
 * - 通常ファイルでない（ディレクトリ化等）: `TypeChanged`。
 * - 内容が記録済みdigestと一致: `ContentMatch`。
 * - 内容が記録済みdigestと不一致: `ContentChanged`（要件3）。
 */
export function classifyCandidate(absolutePath: string, expectedDigest: string): StaleCandidateStatus {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    return errnoOf(error) === 'ENOENT' ? 'Absent' : 'Unreadable';
  }
  if (!stat.isFile()) return 'TypeChanged';

  let content: Buffer;
  try {
    content = fs.readFileSync(absolutePath);
  } catch (error) {
    return errnoOf(error) === 'ENOENT' ? 'Absent' : 'Unreadable';
  }
  return digestOf(content) === expectedDigest ? 'ContentMatch' : 'ContentChanged';
}

/**
 * `Unreadable` には読み取り失敗専用の `unreadableMessage`、`TypeChanged`・`ContentChanged` には
 * 内容変更検出専用の `changedMessage` を割り当てる（要件3・要件8がそれぞれ異なる警告文言を
 * 要求するため。DESIGN.md参照）。
 */
function unreadableMessage(displayPath: string): string {
  return `削除候補の判定のための読み取りに失敗したため削除しませんでした: ${displayPath}`;
}

function changedMessage(displayPath: string): string {
  return `配布元で廃止されたが導入先で変更が検出されたため削除しませんでした: ${displayPath}`;
}

function deleteFailedMessage(displayPath: string, detail: string): string {
  return `${displayPath} の削除に失敗しました: ${detail}`;
}

/** `dryRun: false` の場合のみ呼ぶ。ENOENTは目的状態達成済みとして成功扱いする（TOCTOU耐性）。 */
function tryDelete(absolutePath: string): { ok: true } | { ok: false; message: string } {
  try {
    fs.unlinkSync(absolutePath);
    return { ok: true };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return { ok: true };
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * 削除候補の分類・（`dryRun: false` の時のみ）削除実行・次回所有権記録エントリの算出を行う
 * （Issue #492 PLAN.md 変更単位#2）。
 *
 * @param root 導入先リポジトリのルート（絶対パス）。
 * @param previous 直前の所有権記録（読み取り失敗・破損時は `undefined`）。
 * @param currentKeys 今回コピー対象になる現行配布元のファイルパス集合（正規化キー）。
 * @param currentFiles 次回記録のベースとなる現行配布ファイルの key→digest。`dryRun: true` の
 *   場合は記録を書かないため未使用（`undefined` を渡してよい）。
 * @param dryRun `true` の場合、実ファイルの削除・記録の書き込みを一切行わない。
 */
export function resolveStaleAssets(
  root: string,
  previous: OwnershipRecord | undefined,
  currentKeys: ReadonlySet<string>,
  currentFiles: Record<string, string> | undefined,
  dryRun: boolean,
): ResolveStaleAssetsResult {
  const candidateKeys = computeCandidateKeys(previous, currentKeys).sort();
  const outcomes: StaleAssetOutcome[] = [];
  const retained: Record<string, string> = {};
  let hasDeleteFailure = false;

  for (const key of candidateKeys) {
    const expectedDigest = previous!.files[key];
    if (!isWithinRoot(root, key)) {
      // 記録が改ざん・破損し導入先の外を指すキーになっている場合、削除候補にも次回記録にも
      // 含めない（安全側。AGENTS.md I8）。
      continue;
    }
    const absolutePath = fromOwnershipKey(root, key);
    const status = classifyCandidate(absolutePath, expectedDigest);

    switch (status) {
      case 'Absent':
        // 目的状態（当該ファイルが導入先に存在しない）が既に達成済み。出力なし、次回記録から除去。
        break;
      case 'Unreadable':
        outcomes.push({ key, action: 'unreadable', message: unreadableMessage(absolutePath) });
        retained[key] = expectedDigest;
        break;
      case 'TypeChanged':
      case 'ContentChanged':
        outcomes.push({ key, action: 'content-changed', message: changedMessage(absolutePath) });
        retained[key] = expectedDigest;
        break;
      case 'ContentMatch':
        if (dryRun) {
          outcomes.push({ key, action: 'planned-deleted' });
          break;
        }
        {
          const deleted = tryDelete(absolutePath);
          if (deleted.ok) {
            outcomes.push({ key, action: 'deleted' });
          } else {
            outcomes.push({ key, action: 'delete-failed', message: deleteFailedMessage(absolutePath, deleted.message) });
            retained[key] = expectedDigest;
            hasDeleteFailure = true;
          }
        }
        break;
    }
  }

  const nextFiles = dryRun ? undefined : { ...(currentFiles ?? {}), ...retained };
  return { outcomes, nextFiles, hasDeleteFailure };
}
