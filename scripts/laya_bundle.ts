import fs from "node:fs";
import path from "node:path";
import { validateDecisionBundleArtifacts } from "../src/adapters/laya-decision-bundle.js";
import {
  decisionBundleDigest,
  type LayaDecisionBundle,
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

export function runLayaBundleValidation(): void {
  const root = path.resolve(required("root"));
  const bundlePath = path.resolve(root, required("bundle"));
  const bundle = parseJsonStrict(
    fs.readFileSync(bundlePath, "utf8"),
    "Decision Bundle",
  ) as unknown as LayaDecisionBundle;
  const validated = validateDecisionBundleArtifacts(
    bundle,
    root,
    required("asc-version"),
  );
  process.stdout.write(
    `${JSON.stringify({ valid: true, authority: false, bundleDigest: decisionBundleDigest(validated) })}\n`,
  );
}

if (isExecutionEntry(import.meta.url)) runLayaBundleValidation();
