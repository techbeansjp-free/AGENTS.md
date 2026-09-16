import fs from "node:fs";
import path from "node:path";
import type { ReviewSessionState } from "../domain/review-convergence.js";
import {
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  reviewProgressTargets,
} from "../domain/review-progress.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
import { git } from "../lib/process.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
};

/** formal artifactとsealed journalから再現したprogress投影だけを受理する。 */
export function recordLayerSuffix(
  staging: string,
  root: string,
  fromSha: string,
  toSha: string,
  session: ReviewSessionState,
): readonly string[] | undefined {
  const inventory = session.anchor.progressInventory;
  if (!inventory || fromSha === toSha) return undefined;
  const parent = git(["rev-parse", "--verify", `${toSha}^1^{commit}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  const parents = git(["rev-list", "--parents", "-n", "1", toSha], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (
    parent.status !== 0 ||
    parent.stdout.trim() !== fromSha ||
    parents.status !== 0 ||
    parents.stdout.trim().split(/\s+/u).length !== 2
  )
    return undefined;
  const raw = git(
    ["diff", "--raw", "--no-renames", "--no-abbrev", "-z", fromSha, toSha],
    root,
    { env: GIT_ENV, allowFailure: true },
  );
  if (raw.status !== 0) return undefined;
  const fields = raw.stdout.split("\0").filter(Boolean);
  if (fields.length < 2 || fields.length % 2 !== 0) return undefined;
  const changed: string[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match =
      /^:(?<srcMode>[0-7]{6}) (?<dstMode>[0-7]{6}) [0-9a-f]+ [0-9a-f]+ (?<status>[AM])$/u.exec(
        fields[index] ?? "",
      );
    if (!match?.groups || match.groups.dstMode !== "100644") return undefined;
    if (
      (match.groups.status === "A" && match.groups.srcMode !== "000000") ||
      (match.groups.status === "M" && match.groups.srcMode !== "100644")
    )
      return undefined;
    changed.push(fields[index + 1] ?? "");
  }
  const targets = new Map(
    reviewProgressTargets(inventory).map((target) => [
      path
        .relative(root, path.join(staging, target.targetPath))
        .split(path.sep)
        .join("/"),
      target,
    ]),
  );
  if (
    changed.filter(isEvidenceOnlyPath).length !== 1 ||
    changed.some(
      (changedPath) =>
        !isEvidenceOnlyPath(changedPath) && !targets.has(changedPath),
    )
  )
    return undefined;
  const journal = path.join(staging, "journal/review-progress.jsonl");
  if (!fs.existsSync(journal)) return undefined;
  let records;
  try {
    records = parseReviewProgressRecords(fs.readFileSync(journal, "utf8"));
  } catch {
    return undefined;
  }
  const seal = records.at(-1);
  if (
    !seal ||
    !("sealDigest" in seal) ||
    records.some(
      (record) =>
        record.sessionId !== session.sessionId ||
        record.implementationHeadSha !== fromSha,
    )
  )
    return undefined;
  for (const changedPath of changed) {
    const target = targets.get(changedPath);
    if (!target) continue;
    const before = git(["show", `${fromSha}:${changedPath}`], root, {
      env: GIT_ENV,
      allowFailure: true,
    });
    const after = git(["show", `${toSha}:${changedPath}`], root, {
      env: GIT_ENV,
      allowFailure: true,
    });
    if (before.status !== 0 || after.status !== 0) return undefined;
    try {
      if (
        after.stdout !==
        projectReviewProgressTarget({
          inventory: target,
          source: before.stdout,
          records,
        })
      )
        return undefined;
    } catch {
      return undefined;
    }
  }
  return Object.freeze(changed);
}
