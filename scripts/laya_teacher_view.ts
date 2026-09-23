import fs from "node:fs";
import path from "node:path";
import { writeLayaArtifact } from "../src/adapters/laya-artifact-store.js";
import {
  createTeacherView,
  questionIdsForCase,
  type DatasetPartition,
  type LayaDecisionCase,
  type SealedSplit,
} from "../src/domain/laya-decision-training.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { parseJsonStrict, resolveContained } from "../src/lib/security.js";

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`${prefix}<value>が必要です`);
  return value;
}

function readObject(root: string, relative: string, label: string) {
  const file = resolveContained(root, relative);
  const value = parseJsonStrict(fs.readFileSync(file, "utf8"), label);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}はobjectが必要です`);
  return value;
}

export function runLayaTeacherView(): void {
  const root = path.resolve(required("root"));
  const snapshot = readObject(root, required("snapshot"), "Laya snapshot");
  const split = readObject(
    root,
    required("split"),
    "Laya split",
  ) as unknown as SealedSplit;
  const partition = required("partition") as DatasetPartition;
  if (
    !(["train", "validation", "holdout"] as const).includes(partition as never)
  )
    throw new Error("teacher view partitionはtrain/validation/holdoutだけです");
  if (!Array.isArray(snapshot.cases))
    throw new Error("snapshot casesが不正です");
  const selected = new Set(split.partitions[partition]);
  const views = [];
  const excluded: { caseId: string; reason: string }[] = [];
  for (const decisionCase of snapshot.cases as unknown as LayaDecisionCase[]) {
    if (!selected.has(decisionCase.caseId)) continue;
    for (const questionId of questionIdsForCase(decisionCase)) {
      try {
        views.push(createTeacherView(decisionCase, questionId));
      } catch (error) {
        excluded.push({
          caseId: decisionCase.caseId,
          reason: error instanceof Error ? error.message : "unknown",
        });
        break;
      }
    }
  }
  const artifact = {
    schemaVersion: "asc/laya-teacher-view-set/v1" as const,
    partition,
    splitDigest: split.splitDigest,
    views,
    excluded,
  };
  const stored = writeLayaArtifact(root, required("output"), artifact);
  process.stdout.write(
    `${JSON.stringify({
      ...stored,
      caseCount: new Set(views.map((view) => view.caseId)).size,
      viewCount: views.length,
      excludedCount: excluded.length,
    })}\n`,
  );
}

if (isExecutionEntry(import.meta.url)) runLayaTeacherView();
