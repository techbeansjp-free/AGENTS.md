export interface SpecAcDeclaration {
  id: string;
  summary: string;
}

/** 第4レベル見出し・AC-ID・直後のコロンから成る正規の受入条件宣言を解析する。 */
export function parseSpecAcDeclarationHeading(line: string): SpecAcDeclaration | undefined {
  const match = /^####\s+(AC-[0-9]+):(.*)$/.exec(line);
  if (!match) return undefined;
  return { id: match[1], summary: match[2] };
}

/** SPEC.md の正規の受入条件宣言だけから、重複のない AC-ID を数値昇順で抽出する。 */
export function extractSpecAcIds(specText: string): string[] {
  const ids = new Set<string>();
  for (const line of specText.split(/\r?\n/)) {
    const declaration = parseSpecAcDeclarationHeading(line);
    if (declaration) ids.add(declaration.id);
  }
  return [...ids].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}
