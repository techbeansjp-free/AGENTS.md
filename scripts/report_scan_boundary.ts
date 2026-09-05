import fs from "node:fs";
import path from "node:path";

import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { git } from "../src/lib/process.js";
import {
  isIssueStagingPath,
  isStagingLifecyclePath,
} from "../src/domain/staging.js";
import {
  compareScanBoundary,
  observeScanBoundary,
  type ExclusionPredicateSource,
  type ScanBoundaryIncomplete,
} from "../src/domain/scan-boundary.js";

/**
 * 観測を期待する除外述語のID。
 *
 * **供給元とは独立に列挙する。** 供給元から期待一覧を導出すると、供給元の削除で
 * 期待も同時に縮み、述語の欠落を検出できない（Issue #960 round 1、F-02）。
 */
export const EXPECTED_PREDICATE_IDS: readonly string[] = Object.freeze([
  "issue-staging",
  "staging-lifecycle",
  "source-quality-directories",
]);

/**
 * 除外述語の供給元。
 *
 * **`appliesTo`はgate名ではなく適用される検査の範囲である。** 述語はgate全体では
 * なくgate内の一部へ適用される。gate名だけを書くと「gate全体の除外」と読める。
 */
export const EXCLUSION_PREDICATE_SOURCES: readonly ExclusionPredicateSource[] =
  Object.freeze([
    {
      id: "issue-staging",
      owner: "trace:check",
      appliesTo:
        "SCN配置検査の走査範囲のみ。同gateの要件本文検査へは同じMarkdownが届く",
      reasonCode: "issue-staging",
      reason:
        "Issue一時ステージングをSCN配置検査の走査範囲から除く（REQ-SQ-017）",
      excludes: isIssueStagingPath,
    },
    {
      id: "staging-lifecycle",
      owner: "directories:check、package:check",
      appliesTo:
        "`.agent-skill-chain`配下のdirectory案内検査と、`npm pack`が返した配布file集合の混入禁止prefix判定",
      reasonCode: "staging-lifecycle",
      reason: "一時ライフサイクル領域を対象から除く（REQ-SQ-019）",
      excludes: isStagingLifecyclePath,
    },
    {
      id: "source-quality-directories",
      owner: "source:check",
      appliesTo: "実装言語集約検査のdirectory再帰",
      reasonCode: "predicate-unavailable",
      reason:
        "除外directory集合が`scripts/check_source_quality.ts`の非公開定数であり、moduleとして参照できません",
      excludes: undefined,
    },
  ]);

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
};

/**
 * NUL区切りのGit出力を分ける。
 *
 * **行区切りと`trim()`を使わない。** 空白・改行を含む正当なfilenameが変形または
 * 欠落する（Issue #960 round 1、F-05）。
 */
function nulSeparated(value: string): string[] {
  return value.split("\0").filter((entry) => entry !== "");
}

const EXPANSION_FILE_LIMIT_PER_ENTRY = 2000;

/**
 * ignored entryを、検査が実際に見るfileへ展開する。
 *
 * **`git status --ignored`はdirectory単位へ畳む。** 畳んだままでは、深いprefixを
 * 要求する述語について「除外0件」と誤って報告する。
 *
 * **展開中に消えたentryを黙って落とさない。** 落とすと、覆われていないのではなく
 * 見ていないだけの状態を「差なし」の根拠にできてしまう（F-05）。
 */
function expandIgnoredEntries(
  root: string,
  entries: readonly string[],
): {
  readonly paths: string[];
  readonly incomplete: ScanBoundaryIncomplete[];
} {
  const paths: string[] = [];
  const incomplete: ScanBoundaryIncomplete[] = [];
  for (const entry of entries) {
    let taken = 0;
    let overflow = false;
    const walk = (relative: string): void => {
      if (overflow) return;
      if (taken >= EXPANSION_FILE_LIMIT_PER_ENTRY) {
        overflow = true;
        return;
      }
      const absolute = path.join(root, relative);
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
      if (stat === undefined) {
        incomplete.push({
          code: "scan-failed",
          predicate: undefined,
          path: relative,
          detail: "Git観測後に消えたため展開できませんでした",
        });
        return;
      }
      if (stat.isSymbolicLink()) {
        incomplete.push({
          code: "scan-failed",
          predicate: undefined,
          path: relative,
          detail: "symlinkは辿らず、指す先を観測できません",
        });
        return;
      }
      if (!stat.isDirectory()) {
        paths.push(relative);
        taken += 1;
        return;
      }
      for (const child of fs.readdirSync(absolute, { withFileTypes: true }))
        walk(`${relative}/${child.name}`);
    };
    walk(entry);
    if (overflow)
      incomplete.push({
        code: "scan-failed",
        predicate: undefined,
        path: entry,
        detail: `1領域あたり${EXPANSION_FILE_LIMIT_PER_ENTRY}件の上限に達したため展開を打ち切りました`,
      });
  }
  return { paths, incomplete };
}

export function reportScanBoundary(root = process.cwd()) {
  let tracked: string[];
  let ignoredEntries: string[];
  try {
    tracked = nulSeparated(
      git(["ls-files", "-z"], root, { env: GIT_ENV }).stdout,
    );
    ignoredEntries = nulSeparated(
      git(["status", "--porcelain=v1", "-z", "--ignored=matching"], root, {
        env: GIT_ENV,
      }).stdout,
    )
      .filter((entry) => entry.startsWith("!! "))
      .map((entry) => entry.slice(3).replace(/\/$/u, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      expectedPredicates: EXPECTED_PREDICATE_IDS,
      incomplete: [
        {
          code: "scan-failed" as const,
          predicate: undefined,
          path: undefined,
          detail: `Git観測に失敗しました: ${detail}`,
        },
      ],
      baseline: undefined,
      contaminated: undefined,
      comparison: undefined,
    };
  }
  const expanded = expandIgnoredEntries(root, ignoredEntries);
  const observe = (paths: readonly string[]) =>
    observeScanBoundary({
      predicates: EXPECTED_PREDICATE_IDS,
      paths,
      sources: EXCLUSION_PREDICATE_SOURCES,
    });
  const baseline = observe(tracked);
  const contaminated = observe([...tracked, ...expanded.paths]);
  const comparison = compareScanBoundary(baseline, contaminated);
  const incomplete = [...contaminated.incomplete, ...expanded.incomplete];
  const describe = (observation: ReturnType<typeof observe>) => ({
    observedPaths: observation.observedPaths.length,
    uncovered: observation.uncovered,
    predicates: observation.predicates.map((entry) => ({
      predicate: entry.predicate,
      owner: entry.owner,
      appliesTo: entry.appliesTo,
      excludedCount: entry.excludedCount,
      excluded: entry.excluded,
    })),
  });
  return {
    /**
     * **成功を既定にしない。** 観測が不完全なら、差分が0でも合格にしない。
     * 不完全な観測を「差は無かった」の根拠にすると、見ていない述語を
     * 見たことにしてしまう。
     */
    valid: incomplete.length === 0 && comparison.comparable,
    expectedPredicates: EXPECTED_PREDICATE_IDS,
    incomplete,
    baseline: describe(baseline),
    contaminated: {
      ...describe(contaminated),
      ignoredEntries: ignoredEntries.length,
      ignoredFiles: expanded.paths.length,
    },
    comparison,
  };
}

if (isExecutionEntry(import.meta.url)) {
  /**
   * **観測対象のrootを引数で受け取れるようにする。** 受け取れないと、
   * 別rootに対する終了値の振る舞いをtestから観測できない。
   */
  const result = reportScanBoundary(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
