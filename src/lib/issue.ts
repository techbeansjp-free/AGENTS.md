const ISSUE_ID_RE = /^ISSUE-([0-9]+)$/;
const ADR_ID_RE = /^ADR-([0-9]+)$/;
const AC_ID_RE = /^AC-[0-9]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEGMENTS = ['spec', 'design', 'implementation', 'validation'] as const;
export type Segment = (typeof SEGMENTS)[number];

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function parseIssueId(value: string): { issueId: string; number: string } {
  const match = ISSUE_ID_RE.exec(value);
  if (!match) {
    throw new CliError(`issue_id は ISSUE-<番号> 形式である必要があります: '${value}'`);
  }
  return { issueId: value, number: match[1] };
}

export function parseAdrId(value: string): { adrId: string; number: string } {
  const match = ADR_ID_RE.exec(value);
  if (!match) {
    throw new CliError(`adr_id は ADR-<番号> 形式である必要があります: '${value}'`);
  }
  return { adrId: value, number: match[1] };
}

export function validateAcId(value: string): void {
  if (!AC_ID_RE.test(value)) {
    throw new CliError(`AC-ID は AC-<番号> 形式である必要があります: '${value}'`);
  }
}

export function validateSlug(value: string, maxLength: number): void {
  if (!SLUG_RE.test(value)) {
    throw new CliError(`slug は小文字英数字とハイフンのみ使用できます（先頭・末尾はハイフン不可）: '${value}'`);
  }
  if (value.length > maxLength) {
    throw new CliError(`slug は ${maxLength} 文字以内である必要があります（現在 ${value.length} 文字）: '${value}'`);
  }
}

export function validateType(value: string, allowedTypes: string[]): void {
  if (!allowedTypes.includes(value)) {
    throw new CliError(`type は ${allowedTypes.join('|')} のいずれかである必要があります: '${value}'`);
  }
}

export function validateSegment(value: string): asserts value is Segment {
  if (!(SEGMENTS as readonly string[]).includes(value)) {
    throw new CliError(`segment は ${SEGMENTS.join('|')} のいずれかである必要があります: '${value}'`);
  }
}

export { SEGMENTS };
