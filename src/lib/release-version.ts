/**
 * リリース版数解決ロジック（DESIGN.md「バージョン解決器」の実装。Issue #196、ADR-0005）。
 *
 * 副作用を一切持たない純粋関数のみで構成する。既存タグ一覧と package.json の version から
 * 次リリース版数（target）・package.json 書換えの要否（needCommit）を決定する責務のみを負い、
 * ファイル読み書き・git/gh コマンド実行は呼び出し側（commands/release.ts）が担う。
 *
 * 版数体系は package.json の semver を唯一の正本とする（ADR-0005）。gitタグは `v<semver>`、
 * GitHub Release の tag/name も同一文字列とする。旧日時形式タグ（例: `v20260720.060726`）は
 * SEMVER_TAG_RE に一致しないため、後退禁止判定の比較対象から機械的に除外される。
 */

export interface VersionResolution {
  /** 比較の基準となった直前の版数（既存タグ最大値、または初回runのseed=pkgVersion）。 */
  latest: string;
  /** 次リリースの版数。 */
  target: string;
  /** true の場合、package.json の version を target へ書き換えるcommitが必要。 */
  needCommit: boolean;
}

/** `v<major>.<minor>.<patch>` 形式のgitタグにのみ一致する（旧日時形式タグ等を除外する）。 */
export const SEMVER_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `<major>.<minor>.<patch>` 形式（'v'接頭辞なし）の版数文字列そのものに一致する。 */
export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** bumpブランチ名 `release/bump-v<target>` の形式検査（admin merge直前のスコープ検査で使用）。 */
export const RELEASE_BUMP_BRANCH_RE = /^release\/bump-v[0-9]+\.[0-9]+\.[0-9]+$/;

type SemverTuple = readonly [number, number, number];

function parseSemver(value: string): SemverTuple {
  const match = SEMVER_RE.exec(value);
  if (!match) {
    throw new Error(`semver形式（<major>.<minor>.<patch>）ではありません: '${value}'`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 数値タプルとして比較する（文字列比較では `0.2.9` > `0.2.10` のような誤判定が起きるため）。 */
function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function patchIncrement(value: string): string {
  const [major, minor, patch] = parseSemver(value);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * 既存タグ一覧のうち SEMVER_TAG_RE に一致するものだけを対象に、'v'を除いた版数文字列で
 * 最大のものを返す。一致タグが1件も無ければ undefined（呼び出し側がseed規則を適用する）。
 */
export function latestSemverTag(tags: string[]): string | undefined {
  const matched = tags.filter((t) => SEMVER_TAG_RE.test(t)).map((t) => t.slice(1));
  if (matched.length === 0) return undefined;
  return matched.reduce((max, current) => (compareSemver(current, max) > 0 ? current : max));
}

/**
 * DESIGN.md「バージョン解決器」のアルゴリズムそのもの。
 *
 * ```text
 * latest := SEMVER_TAG_RE に一致する既存タグの最大版数（無ければ seed := pkgVersion）
 * if semver(pkgVersion) > semver(latest):
 *     target := pkgVersion         # 人手が先行bump済み → 尊重（needCommit=false）
 * else:
 *     target := patchIncrement(latest)   # 既定: 自動でpatch加算（needCommit=true）
 * assert semver(target) > semver(latest) # 後退禁止ガード（AC-5）。不成立なら例外を投げる
 * ```
 */
export function resolveVersion(tags: string[], pkgVersion: string): VersionResolution {
  parseSemver(pkgVersion); // 不正な形式はここで例外にする
  const latest = latestSemverTag(tags) ?? pkgVersion;

  let target: string;
  let needCommit: boolean;
  if (compareSemver(pkgVersion, latest) > 0) {
    target = pkgVersion;
    needCommit = false;
  } else {
    target = patchIncrement(latest);
    needCommit = true;
  }

  if (compareSemver(target, latest) <= 0) {
    throw new Error(`版数後退禁止ガードに抵触しました: target=${target} が latest=${latest} 以下です（AC-5）`);
  }

  return { latest, target, needCommit };
}
