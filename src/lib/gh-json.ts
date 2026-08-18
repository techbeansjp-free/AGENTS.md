/**
 * gh の一覧応答（`gh api --paginate`）標準出力を要素列へ変換する共有パーサ。
 *
 * Issue #774: 全ページ取得に使っていたページ一括オプションは gh 2.63.0 で追加されたものであり、
 * それより古い gh は未知フラグとして非 0 終了で拒否する。当該オプションを外すと標準出力の形が
 * 取得先ごとに変わるため、3 つの出力形を単一モジュールで受理する。
 *
 * - 出力形 (i): 単一の JSON 文書（配列応答へ `--paginate` のみを与えた場合）
 * - 出力形 (ii): 空白区切りで連結された複数の JSON 文書（オブジェクト応答へ `--paginate` のみを与えた場合）
 * - 出力形 (iii): 各ページを要素とする配列（ページ一括オプションが返す形）
 *
 * 既定値へのフォールバックは一切持たない。解釈できない入力を空の一覧へ倒すと、取得失敗が
 * 「要素 0 件」と外形上区別できなくなり、本モジュールが除去しようとしている無言の劣化そのものになる。
 */

/** gh 標準出力を一覧として解釈できなかったことを表す専用の例外。 */
export class GhJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhJsonParseError';
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 連結された複数文書の境界を文字列走査で求める。
 * レビュー本文には `{`・`}`・`[`・`]` を含む文字列が現れるため、改行・空白による分割では成立しない。
 * 文字列リテラルとエスケープを認識し、括弧の深さが 0 へ戻る位置を文書の終端とする。
 */
function scanDocumentSlices(stdout: string): string[] {
  const slices: string[] = [];
  let index = 0;
  while (index < stdout.length) {
    while (index < stdout.length && /\s/.test(stdout[index])) index += 1;
    if (index >= stdout.length) break;
    const opener = stdout[index];
    if (opener !== '{' && opener !== '[') {
      throw new GhJsonParseError('gh 標準出力に JSON オブジェクト・配列以外の断片が含まれています');
    }
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;
    for (; index < stdout.length; index += 1) {
      const char = stdout[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) {
          slices.push(stdout.slice(start, index + 1));
          index += 1;
          closed = true;
          break;
        }
        if (depth < 0) throw new GhJsonParseError('gh 標準出力の JSON 文書の括弧が対応していません');
      }
    }
    if (!closed) throw new GhJsonParseError('gh 標準出力の JSON 文書が閉じていません');
  }
  return slices;
}

/**
 * gh 標準出力を JSON 文書の列へ分割する。単一文書として解釈できる入力はその結果をそのまま用い、
 * 解釈できない場合にのみ文字列走査で文書境界を求める。
 * JSON 文書が 1 つも存在しない入力（0 バイト・空白のみ）は解釈失敗とする。
 * gh は要素 0 件の一覧に対しても必ず 1 つの JSON 文書を出力するため、空出力は
 * 「一覧が空である」という証拠を何も持たない。
 */
export function splitGhJsonDocuments(stdout: string): unknown[] {
  if (stdout.trim().length === 0) {
    throw new GhJsonParseError('gh 標準出力に JSON 文書が含まれていません（空または空白のみ）');
  }
  try {
    return [JSON.parse(stdout) as unknown];
  } catch {
    // 単一文書として解釈できない場合のみ、連結された複数文書として走査する。
  }
  const documents = scanDocumentSlices(stdout).map((slice) => {
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      throw new GhJsonParseError('gh 標準出力の JSON 文書を解釈できません');
    }
  });
  if (documents.length === 0) {
    throw new GhJsonParseError('gh 標準出力に JSON 文書が含まれていません（空または空白のみ）');
  }
  return documents;
}

/**
 * 配列応答の 1 文書をページ列へ分解する。
 * GitHub の一覧 API 要素は常に JSON オブジェクトであり配列にならないため、
 * 「全要素が配列であること」を出力形 (iii)（ページ配列）の判別条件とし、
 * 配列要素を 1 つも含まない文書は出力形 (i)（平坦な要素配列）として 1 ページとみなす。
 * 空配列はどちらの読みでも要素 0 件になるため、空のページ 1 個として扱う。
 * 配列と非配列が混在する文書はどちらの出力形とも決定できないため解釈失敗とする
 * （一方の読みを黙って採ると要素の取りこぼし・混入が無言で起きる）。
 */
function arrayDocumentPages(document: unknown[]): unknown[][] {
  const arrayElements = document.filter((element) => Array.isArray(element)).length;
  if (arrayElements === 0) return [document];
  if (arrayElements === document.length) return document as unknown[][];
  throw new GhJsonParseError(
    '配列応答に配列要素と非配列要素が混在しており、ページ配列か要素配列かを判別できません',
  );
}

/** 配列応答（トップレベルが JSON 配列である一覧応答）の全ページ要素を返す。 */
export function parseGhArrayResponse<T>(stdout: string): T[] {
  return splitGhJsonDocuments(stdout).flatMap((document) => {
    if (!Array.isArray(document)) {
      throw new GhJsonParseError('配列応答の JSON 文書が配列ではありません');
    }
    return arrayDocumentPages(document).flat() as T[];
  });
}

/**
 * オブジェクト応答（要素配列を属性として持つ一覧応答）の全ページ要素を返す。
 * 各文書が配列であればその各要素をページとみなし、配列でなければ当該文書自体を 1 ページとみなす。
 * ページに当該属性が無い、または配列でない場合はそのページの寄与を 0 件とする（現行挙動の保持）。
 */
export function parseGhObjectResponse<T>(stdout: string, key: string): T[] {
  return splitGhJsonDocuments(stdout).flatMap((document) => {
    const pages = Array.isArray(document) ? document : [document];
    return pages.flatMap((page) => {
      if (!isJsonObject(page)) {
        throw new GhJsonParseError('オブジェクト応答のページが JSON オブジェクトではありません');
      }
      const value = page[key];
      return Array.isArray(value) ? (value as T[]) : [];
    });
  });
}
