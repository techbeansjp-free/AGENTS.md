import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { validateRepositoryConformance } from "../src/domain/conformance.js";
import { readProviderCapabilityMapping } from "../src/domain/provider-capability.js";
import { isRecord, type ProviderCapabilityMapping } from "../src/types.js";

const PACKAGE_MODEL_SLUG_PATHS = [
  "AGENTS.md",
  ".agent-skill-chain/00_利用案内.md",
  ".agent-skill-chain/docs",
  ".agent-skill-chain/policy",
  ".agent-skill-chain/schemas",
  ".agent-skill-chain/skills",
  ".agent-skill-chain/templates",
  "bin",
  "src",
  "scripts",
] as const;

const TEXT_ASSET_SUFFIXES = new Set([".json", ".md", ".mjs", ".ts"]);

export interface PackageModelSlugViolation {
  path: string;
  slug: string;
}

function assetFiles(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile())
    return TEXT_ASSET_SUFFIXES.has(path.extname(target)) ? [target] : [];
  if (!stat.isDirectory()) return [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isSymbolicLink() ? [] : assetFiles(path.join(target, entry.name)),
    );
}

export function findPackageModelSlugViolations(
  root: string,
  mapping: ProviderCapabilityMapping,
): PackageModelSlugViolation[] {
  const slugs = new Set<string>();
  const modelSlug = /\bgpt-[a-z0-9.-]+\b/gu;
  for (const match of JSON.stringify(mapping).matchAll(modelSlug))
    if (match[0]) slugs.add(match[0]);
  const violations: PackageModelSlugViolation[] = [];
  for (const file of PACKAGE_MODEL_SLUG_PATHS.flatMap((relative) =>
    assetFiles(path.join(root, relative)),
  )) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(modelSlug)) {
      const slug = match[0];
      if (slug)
        violations.push({
          path: path.relative(root, file).split(path.sep).join("/"),
          slug,
        });
    }
  }
  for (const slug of slugs)
    violations.push({
      path: ".agent-skill-chain/project/providers/capability-mapping.json",
      slug,
    });
  return violations;
}

function passedScenarioIds(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error("Cucumber JSON reportは配列でなければなりません");
  const passed: string[] = [];
  for (const feature of value) {
    if (!isRecord(feature) || !Array.isArray(feature.elements))
      throw new Error("Cucumber JSON reportのfeature構造が不正です");
    for (const element of feature.elements) {
      if (!isRecord(element) || !Array.isArray(element.steps))
        throw new Error("Cucumber JSON reportのscenario構造が不正です");
      const match =
        typeof element.name === "string"
          ? /\b(SCN-[A-Z0-9-]+)\b/u.exec(element.name)
          : null;
      const allPassed = element.steps.every(
        (step) =>
          isRecord(step) &&
          isRecord(step.result) &&
          step.result.status === "passed",
      );
      if (match?.[1] && allPassed) passed.push(match[1]);
    }
  }
  return passed;
}

export function checkConformance(root: string): number {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "asc-conformance-"));
  const report = path.join(temporary, "cucumber.json");
  try {
    const run = spawnSync("npm", ["test", "--", "--format", `json:${report}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (run.status !== 0) return run.status ?? 1;
    const reportInput: unknown = JSON.parse(fs.readFileSync(report, "utf8"));
    const contract: unknown = JSON.parse(
      fs.readFileSync(
        path.join(root, ".agent-skill-chain/policy/conformance.json"),
        "utf8",
      ),
    );
    const binding: unknown = JSON.parse(
      fs.readFileSync(
        path.join(root, ".agent-skill-chain/project/conformance/bindings.json"),
        "utf8",
      ),
    );
    const mapping = readProviderCapabilityMapping(
      fs.readFileSync(
        path.join(
          root,
          ".agent-skill-chain/project/providers/capability-mapping.json",
        ),
        "utf8",
      ),
    );
    const ownershipViolations = findPackageModelSlugViolations(root, mapping);
    const result = validateRepositoryConformance(root, contract, binding, {
      tool: "cucumber-js",
      passedScenarioIds: passedScenarioIds(reportInput),
    });
    const errors = [
      ...result.errors,
      ...ownershipViolations.map(
        (violation) =>
          `固定model slugを保持している資産があります: ${violation.path} (${violation.slug})`,
      ),
    ];
    if (errors.length > 0) {
      process.stderr.write(
        `conformance検査: 失敗\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
      );
      return 1;
    }
    process.stdout.write(
      "conformance検査: 合格（I1〜I12、実在source/export、成功SCN証拠、固定model slug 0件）\n",
    );
    return 0;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = checkConformance(root);
