import fs from "node:fs";
import path from "node:path";
import {
  digestLayaArtifact,
  LAYA_DATASET_SCHEMA_VERSION,
  validateDecisionCase,
  type LayaDecisionCase,
} from "../domain/laya-decision-training.js";
import { git } from "../lib/process.js";

const PUBLIC_ASC_REMOTES = new Set([
  "https://github.com/techbeansjp-free/AGENTS.md.git",
  "git@github.com:techbeansjp-free/AGENTS.md.git",
]);
const REVIEW_PATH = /^docs\/reviews\/[^/]+\.md$/u;
const FINDINGS_HEADING = /^##\s+5\.\s*指摘\s*$/u;
const NEXT_SECTION = /^##\s+/u;

function lines(value: string): string[] {
  return value.split(/\r?\n/u).filter((line) => line.length > 0);
}

function exactCommit(root: string, revision: string): string {
  const commit = git(["rev-parse", "--verify", `${revision}^{commit}`], root)
    .stdout.trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new Error("source revisionを完全SHAへ固定できません");
  return commit;
}

export function assertPublicAscRepository(rootInput: string): string {
  const root = fs.realpathSync(rootInput);
  const top = fs.realpathSync(
    git(["rev-parse", "--show-toplevel"], root).stdout.trim(),
  );
  if (top !== root)
    throw new Error("snapshot rootはGit repository rootが必要です");
  const remote = git(["remote", "get-url", "origin"], root).stdout.trim();
  if (!PUBLIC_ASC_REMOTES.has(remote))
    throw new Error("公開ASC以外のGit remoteを拒否しました");
  return root;
}

