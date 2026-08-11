import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

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
  const data = parse(match[1]) as Record<string, unknown> | null;
  if (!data) return undefined;
  const id = data?.id;
  const status = data?.status;
  if (typeof id !== 'string' || typeof status !== 'string') return undefined;
  const supersedes = Array.isArray(data.supersedes)
    ? data.supersedes.filter((value): value is string => typeof value === 'string' && /^ADR-[0-9]+$/.test(value))
    : [];
  const supersededBy = typeof data['superseded-by'] === 'string' ? data['superseded-by'] : null;
  return { id, status, supersedes, 'superseded-by': supersededBy };
}

/** `docs/adr/` 配下のADR1件分のfrontmatterと、それを読み取ったファイル名の組。 */
export interface AdrFileRecord {
  file: string;
  frontmatter: AdrFrontmatter;
}

/**
 * `docs/adr/` 配下の全ADRファイルを、id での重複排除をせずに列挙する。ディレクトリが無ければ空配列。
 * `checkAdrIdUniqueness()` の入力として使う（`collectAdrRecords()` の `Map` は id 重複時に後勝ちで
 * 上書きし重複自体を握りつぶすため、重複検出には使えない）。
 */
export function collectAdrFileRecords(root: string): AdrFileRecord[] {
  const adrDir = path.join(root, 'docs', 'adr');
  const files = fs.existsSync(adrDir) ? fs.readdirSync(adrDir).filter((f) => f.endsWith('.md')) : [];
  const records: AdrFileRecord[] = [];
  for (const file of files) {
    const frontmatter = parseAdrFrontmatter(fs.readFileSync(path.join(adrDir, file), 'utf8'));
    if (frontmatter) records.push({ file, frontmatter });
  }
  return records;
}

/** `docs/adr/` 配下の全ADRファイルをid索引のMapとして読み込む。ディレクトリが無ければ空Map。 */
export function collectAdrRecords(root: string): Map<string, AdrFrontmatter> {
  const byId = new Map<string, AdrFrontmatter>();
  for (const { frontmatter } of collectAdrFileRecords(root)) {
    byId.set(frontmatter.id, frontmatter);
  }
  return byId;
}

/**
 * `docs/adr/` 配下で同一 `id:` を持つファイルが2件以上存在する場合、id ごとに1件の違反メッセージを
 * 生成する（`重複ADR ID '<id>': <file1>, <file2>, ...` 形式）。`checkAdrSymmetry()` とは独立に、
 * `lint adr check` の出力配列へ結合される。
 */
export function checkAdrIdUniqueness(records: AdrFileRecord[]): string[] {
  const filesById = new Map<string, string[]>();
  for (const { file, frontmatter } of records) {
    const files = filesById.get(frontmatter.id);
    if (files) {
      files.push(file);
    } else {
      filesById.set(frontmatter.id, [file]);
    }
  }
  const violations: string[] = [];
  for (const [id, files] of filesById) {
    if (files.length > 1) {
      violations.push(`重複ADR ID '${id}': ${files.join(', ')}`);
    }
  }
  return violations;
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
