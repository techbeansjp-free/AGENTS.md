import fs from 'node:fs';
import path from 'node:path';

/**
 * ADR（`docs/adr/*.md`）のyamlフロントマターから抽出した構造化データ。
 * `lint adr check`（src/commands/lint.ts）と doctor の ADR整合性検査（Issue #188 D5）が共有する。
 */
export interface AdrFrontmatter {
  id: string;
  status: string;
  supersedes: string[];
  'superseded-by': string | null;
}

export function parseAdrFrontmatter(text: string): AdrFrontmatter | undefined {
  const match = /```yaml\n([\s\S]*?)```/.exec(text);
  if (!match) return undefined;
  const lines = match[1].split('\n');
  const get = (key: string): string | undefined => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  };
  const id = get('id');
  const status = get('status');
  if (!id || !status) return undefined;
  const supersedesRaw = get('supersedes') ?? '[]';
  const supersedes = [...supersedesRaw.matchAll(/ADR-[0-9]+/g)].map((m) => m[0]);
  const supersededByRaw = get('superseded-by') ?? 'null';
  const supersededBy = supersededByRaw === 'null' ? null : supersededByRaw.replace(/^["']|["']$/g, '');
  return { id, status, supersedes, 'superseded-by': supersededBy };
}

/** `docs/adr/` 配下の全ADRファイルをid索引のMapとして読み込む。ディレクトリが無ければ空Map。 */
export function collectAdrRecords(root: string): Map<string, AdrFrontmatter> {
  const adrDir = path.join(root, 'docs', 'adr');
  const files = fs.existsSync(adrDir) ? fs.readdirSync(adrDir).filter((f) => f.endsWith('.md')) : [];
  const byId = new Map<string, AdrFrontmatter>();
  for (const file of files) {
    const fm = parseAdrFrontmatter(fs.readFileSync(path.join(adrDir, file), 'utf8'));
    if (fm) byId.set(fm.id, fm);
  }
  return byId;
}

/**
 * supersedes ⇔ superseded-by の対称性・参照先の実在を検査する（`lint adr check` の中核ロジック）。
 * 違反メッセージの文言は既存の `lint adr check` 出力と完全互換（後方互換のため変更不可）。
 */
export function checkAdrSymmetry(byId: Map<string, AdrFrontmatter>): string[] {
  const violations: string[] = [];
  for (const [id, fm] of byId) {
    for (const supersededId of fm.supersedes) {
      const target = byId.get(supersededId);
      if (!target) {
        violations.push(`${id}: supersedes が指す ${supersededId} が存在しません`);
      } else if (target['superseded-by'] !== id) {
        violations.push(`${id} と ${supersededId}: supersedes ⇔ superseded-by が非対称です`);
      }
    }
    if (fm['superseded-by']) {
      const target = byId.get(fm['superseded-by']);
      if (!target) {
        violations.push(`${id}: superseded-by が指す ${fm['superseded-by']} が存在しません`);
      } else if (!target.supersedes.includes(id)) {
        violations.push(`${id} と ${fm['superseded-by']}: superseded-by ⇔ supersedes が非対称です`);
      }
    }
  }
  return violations;
}
