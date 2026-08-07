import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSET_NAMESPACE } from './paths.js';

const OWNERSHIP_RECORD_FILE_NAME = '.owned-files.json';

/** 破損記録検知時の警告文言。読み取り不能時も破損時も同一文言（Issue #492 DESIGN.md）。 */
export const OWNERSHIP_RECORD_UNREADABLE_WARNING =
  '所有権記録を読み取れなかったため、今回は削除候補の判定をスキップしました。';

/** そのバージョンで本パッケージが導入先へ書き込んだファイルの一覧（root相対・`/`区切りキー→内容digest）。 */
export interface OwnershipRecord {
  version: string;
  files: Record<string, string>;
}

export interface OwnershipRecordReadResult {
  record: OwnershipRecord | undefined;
  /** 記録が存在しない（未導入・記録導入前）場合は付与しない。破損検知時のみ付与する。 */
  warning?: string;
}

export function ownershipRecordRelativePath(): string {
  return path.join(ASSET_NAMESPACE, OWNERSHIP_RECORD_FILE_NAME);
}

export function ownershipRecordPath(root: string): string {
  return path.join(root, ownershipRecordRelativePath());
}

/** 導入先の絶対パスを、記録上の正規化キー（root相対・`/`区切り）へ変換する。 */
export function toOwnershipKey(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/** 記録上の正規化キーを導入先の絶対パスへ戻す。 */
export function fromOwnershipKey(root: string, key: string): string {
  return path.join(root, ...key.split('/'));
}

/**
 * `key` を `fromOwnershipKey` で解決した絶対パスが `root` 配下に収まっているかを判定する。
 * 所有権記録が改ざん・破損し `../` を含むキーになっていた場合でも、削除候補の解決先が
 * 導入先の外を指さないことを保証する（AGENTS.md I8: 既定は安全側）。
 */
export function isWithinRoot(root: string, key: string): boolean {
  const relative = path.relative(root, fromOwnershipKey(root, key));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isValidRecordShape(value: unknown): value is OwnershipRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string') return false;
  if (typeof record.files !== 'object' || record.files === null || Array.isArray(record.files)) return false;
  return Object.values(record.files as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

/**
 * 所有権記録を読み取る。ファイル不在（未導入・記録導入前バージョンからの`upgrade`）は正常系として
 * `{ record: undefined }` を返す。JSON構文エラー・想定構造との不一致・読み取り自体の失敗は、
 * 例外を投げず同じく「記録なし（空集合）」として扱うが、`warning` を付与する
 * （Issue #492 DESIGN.md 障害・ロールバック考慮: 所有権記録の破損）。
 */
export function readOwnershipRecord(root: string): OwnershipRecordReadResult {
  const filePath = ownershipRecordPath(root);
  if (!fs.existsSync(filePath)) return { record: undefined };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { record: undefined, warning: OWNERSHIP_RECORD_UNREADABLE_WARNING };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { record: undefined, warning: OWNERSHIP_RECORD_UNREADABLE_WARNING };
  }

  if (!isValidRecordShape(parsed)) {
    return { record: undefined, warning: OWNERSHIP_RECORD_UNREADABLE_WARNING };
  }
  return { record: parsed };
}

/**
 * 所有権記録をアトミックに書き込む（tmpファイル書込み+rename、`yaml-io.ts` の
 * `writeYamlFileAtomic` と同じ原子性パターンをJSONへ適用する）。
 */
export function writeOwnershipRecord(root: string, record: OwnershipRecord): void {
  const filePath = ownershipRecordPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}
