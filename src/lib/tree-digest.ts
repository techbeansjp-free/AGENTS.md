import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 正準ツリー digest のドメイン分離 prefix。他の digest 空間（成果物内容・launcher 構成）と
 * 同一のハッシュ空間を共有しないようにする（Issue #309 と同じ理由）。
 */
const CANONICAL_TREE_DOMAIN = 'agent-skill-chain:canonical-tree:v1\n';

/**
 * 走査根の直下で走査対象から除外するエントリ名。
 *
 * Issue #759: 「`node_modules/` 配下」という文言は `node_modules` エントリ自体が対象範囲に
 * 含まれるかを一意に決めない。ここでは**エントリ自体も除外する**と確定する。調達段は複製先
 * パッケージ root 直下へ依存ディレクトリを指す symbolic link を置くため、エントリ自体を
 * 走査対象に残すと「対象範囲内の symbolic link」として算出が常に中止され、調達が成立しない。
 * 除外はいずれも走査根からの相対パスの第1要素にのみ適用し、より深い階層の同名ディレクトリは
 * 走査対象に残す（除外範囲を必要最小限に保つ）。
 */
export const CANONICAL_TREE_EXCLUDED_ROOT_ENTRIES = ['node_modules', '.git'] as const;

/** 正準ツリー digest を算出できない状態（symbolic link・通常ファイル以外の混入等）。 */
export class CanonicalTreeDigestError extends Error {}

function sha256Hex(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

interface TreeEntryLine {
  relative: string;
  line: string;
}

function collect(current: string, prefix: string, entriesOut: TreeEntryLine[]): void {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (prefix === '' && (CANONICAL_TREE_EXCLUDED_ROOT_ENTRIES as readonly string[]).includes(entry.name)) {
      continue;
    }
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new CanonicalTreeDigestError(
        `正準ツリーdigestの対象範囲にsymbolic linkがあるため算出を中止しました: ${relative}`,
      );
    }
    if (entry.isDirectory()) {
      collect(absolute, relative, entriesOut);
      continue;
    }
    if (!entry.isFile()) {
      throw new CanonicalTreeDigestError(
        `正準ツリーdigestの対象範囲に通常ファイル以外のエントリがあるため算出を中止しました: ${relative}`,
      );
    }
    const stat = fs.lstatSync(absolute);
    const executable = (stat.mode & 0o111) !== 0 ? '1' : '0';
    entriesOut.push({
      relative,
      line: `${executable}\t${sha256Hex(fs.readFileSync(absolute))}\t${JSON.stringify(relative)}`,
    });
  }
}

/**
 * パッケージ root 配下のファイル集合から、時刻・所有者・配置場所に依存しない単一の digest を返す。
 *
 * 各対象ファイルを「実行ビットの有無・内容のSHA-256・走査根からの相対パス」の1行へ落とし、
 * 相対パスのバイト昇順で連結した文字列のSHA-256を値とする。走査根からの相対で
 * `node_modules`・`.git`（エントリ自体を含む）は対象から除く。対象範囲内に symbolic link
 * または通常ファイル以外のエントリを見つけた場合は算出せず {@link CanonicalTreeDigestError}
 * を投げる（リンク先の差し替えで実効内容が変わりうるため安全側へ倒す）。
 */
export function canonicalTreeDigest(root: string): string {
  const collected: TreeEntryLine[] = [];
  collect(root, '', collected);
  collected.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relative, 'utf8'), Buffer.from(right.relative, 'utf8')),
  );
  const lines = collected.map((entry) => entry.line);
  const payload = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  return `sha256:${sha256Hex(Buffer.from(CANONICAL_TREE_DOMAIN + payload, 'utf8'))}`;
}
