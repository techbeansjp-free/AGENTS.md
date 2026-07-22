import fs from 'node:fs';

export interface ForbiddenTerm {
  banned: string;
  correctTerm: string;
}

/**
 * docs/GLOSSARY.md（用語・定義・禁止同義語の3列）を解析する。
 * 括弧書きの注釈（例:「`orchestrator`（英語表記のみでの言い換え）」）は注釈を取り除いた
 * 素の語のみを機械検査対象とする。他の用語（用語列）と完全一致する禁止語（例:「Task」の
 * 禁止同義語「Issue」）は、その語自体が正当な用途を持つため機械的にgrepできず対象外とする。
 */
export function parseForbiddenTerms(glossaryPath: string): ForbiddenTerm[] {
  const text = fs.readFileSync(glossaryPath, 'utf8');
  const rows: { term: string; forbiddenRaw: string }[] = [];
  for (const line of text.split('\n')) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.length !== 3) continue;
    if (cells[0] === '用語') continue;
    if (/^-{2,}$/.test(cells[0])) continue;
    rows.push({ term: stripBackticks(cells[0]), forbiddenRaw: cells[2] });
  }

  const knownTerms = new Set(rows.map((r) => r.term));
  const forbidden: ForbiddenTerm[] = [];
  for (const row of rows) {
    if (!row.forbiddenRaw) continue;
    for (const candidateRaw of row.forbiddenRaw.split('、')) {
      const candidate = stripAnnotation(stripBackticks(candidateRaw.trim()));
      if (!candidate) continue;
      if (knownTerms.has(candidate)) continue; // 単独では非機械的（他語の正当用途と衝突）
      forbidden.push({ banned: candidate, correctTerm: row.term });
    }
  }
  return forbidden;
}

function stripBackticks(value: string): string {
  const m = /^`(.+)`$/.exec(value.trim());
  return m ? m[1] : value.trim();
}

function stripAnnotation(value: string): string {
  return value.replace(/[（(][^）)]*[）)]$/, '').trim();
}
