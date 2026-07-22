import fs from 'node:fs';
import path from 'node:path';
import { resolveAsset } from './paths.js';

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

/**
 * `.agent-skill-chain/templates/github/.github/`（配布元の正本）と `targetRoot` 配下の
 * `.github/`（展開先）の同期状態を検査し、差分（欠落・内容不一致）の説明文一覧を返す。
 * 差分が無ければ空配列を返す。`verify.ts` の `verify template-sync` と `doctor.ts` の
 * template-sync検査の両方から呼ばれる共有実装（DRY）。
 */
export function computeTemplateSyncDiffs(targetRoot: string): string[] {
  const source = resolveAsset(path.join('templates', 'github', '.github'), targetRoot);
  const dest = path.join(targetRoot, '.github');

  const sourceFiles = listFilesRecursive(source).map((p) => path.relative(source, p));
  const destFiles = new Set(listFilesRecursive(dest).map((p) => path.relative(dest, p)));

  const diffs: string[] = [];
  for (const rel of sourceFiles) {
    if (!destFiles.has(rel)) {
      diffs.push(`未同期（欠落）: ${rel}`);
      continue;
    }
    if (!fs.readFileSync(path.join(source, rel)).equals(fs.readFileSync(path.join(dest, rel)))) {
      diffs.push(`未同期（差分あり）: ${rel}`);
    }
  }
  return diffs;
}
