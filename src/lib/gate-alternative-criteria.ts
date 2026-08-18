import { gh } from './exec.js';
import { stateFilePath, type CoordinationBackend } from './local-state.js';
import { SYNC_BEGIN_MARKER, SYNC_END_MARKER } from './issue-sync.js';
import { tryReadYamlFile } from './yaml-io.js';

const CRITERIA_SECTION_LABELS = new Set([
  '課題・目的', '課題', '目的', '背景・目的', '目的・背景', '要求', '要件', '要求・要件',
  '期待する挙動', '期待される挙動', '期待動作', '期待結果', '受入基準', '受入条件', '完了条件',
  'problem', 'purpose', 'goal', 'objective', 'requirement', 'requirements',
  'expected behavior', 'expected behaviour', 'acceptance criteria', 'definition of done',
]);

const PLACEHOLDER_LINES = new Set([
  '無し', 'なし', '特になし', '未定', '不明', 'tbd', 'n/a', 'none', '後日追記',
]);

function markerLine(line: string): boolean {
  return line === SYNC_BEGIN_MARKER || line === SYNC_END_MARKER;
}

/** Issue 本文から一方向転記区間を安全側に除去する純関数。 */
export function removeIssueSyncTranscript(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const firstBegin = lines.findIndex((line) => line === SYNC_BEGIN_MARKER);
  let lastEnd = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index] === SYNC_END_MARKER) {
      lastEnd = index;
      break;
    }
  }
  let retained: string[];
  if (firstBegin !== -1 && lastEnd > firstBegin) retained = [...lines.slice(0, firstBegin), ...lines.slice(lastEnd + 1)];
  else if (firstBegin !== -1) retained = lines.slice(0, firstBegin);
  else if (lastEnd !== -1) retained = lines.slice(lastEnd + 1);
  else retained = lines;
  return retained.filter((line) => !markerLine(line)).join('\n');
}

function asciiWidth(text: string): string {
  return [...text].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x3000) return ' ';
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCodePoint(code - 0xfee0);
    return character;
  }).join('');
}

function normalizeHeading(text: string): string {
  return asciiWidth(text)
    .replace(/[\*_`]/g, '')
    .trim()
    .replace(/[：:]\s*$/, '')
    .trim()
    .toLowerCase();
}

function normalizePlaceholder(text: string): string | undefined {
  const lines = text.split('\n');
  if (lines.length !== 1) return undefined;
  let normalized = lines[0].trim();
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/^(?:[-*+]|[0-9]+[.)])\s+/, '').trim();
  } while (normalized !== previous);
  return normalized.toLowerCase().replace(/[。．.、，,；;：:！？!?]+$/u, '').trim();
}

function ignorableBlock(block: string): boolean {
  const trimmed = block.trim();
  if (!trimmed) return true;
  const withoutComments = trimmed.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  return withoutComments.split('\n').every((line) => {
    const normalized = line.trim();
    if (!normalized) return true;
    if (/^ {0,3}#{1,6}\s+.+?\s*$/.test(line)) return true;
    if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(normalized)) return true;
    const placeholder = normalizePlaceholder(normalized);
    return placeholder !== undefined && PLACEHOLDER_LINES.has(placeholder);
  });
}

interface Heading {
  index: number;
  level: number;
  text: string;
}

/** Markdown の囲み区間内を除外し、実際の ATX 見出しだけを返す。 */
function headingsOutsideEnclosures(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;
  let htmlComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.marker === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = undefined;
      continue;
    }
    if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
      continue;
    }

    const fenceOpen = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const commentStart = line.indexOf('<!--');
    if (fenceOpen && (commentStart === -1 || (fenceOpen.index ?? 0) <= commentStart)) {
      fence = { marker: fenceOpen[1][0] as '`' | '~', length: fenceOpen[1].length };
      continue;
    }
    if (commentStart !== -1) {
      if (line.indexOf('-->', commentStart + 4) === -1) htmlComment = true;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) headings.push({ index, level: heading[1].length, text: heading[2] });
  }
  return headings;
}

function criteriaBlocks(body: string): string[] {
  const lines = removeIssueSyncTranscript(body).replace(/\r\n/g, '\n').split('\n');
  const headings = headingsOutsideEnclosures(lines);
  const blocks: string[] = [];

  for (let position = 0; position < headings.length; position += 1) {
    const heading = headings[position];
    if (!CRITERIA_SECTION_LABELS.has(normalizeHeading(heading.text))) continue;
    let end = lines.length;
    for (let next = position + 1; next < headings.length; next += 1) {
      if (headings[next].level <= heading.level) {
        end = headings[next].index;
        break;
      }
    }
    blocks.push(
      ...lines.slice(heading.index + 1, end)
        .join('\n')
        .split(/\n[ \\t]*\n+/)
        .map((block) => block.trim())
        .filter((block) => !ignorableBlock(block)),
    );
  }
  return blocks;
}

/** 要求記述節に残ったブロックだけを代替判定基準として採用する。 */
export function extractAlternativeCriteria(body: string): string | undefined {
  const blocks = criteriaBlocks(body);
  return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}

export function readAlternativeCriteria(
  root: string,
  issueNumber: string,
  backend: CoordinationBackend,
): string | undefined {
  if (backend === 'github') {
    const result = gh(['issue', 'view', issueNumber, '--json', 'body'], root);
    if (result.status !== 0) return undefined;
    try {
      const parsed = JSON.parse(result.stdout) as { body?: unknown };
      return typeof parsed.body === 'string' ? extractAlternativeCriteria(parsed.body) : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const state = tryReadYamlFile<{ request?: unknown }>(stateFilePath(root, issueNumber));
    return typeof state?.request === 'string' ? extractAlternativeCriteria(state.request) : undefined;
  } catch {
    return undefined;
  }
}
