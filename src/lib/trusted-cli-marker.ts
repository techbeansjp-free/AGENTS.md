import fs from 'node:fs';
import path from 'node:path';
import { ASSET_NAMESPACE, packageRoot } from './paths.js';
import { canonicalTreeDigest, CanonicalTreeDigestError } from './tree-digest.js';

const TRUSTED_CLI_MARKER_FILE_NAME = '.trusted-cli.json';

/** 信頼CLI導入マーカーのスキーマ識別子。 */
export const TRUSTED_CLI_MARKER_SCHEMA = 'agent-skill-chain/trusted-cli/v1';

export interface TrustedCliMarker {
  schema_version: typeof TRUSTED_CLI_MARKER_SCHEMA;
  package: string;
  version: string;
  tree_digest: string;
}

/**
 * `.agent-skill-chain/.trusted-cli.json` の root からの相対パス。
 *
 * Issue #759: 配布集合（`ROOT_LEVEL_ENTRIES`・`NAMESPACED_ENTRIES`）の外に置く。期待値は
 * 「その consumer が導入時に実際に用いた配布パッケージ」の内容 digest であり consumer ごとに
 * 異なるため、全 consumer へ同一内容が配られる配布集合には属せない。配布集合の外にあることで
 * launcher digest の算出対象へ含めてはならないことも一意に定まる。
 */
export function trustedCliMarkerRelativePath(): string {
  return path.join(ASSET_NAMESPACE, TRUSTED_CLI_MARKER_FILE_NAME);
}

/** `.agent-skill-chain/.trusted-cli.json` の絶対パス。 */
export function trustedCliMarkerPath(root: string): string {
  return path.join(root, trustedCliMarkerRelativePath());
}

/** 実行中のパッケージ root から、導入マーカーへ書き込む期待値を組み立てる。 */
export function buildTrustedCliMarker(sourceRoot: string = packageRoot()): TrustedCliMarker {
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
  };
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    throw new Error(`パッケージ名を読めないため信頼CLI導入マーカーを生成できません: ${sourceRoot}`);
  }
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`パッケージversionを読めないため信頼CLI導入マーカーを生成できません: ${sourceRoot}`);
  }
  return {
    schema_version: TRUSTED_CLI_MARKER_SCHEMA,
    package: pkg.name,
    version: pkg.version,
    tree_digest: canonicalTreeDigest(sourceRoot),
  };
}

/** 与えられた値が導入マーカーの形式を満たすかを判定する。 */
export function isTrustedCliMarker(value: unknown): value is TrustedCliMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Partial<TrustedCliMarker>;
  return (
    marker.schema_version === TRUSTED_CLI_MARKER_SCHEMA &&
    typeof marker.package === 'string' &&
    marker.package.length > 0 &&
    typeof marker.version === 'string' &&
    marker.version.length > 0 &&
    typeof marker.tree_digest === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(marker.tree_digest)
  );
}

export interface TrustedCliMarkerOutcome {
  action: 'written' | 'planned' | 'skipped';
  marker?: TrustedCliMarker;
  reason?: string;
}

/**
 * 導入・更新時に導入マーカーを反映する（`--dry-run` では書かない）。
 *
 * 期待値を算出できない実行元（対象範囲に symbolic link を含むパッケージ root。開発リポジトリを
 * そのまま実行元にした場合の linked worktree 配下などが該当する）では、値を書かずに理由を返す。
 * マーカーが無い状態でローカルゲートを実行すると準備段が調達へ進まず停止するため、この skip は
 * 検証を緩めない（不成立側へ倒れる）。既存のマーカーは残し、古い値で上書きしない。
 */
export function applyTrustedCliMarker(
  root: string,
  options: { dryRun: boolean; sourceRoot?: string } = { dryRun: false },
): TrustedCliMarkerOutcome {
  const sourceRoot = options.sourceRoot ?? packageRoot();
  let marker: TrustedCliMarker;
  try {
    marker = buildTrustedCliMarker(sourceRoot);
  } catch (error) {
    if (!(error instanceof CanonicalTreeDigestError)) throw error;
    return { action: 'skipped', reason: error.message };
  }
  if (options.dryRun) return { action: 'planned', marker };
  const filePath = trustedCliMarkerPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(marker, null, 2)}\n`);
  return { action: 'written', marker };
}

/** 導入マーカーの反映結果を、`init`/`upgrade` の実行結果要約の1行へ整形する。 */
export function formatTrustedCliMarkerOutcome(outcome: TrustedCliMarkerOutcome, prefix: string): string {
  if (outcome.action === 'skipped') {
    return (
      `skipped: ${trustedCliMarkerRelativePath()}（実行元パッケージから期待値を算出できないため書き込みませんでした: ${outcome.reason}）。` +
      'この状態ではローカルゲートの準備段が信頼実行コードを調達せず停止します。'
    );
  }
  return `${prefix}trusted_cli: ${trustedCliMarkerRelativePath()} (${outcome.marker?.tree_digest})`;
}