export function extractPublicAscReviewCases(
  rootInput: string,
  revision: string,
): LayaDecisionCase[] {
  const root = assertPublicAscRepository(rootInput);
  const commit = exactCommit(root, revision);
  const paths = lines(
    git(
      [
        "-c",
        "core.quotePath=false",
        "ls-tree",
        "-r",
        "--name-only",
        commit,
        "--",
        "docs/reviews",
      ],
      root,
    ).stdout,
  )
    .filter((entry) => REVIEW_PATH.test(entry))
    .sort();
  const cases: LayaDecisionCase[] = [];
  for (const artifactPath of paths) {
    const source = git(["show", `${commit}:${artifactPath}`], root, {
      maxBufferBytes: 16 * 1024 * 1024,
    }).stdout;
    const observedAt = new Date(
      git(
        ["log", "-1", "--format=%cI", commit, "--", artifactPath],
        root,
      ).stdout.trim(),
    ).toISOString();
    const sourceLines = lines(source);
    let inFindings = false;
    for (let index = 0; index < sourceLines.length; index++) {
      const line = sourceLines[index] ?? "";
      if (FINDINGS_HEADING.test(line)) {
        inFindings = true;
        continue;
      }
      if (inFindings && NEXT_SECTION.test(line)) break;
      if (!inFindings || !line.startsWith("|")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (
        cells.length < 4 ||
        cells[0] === "ID" ||
        cells.every((cell) => /^:?-+:?$/u.test(cell))
      )
        continue;
      const [findingId, severity, claim, evidence] = cells;
      if (!findingId || !claim || !evidence) continue;
      const excerpt = `${severity ?? "unknown"}: ${evidence}`.slice(0, 8192);
      const identity = { commit, artifactPath, line: index + 1, findingId };
      const decisionCase: LayaDecisionCase = {
        schemaVersion: LAYA_DATASET_SCHEMA_VERSION,
        caseId: `ASC-${digestLayaArtifact(identity).slice(0, 24)}`,
        sourceRepository: "techbeansjp-free/AGENTS.md",
        sourceCommit: commit,
        observedAt,
        groupId: `review:${artifactPath}`,
        slice: "general",
        claim,
        evidence: [
          {
            path: artifactPath,
            lineStart: index + 1,
            lineEnd: index + 1,
            excerpt,
          },
        ],
        provenance: {
          kind: "review-artifact",
          artifactPath,
          failBeforeCommit: null,
          passAfterCommit: null,
        },
        strength: "weak",
        // Historical review classifications are observations, not ground truth.
        // Gold labels are added only after independent teacher consensus or a
        // separately recorded strong adjudication at training-row construction.
        gold: {},
        critical: severity === "Critical",
      };
      try {
        cases.push(validateDecisionCase(decisionCase));
      } catch {
        // Untrusted historical review text can contain control/format characters
        // or an oversized section. Exclude that candidate instead of weakening
        // the DecisionCase contract for the remaining snapshot.
      }
    }
  }
  const fixCommits = lines(
    git(
      [
        "log",
        "--format=%H",
        "--regexp-ignore-case",
        "--grep=fix",
        "--grep=bug",
        "--grep=修正",
        "--max-count=512",
        commit,
      ],
      root,
    ).stdout,
  );
  for (const fixCommit of fixCommits) {
    const metadata = git(
      ["show", "-s", "--format=%cI%n%s", fixCommit],
      root,
    ).stdout.split(/\r?\n/u);
    const observedAt = new Date(metadata[0] ?? "").toISOString();
    const claim = (metadata[1] ?? "").trim();
    const artifactPath = lines(
      git(
        [
          "-c",
          "core.quotePath=false",
          "show",
          "--format=",
          "--name-only",
          "--diff-filter=AM",
          fixCommit,
        ],
        root,
      ).stdout,
    ).find((entry) => entry && !entry.startsWith(".agent-skill-chain/tmp/"));
    if (!claim || !artifactPath) continue;
    const identity = { fixCommit, artifactPath, claim };
    const decisionCase: LayaDecisionCase = {
      schemaVersion: LAYA_DATASET_SCHEMA_VERSION,
      caseId: `ASC-${digestLayaArtifact(identity).slice(0, 24)}`,
      sourceRepository: "techbeansjp-free/AGENTS.md",
      sourceCommit: commit,
      observedAt,
      groupId: `commit:${fixCommit}`,
      slice: "general",
      claim,
      evidence: [
        {
          path: artifactPath,
          lineStart: 1,
          lineEnd: 1,
          excerpt: `fix commit ${fixCommit}: ${claim}`,
        },
      ],
      provenance: {
        kind: "fix-commit",
        artifactPath,
        failBeforeCommit: null,
        passAfterCommit: fixCommit,
      },
      strength: "weak",
      gold: {},
      critical: false,
    };
    try {
      cases.push(validateDecisionCase(decisionCase));
    } catch {
      // Apply the same exclusion contract as historical review sections.
    }
  }
  return cases.sort((left, right) => left.caseId.localeCompare(right.caseId));
}

export function extractDistributionDecisionCases(
  rootInput: string,
  revision: string,
): LayaDecisionCase[] {
  const root = assertPublicAscRepository(rootInput);
  const commit = exactCommit(root, revision);
  const commits = lines(
    git(
      [
        "log",
        "--format=%H",
        "--max-count=512",
        commit,
        "--",
        "src",
        "bin",
        "dist",
        ".agent-skill-chain/schemas",
        ".agent-skill-chain/skills",
        ".agent-skill-chain/docs",
        "package.json",
      ],
      root,
    ).stdout,
  );
  const cases: LayaDecisionCase[] = [];
  for (const changeCommit of commits) {
    const metadata = git(
      ["show", "-s", "--format=%cI", changeCommit],
      root,
    ).stdout.trim();
    const observedAt = new Date(metadata).toISOString();
    const changed = new Map<string, string>();
    for (const row of lines(
      git(
        [
          "-c",
          "core.quotePath=false",
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-status",
          "-r",
          "-M",
          changeCommit,
        ],
        root,
      ).stdout,
    )) {
      const cells = row.split("\t");
      const status = cells[0] ?? "";
      const changedPath = cells.at(-1);
      if (changedPath) changed.set(changedPath, status[0] ?? "?");
    }
    for (const sourcePath of [...changed.keys()]
      .filter(
        (entry) =>
          (entry.startsWith("src/") || entry.startsWith("bin/")) &&
          entry.endsWith(".ts") &&
          !entry.endsWith(".d.ts"),
      )
      .sort()) {
      const distPath = `dist/${sourcePath.slice(0, -3)}.js`;
      const sourceStatus = changed.get(sourcePath)!;
      const distStatus = changed.get(distPath);
      const paired =
        sourceStatus === "D"
          ? distStatus === "D"
          : distStatus === "A" || distStatus === "M";
      // Co-change is only evidence that packaging was attempted. It is not
      // proof that generated content is equivalent or that consumer checks
      // passed, so it remains unknown until package/install/doctor evidence is
      // joined by the distribution evaluator.
      const distributionImpact = paired ? "unknown" : "package-drift";
      const identity = { changeCommit, sourcePath, distPath };
      const decisionCase: LayaDecisionCase = {
        schemaVersion: LAYA_DATASET_SCHEMA_VERSION,
        caseId: `ASC-DIST-${digestLayaArtifact(identity).slice(0, 24)}`,
        sourceRepository: "techbeansjp-free/AGENTS.md",
        sourceCommit: commit,
        observedAt,
        groupId: `commit:${changeCommit}`,
        slice: "distribution",
        claim: paired
          ? `source ${sourcePath} と利用者向け ${distPath} は同じcommitで変更されたが内容等価性は未検証`
          : `source ${sourcePath} の変更に対応する利用者向け ${distPath} が同じcommitにない`,
        evidence: [
          {
            path: sourcePath,
            lineStart: 1,
            lineEnd: 1,
            excerpt: paired
              ? `paired change observed for packaged artifact ${distPath}; consumer evidence required`
              : `changed without packaged artifact ${distPath}`,
          },
        ],
        provenance: {
          kind: "distribution-check",
          artifactPath: distPath,
          failBeforeCommit: null,
          passAfterCommit: null,
        },
        strength: "weak",
        gold: {
          "distribution-impact": distributionImpact,
        },
        critical: false,
      };
      cases.push(validateDecisionCase(decisionCase));
      if (cases.length >= 2048) return cases;
    }
  }
  return cases.sort((left, right) => left.caseId.localeCompare(right.caseId));
}

export function snapshotManifest(rootInput: string, revision: string) {
  const root = assertPublicAscRepository(rootInput);
  const sourceCommit = exactCommit(root, revision);
  const cases = [
    ...extractPublicAscReviewCases(root, sourceCommit),
    ...extractDistributionDecisionCases(root, sourceCommit),
  ].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const relativeRoot = path.relative(root, root);
  return {
    schemaVersion: "asc/laya-source-snapshot/v1" as const,
    sourceRepository: "techbeansjp-free/AGENTS.md" as const,
    sourceCommit,
    repositoryRootKind: relativeRoot === "" ? "exact-root" : "invalid",
    caseCount: cases.length,
    datasetDigest: digestLayaArtifact(cases),
    cases,
  };
}
