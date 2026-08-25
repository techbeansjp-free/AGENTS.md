import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDistributionDigest,
  normalizeDistributionContent,
  type DistributionDigest,
  type DistributionEntry,
} from "../src/domain/release.js";
import { resolveContained } from "../src/lib/security.js";

function targetDirectory(arguments_: string[]): string {
  let target = process.cwd();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--cwd")
      throw new Error(`未知のoption「${argument ?? ""}」です`);
    const value = arguments_[index + 1];
    if (!value) throw new Error("--cwdにはdirectoryを指定してください");
    target = path.resolve(value);
    index += 1;
  }
  return target;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function packPaths(value: unknown): { paths: string[]; errors: string[] } {
  if (!isUnknownArray(value) || value.length === 0)
    return { paths: [], errors: ["npm packのJSON結果が配列ではありません"] };
  const pack = value[0];
  if (typeof pack !== "object" || pack === null || isUnknownArray(pack))
    return { paths: [], errors: ["npm packの先頭結果がobjectではありません"] };
  const files = (pack as Record<string, unknown>).files;
  if (!isUnknownArray(files))
    return { paths: [], errors: ["npm packのfilesが配列ではありません"] };
  const paths: string[] = [];
  const errors: string[] = [];
  files.forEach((file, index) => {
    if (typeof file !== "object" || file === null || isUnknownArray(file)) {
      errors.push(`npm packのfiles[${index}]がobjectではありません`);
      return;
    }
    const filePath = (file as Record<string, unknown>).path;
    if (typeof filePath !== "string" || filePath.length === 0) {
      errors.push(
        `npm packのfiles[${index}].pathが空でない文字列ではありません`,
      );
      return;
    }
    paths.push(filePath);
  });
  return { paths, errors };
}

export function computeDistributionDigestAt(cwd: string): DistributionDigest {
  const dist = path.join(cwd, "dist");
  if (!fs.existsSync(dist) || !fs.statSync(dist).isDirectory())
    throw new Error(
      `対象directory「${cwd}」にdist/が存在しないため、buildなしでは配布物を算出できません`,
    );
  const packOutput = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd, encoding: "utf8" },
  );
  const listed = packPaths(JSON.parse(packOutput) as unknown);
  if (listed.errors.length > 0)
    return {
      digest: "",
      entryCount: listed.paths.length,
      errors: listed.errors,
    };

  const entries: DistributionEntry[] = [];
  const errors: string[] = [];
  for (const filePath of listed.paths) {
    try {
      const absolutePath = resolveContained(cwd, filePath);
      const content = fs.readFileSync(absolutePath, "utf8");
      const normalized = normalizeDistributionContent(filePath, content);
      entries.push({
        path: filePath,
        contentHash: crypto
          .createHash("sha256")
          .update(normalized)
          .digest("hex"),
      });
    } catch (error) {
      errors.push(
        `配布file「${filePath}」を読み取れません: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (errors.length > 0)
    return { digest: "", entryCount: listed.paths.length, errors };
  return computeDistributionDigest(entries);
}

function main(): void {
  try {
    const result = computeDistributionDigestAt(
      targetDirectory(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.errors.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

const entrypointPath = process.argv[1];
if (
  entrypointPath !== undefined &&
  path.resolve(entrypointPath) === fileURLToPath(import.meta.url)
)
  main();
