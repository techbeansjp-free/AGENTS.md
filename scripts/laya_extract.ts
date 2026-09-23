import path from "node:path";
import { writeLayaArtifact } from "../src/adapters/laya-artifact-store.js";
import { snapshotManifest } from "../src/adapters/laya-snapshot.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`${prefix}<value>が必要です`);
  return value;
}

export function runLayaExtract(): void {
  const root = path.resolve(required("root"));
  const commit = required("commit");
  const output = required("output");
  const manifest = snapshotManifest(root, commit);
  const stored = writeLayaArtifact(root, output, manifest);
  process.stdout.write(
    `${JSON.stringify({ ...stored, caseCount: manifest.caseCount })}\n`,
  );
}

if (isExecutionEntry(import.meta.url)) runLayaExtract();
