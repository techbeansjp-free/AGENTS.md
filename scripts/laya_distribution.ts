import fs from "node:fs";
import path from "node:path";
import { writeLayaArtifact } from "../src/adapters/laya-artifact-store.js";
import {
  assessDistribution,
  type DistributionEvidence,
} from "../src/domain/laya-distribution.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { parseJsonStrict } from "../src/lib/security.js";

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`${prefix}<value>が必要です`);
  return value;
}

export function runLayaDistribution(): void {
  const root = path.resolve(required("root"));
  const input = path.resolve(root, required("input"));
  const output = required("output");
  const evidence = parseJsonStrict(
    fs.readFileSync(input, "utf8"),
    "distribution evidence",
  ) as unknown as DistributionEvidence[];
  const stored = writeLayaArtifact(root, output, {
    schemaVersion: "asc/laya-distribution-assessment/v1",
    evidence,
    assessment: assessDistribution(evidence),
  });
  process.stdout.write(`${JSON.stringify(stored)}\n`);
}

if (isExecutionEntry(import.meta.url)) runLayaDistribution();
