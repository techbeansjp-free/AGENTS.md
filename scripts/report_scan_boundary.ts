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
  type GateExclusionSource,
} from "../src/domain/scan-boundary.js";

/**
 * 観測対象のgateをnpm script keyで明示する。
 *
 * **composite scriptを含めない。** `quality`や`verify:distribution`はleafの合成であり、
 * 走査境界を自分では持たない。含めると同じ境界を二重に数える。
 *
 * `excludes`が`undefined`のgateは、除外集合をmoduleとして公開していないため
 * 観測できない。**成功へ倒さず不完全として非0で終了する。**
 */
const GATE_EXCLUSION_SOURCES: readonly GateExclusionSource[] = Object.freeze([
  {
    gate: "trace:check",
    reason:
      "Issue一時ステージングをSCN配置検査の走査範囲から除く（REQ-SQ-017）",
    excludes: isIssueStagingPath,
  },
  {
    gate: "directories:check",
    reason: "一時ライフサイクル領域を配下の再帰から除く（REQ-SQ-019）",
    excludes: isStagingLifecyclePath,
  },
  {
    gate: "package:check",
    reason: "一時ライフサイクル領域をpackage混入禁止prefixとして扱う",
    excludes: isStagingLifecyclePath,
  },
  {
    gate: "source:check",
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
 * ignored entryをgateが実際に見るfileへ展開する。
 *
 * **`git status --ignored`はdirectory単位へ畳む。** `.agent-skill-chain/tmp`のように
 * directoryごと無視される領域は1行で返るが、gateはfilesystemを歩くため配下のfileを見る。
 * 畳んだままの観測は、除外述語が深いprefixを要求する場合に「除外0件」と誤って報告する。
 *
 * 走査量の上限を置き、超えたら不完全として扱う。無制限に歩くと報告が観測ではなく負荷になる。
 */
const EXPANSION_FILE_LIMIT_PER_ENTRY = 2000;

function expandIgnoredEntries(
  root: string,
  entries: readonly string[],
): {
  readonly paths: string[];
  readonly truncated: readonly string[];
} {
  const paths: string[] = [];
  const truncated: string[] = [];
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
      if (stat === undefined || stat.isSymbolicLink()) return;
      if (!stat.isDirectory()) {
        paths.push(relative);
        taken += 1;
        return;
      }
      for (const child of fs.readdirSync(absolute, { withFileTypes: true }))
        walk(`${relative}/${child.name}`);
    };
    walk(entry);
    if (overflow) truncated.push(entry);
  }
  return { paths, truncated };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function reportScanBoundary(root = process.cwd()) {
  const gates = GATE_EXCLUSION_SOURCES.map((source) => source.gate);
  let tracked: string[];
  let ignored: string[];
  let truncatedEntries: readonly string[];
  try {
    tracked = lines(git(["ls-files"], root, { env: GIT_ENV }).stdout);
    ignored = lines(
      git(["status", "--porcelain", "--ignored=matching"], root, {
        env: GIT_ENV,
      }).stdout,
    )
      .filter((line) => line.startsWith("!! "))
      .map((line) => line.slice(3).replace(/\/$/u, ""));
    const expanded = expandIgnoredEntries(root, ignored);
    truncatedEntries = expanded.truncated;
    ignored = expanded.paths;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      gates,
      incomplete: [
        {
          code: "scan-failed",
          gate: undefined,
          path: undefined,
          detail: `Git観測に失敗しました: ${detail}`,
        },
      ],
      baseline: undefined,
      contaminated: undefined,
      comparison: undefined,
    };
  }
  const baseline = observeScanBoundary({
    gates,
    paths: tracked,
    sources: GATE_EXCLUSION_SOURCES,
  });
  const contaminated = observeScanBoundary({
    gates,
    paths: [...tracked, ...ignored],
    sources: GATE_EXCLUSION_SOURCES,
  });
  const comparison = compareScanBoundary(baseline, contaminated);
  /**
   * **打ち切った領域は不完全として数える。** 上限に達した領域を黙って落とすと、
   * 「差は無かった」ではなく「見ていない」を合格として報告することになる。
   */
  const incomplete = [
    ...contaminated.incomplete,
    ...truncatedEntries.map((entry) => ({
      code: "scan-failed" as const,
      gate: undefined,
      path: entry,
      detail: `1領域あたり${EXPANSION_FILE_LIMIT_PER_ENTRY}件の上限に達したため展開を打ち切りました`,
    })),
  ];
  return {
    /**
     * **成功を既定にしない。** 観測が不完全なら、差分が0でも合格にしない。
     * 不完全な観測を「差は無かった」の根拠にすると、見えていないgateを
     * 見たことにしてしまう。
     */
    valid: incomplete.length === 0 && comparison.comparable,
    gates,
    incomplete,
    baseline: {
      paths: tracked.length,
      gates: baseline.gates.map((gate) => ({
        gate: gate.gate,
        included: gate.includedCount,
        excluded: gate.excludedCount,
      })),
    },
    contaminated: {
      paths: tracked.length + ignored.length,
      ignored: ignored.length,
      gates: contaminated.gates.map((gate) => ({
        gate: gate.gate,
        included: gate.includedCount,
        excluded: gate.excludedCount,
        excludedPaths: gate.excluded.map((entry) => entry.path),
      })),
    },
    comparison,
  };
}

if (isExecutionEntry(import.meta.url)) {
  const result = reportScanBoundary();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
