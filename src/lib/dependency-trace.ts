import fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Issue #759: 実行中の CLI が読み込む実行時依存モジュールについて、参照経路を全て解決した後の
 * 実体パスを実行中に観測できるようにする。
 *
 * 観測は `ASC_DEPENDENCY_TRACE_FILE` が与えられたときに限り有効で、未設定時は何も出力せず、
 * 解決の順序・結果・失敗時の挙動を変えない。追記に失敗しても本番経路の挙動を変えない。
 * 観測結果は判定の入力にしない（AGENTS.md 不変条件I8: 観測は判定の入力ではない）。
 * 審査対象由来の依存を排除するのは調達段の候補の除外規則であり、本観測点は採否を決めない。
 *
 * 基点（`importerUrl`）には当該依存を実際に読み込むモジュール自身の `import.meta.url` を渡す。
 * 別の基点・別の解決規則で解決し直すと、観測値が本番経路の解決結果と乖離するためである。
 */
export function traceRuntimeDependencyResolution(importerUrl: string, specifiers: readonly string[]): void {
  const traceFile = process.env.ASC_DEPENDENCY_TRACE_FILE;
  if (!traceFile) return;
  let resolveFrom: ReturnType<typeof createRequire>;
  try {
    resolveFrom = createRequire(importerUrl);
  } catch {
    return;
  }
  const lines: string[] = [];
  for (const specifier of specifiers) {
    let resolved: string;
    try {
      resolved = resolveFrom.resolve(specifier);
    } catch {
      lines.push(`${specifier}\tunresolved`);
      continue;
    }
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      real = resolved;
    }
    lines.push(`${specifier}\t${real}`);
  }
  if (lines.length === 0) return;
  try {
    fs.appendFileSync(traceFile, `${lines.join('\n')}\n`);
  } catch {
    // 観測の失敗が本番経路の解決結果を変えないようにする。
  }
}
