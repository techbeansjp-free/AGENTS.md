#!/usr/bin/env bash
# verify-npm-pack.sh — npm 配布 tarball のリーク／必須物検査（CI とローカルの単一正本）。
#
# 目的:
#   `npm pack --dry-run` が生成する配布ファイル一覧を検査し、
#     (1) 禁止パターン（リポ固有物）が tarball に 1 件も含まれないこと、
#     (2) 必須の正本配布物が tarball に含まれること、
#   を assert する。違反があれば終了コード非ゼロで失敗する。
#
# 検証ロジックはこのスクリプト 1 か所のみに置き、CI（.github/workflows/self-enforce.yml）と
# ローカル（開発者）の双方がこれを呼ぶ。CI とローカルでロジックを二重化しないこと。
#
# 使い方:
#   bash .agents/scripts/verify-npm-pack.sh          # リポジトリルートで実行
#
# 前提: npm（>=7、`npm pack --dry-run --json` が使えること）。
#   npm が無い環境では検査をスキップせず明示的に失敗する（CI は npm 前提）。
#
# 参照:
#   docs/maintainer/workflow/20260614_124435_配布とパッケージ構成の再設計/
#     00_要求定義.md（SC-2/SC-3）, 01_要件定義.md（シナリオ5-1）, 03_実装計画.md（2.2 タスク2 (3)）
#   package.json の files フィールド（配布対象の正本）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # .agents/scripts -> repo root

cd "$REPO_ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "エラー: npm が見つかりません。verify-npm-pack には npm が必要です。" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "エラー: node が見つかりません。verify-npm-pack には node が必要です。" >&2
  exit 2
fi

echo "[verify-npm-pack] npm pack --dry-run でファイル一覧を取得します（tarball は生成しません）。"

# `npm pack --dry-run --json` は配布対象ファイル一覧を JSON で stdout に出す。
# 進捗等のノイズは stderr に出るため stdout のみを node に渡す。
# `--ignore-scripts`: pack 検査は「ファイル一覧の取得」だけが目的であり、lifecycle script
#   （prepack 等）のビルド副作用を起こさない。これにより node_modules 無しのクリーン clone
#   （E2E の git archive ツリー）でも tsc 等に依存せず exit 127 にならない（多重防御）。
pack_json="$(npm pack --dry-run --json --ignore-scripts 2>/dev/null)"

# node で JSON を解析し、禁止／必須パターンを判定する（bash の grep よりパスごとの厳密判定が容易）。
PACK_JSON="$pack_json" node <<'NODE'
const raw = process.env.PACK_JSON || "";
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error("エラー: npm pack --dry-run --json の出力を解析できませんでした。");
  console.error(raw.slice(0, 500));
  process.exit(2);
}

const entry = Array.isArray(data) ? data[0] : data;
const files = (entry && entry.files ? entry.files : []).map((f) => f.path);
if (files.length === 0) {
  console.error("エラー: 配布ファイル一覧が空です。package.json の files を確認してください。");
  process.exit(2);
}

// 禁止パターン（リポ固有物。配布物に 1 件も含まれてはならない）。
// - .agents-project/        : 本リポ固有の自己拡張ルール
// - docs/maintainer/        : 保守者向け開発記録
// - workflow.db（*-shm/-wal 含む）: 証跡 DB
// - .adapters/              : 各ツール向け生成物（100% 生成物）
// - .workflow/ 配下の issue : templates 以外の消費者ランタイム生成物
// - src/ / tsconfig.json / *.map / package-lock.json: TS 化の開発専用物（防御的・二重防御）
//   files allowlist で既に除外されるが、誤って files に加わった場合の保険として禁止する
//   （正本: docs/maintainer/workflow/20260615_092309_CLIのTypeScript化/02_設計.md §9.4）
const forbidden = files.filter((p) => {
  if (/(^|\/)\.agents-project(\/|$)/.test(p)) return true;
  if (/(^|\/)docs\/maintainer(\/|$)/.test(p)) return true;
  if (/(^|\/)workflow\.db($|[-.])/.test(p)) return true;
  if (/(^|\/)\.adapters(\/|$)/.test(p)) return true;
  if (/^\.workflow\//.test(p) && !/^\.workflow\/templates\//.test(p)) return true;
  if (/^src\//.test(p)) return true;
  if (p === "tsconfig.json") return true;
  if (p === "package-lock.json") return true;
  if (/\.map$/.test(p)) return true;
  return false;
});

// 必須パターン（正本配布物。tarball に必ず含まれること）。
const required = [
  { label: ".agents/", test: (p) => p === ".agents" || p.startsWith(".agents/") },
  { label: "AGENTS.md", test: (p) => p === "AGENTS.md" },
  { label: "CLAUDE.md", test: (p) => p === "CLAUDE.md" },
  { label: "bin/agents-md.js", test: (p) => p === "bin/agents-md.js" },
  { label: "README.md", test: (p) => p === "README.md" },
  { label: "package.json", test: (p) => p === "package.json" },
  { label: ".workflow/templates/", test: (p) => p.startsWith(".workflow/templates/") },
];
const missing = required.filter((r) => !files.some((p) => r.test(p)));

console.log(`[verify-npm-pack] 配布ファイル数: ${files.length}`);

let failed = false;

if (forbidden.length > 0) {
  failed = true;
  console.error("\n[NG] 禁止パターン（リポ固有物）が配布物に含まれています:");
  forbidden.forEach((p) => console.error("       LEAK: " + p));
} else {
  console.log("[OK] 禁止パターン（.agents-project / docs/maintainer / workflow.db / .adapters / .workflow issue）は含まれていません。");
}

if (missing.length > 0) {
  failed = true;
  console.error("\n[NG] 必須の正本配布物が不足しています:");
  missing.forEach((r) => console.error("       MISSING: " + r.label));
} else {
  console.log("[OK] 必須の正本配布物（.agents/ / AGENTS.md / CLAUDE.md / bin / README / package.json / .workflow/templates/）はすべて含まれています。");
}

if (failed) {
  console.error("\n[verify-npm-pack] 検査に失敗しました。package.json の files フィールドと .npmignore を見直してください。");
  process.exit(1);
}

console.log("\n[verify-npm-pack] 検査に合格しました（リーク無し・必須物あり）。");
NODE
