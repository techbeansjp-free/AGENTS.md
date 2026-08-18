import { gh } from './exec.js';
import { stateFilePath, type CoordinationBackend } from './local-state.js';
import { SYNC_BEGIN_MARKER, SYNC_END_MARKER } from './issue-sync.js';
import { tryReadYamlFile } from './yaml-io.js';

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

function ignorableBlock(block: string): boolean {
  const trimmed = block.trim();
  if (!trimmed) return true;
  if (/^(?:<!--[^]*?-->\s*)+$/.test(trimmed)) return true;
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(trimmed);
}

/** 空行区切りの意味ある本文ブロックだけを代替判定基準として採用する。 */
export function extractAlternativeCriteria(body: string): string | undefined {
  const blocks = removeIssueSyncTranscript(body)
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => !ignorableBlock(block));
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
  const state = tryReadYamlFile<{ request?: unknown }>(stateFilePath(root, issueNumber));
  return typeof state?.request === 'string' ? extractAlternativeCriteria(state.request) : undefined;
}
