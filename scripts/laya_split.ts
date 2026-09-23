import fs from "node:fs";
import path from "node:path";
import { writeLayaArtifact } from "../src/adapters/laya-artifact-store.js";
import {
  createSealedSplit,
  type LayaDecisionCase,
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

export function runLayaSplit(): void {
  const root = path.resolve(required("root"));
  const input = resolveContained(root, required("input"));
  const output = required("output");
  const createdAt = required("created-at");
  const parsed = parseJsonStrict(
    fs.readFileSync(input, "utf8"),
    "Laya snapshot manifest",
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Array.isArray(parsed.cases)
  )
    throw new Error("snapshot manifestのcasesが不正です");
  const split = createSealedSplit(
    parsed.cases as unknown as LayaDecisionCase[],
    createdAt,
  );
  const stored = writeLayaArtifact(root, output, split);
  process.stdout.write(
    `${JSON.stringify({
      ...stored,
      splitDigest: split.splitDigest,
      partitionCounts: Object.fromEntries(
        Object.entries(split.partitions).map(([name, ids]) => [
          name,
          ids.length,
        ]),
      ),
    })}\n`,
  );
}

if (isExecutionEntry(import.meta.url)) runLayaSplit();
