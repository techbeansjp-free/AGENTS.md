import fs from 'node:fs';
import path from 'node:path';
import { ASSET_NAMESPACE } from './paths.js';

const VERSION_FILE_NAME = '.installed_version';

/** `.agent-skill-chain/.installed_version` の root からの相対パス。`uninstall` の削除対象一覧等が参照する。 */
export function versionMarkerRelativePath(): string {
  return path.join(ASSET_NAMESPACE, VERSION_FILE_NAME);
}

/** `.agent-skill-chain/.installed_version` の絶対パス（Issue #169のデータ設計に基づく）。 */
export function versionMarkerPath(root: string): string {
  return path.join(root, versionMarkerRelativePath());
}

/** 導入済みバージョンを読み取る。未導入（ファイル不在）なら undefined を返す。 */
export function readInstalledVersion(root: string): string | undefined {
  const filePath = versionMarkerPath(root);
  if (!fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, 'utf8').trim();
  return text.length > 0 ? text : undefined;
}

/** 導入済みバージョンを記録する（1行のsemver文字列）。 */
export function writeInstalledVersion(root: string, version: string): void {
  const filePath = versionMarkerPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${version}\n`);
}
