import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { defaultLiveFileRoots, walkTextFiles } from '../lib/scan.js';
import { parseForbiddenTerms } from '../lib/glossary.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const VOCAB_USAGE = `
使い方: agent-skill-chain lint vocab [path...]

path: 検査対象パス（省略時はリポジトリ全体の生きたファイル）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
`;

const REFERENCES_USAGE = `
使い方: agent-skill-chain lint references [path...]

path: 検査対象パス（省略時はリポジトリ全体の生きたファイル）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
`;

const ADR_USAGE = `
使い方: agent-skill-chain lint adr check

check: 検査を実行するサブコマンド（他のサブコマンドは将来拡張）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反ADR ID・理由を標準エラー出力へ。
`;

function resolveTargets(args: string[], root: string): string[] {
  return args.length > 0 ? args.map((p) => path.resolve(p)) : defaultLiveFileRoots(root);
}

export async function vocab(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(VOCAB_USAGE);
      return 0;
    }
    const root = repoRoot();
    const glossaryPath = path.join(root, 'docs', 'GLOSSARY.md');
    const forbidden = parseForbiddenTerms(glossaryPath);
    const files = walkTextFiles(resolveTargets(args, root));

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { banned, correctTerm } of forbidden) {
          if (line.includes(banned)) {
            violations.push(`${file}:${index + 1}: 禁止語 '${banned}' が見つかりました（'${correctTerm}' を使用してください）`);
          }
        }
      });
    }

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}

const SECTION_REF_RE = /§([^\s、。,\)）」』】]+)/gu;
const FILE_LINE_REF_RE = /\b[\w./-]+\.\w{1,10}:[0-9]+\b/g;

function extractHeadings(agentsMdPath: string): string[] {
  if (!fs.existsSync(agentsMdPath)) return [];
  const headings: string[] = [];
  for (const line of fs.readFileSync(agentsMdPath, 'utf8').split('\n')) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m) headings.push(m[1].trim().replace(/\s+/g, ''));
  }
  return headings;
}

export async function references(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REFERENCES_USAGE);
      return 0;
    }
    const root = repoRoot();
    const headings = extractHeadings(path.join(root, 'AGENTS.md'));
    const files = walkTextFiles(resolveTargets(args, root));

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(SECTION_REF_RE)) {
          const captured = match[1].replace(/\s+/g, '');
          const resolvable = headings.some((h) => h.startsWith(captured) || captured.startsWith(h));
          if (!resolvable) {
            violations.push(`${file}:${index + 1}: 禁止参照 '§${match[1]}'（見出しテキストで解決できないセクション番号参照）`);
          }
        }
        for (const match of line.matchAll(FILE_LINE_REF_RE)) {
          violations.push(`${file}:${index + 1}: 禁止参照 '${match[0]}'（ファイルパス＋行番号参照）`);
        }
      });
    }

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}

interface AdrFrontmatter {
  id: string;
  status: string;
  supersedes: string[];
  'superseded-by': string | null;
}

function parseAdrFrontmatter(text: string): AdrFrontmatter | undefined {
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

export async function adr(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(ADR_USAGE);
      return 0;
    }
    if (args[0] !== 'check') {
      process.stderr.write(`未知のサブコマンドです: '${args[0] ?? ''}'（'check' のみ対応）\n`);
      return 1;
    }

    const root = repoRoot();
    const adrDir = path.join(root, 'docs', 'adr');
    const files = fs.existsSync(adrDir) ? fs.readdirSync(adrDir).filter((f) => f.endsWith('.md')) : [];
    const byId = new Map<string, AdrFrontmatter>();
    for (const file of files) {
      const fm = parseAdrFrontmatter(fs.readFileSync(path.join(adrDir, file), 'utf8'));
      if (fm) byId.set(fm.id, fm);
    }

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

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}
