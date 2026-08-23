import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonStrict, stableJson } from "../src/lib/security.js";
import { isRecord } from "../src/types.js";

interface ProjectQualityResult {
  valid: boolean;
  errors: string[];
  checks: string[];
}

const EXPECTED_SCRIPTS: Record<string, string> = {
  clean: "node --import tsx scripts/clean.ts",
  compile: "node --import tsx scripts/compile.ts",
  build: "npm run compile && node --import tsx scripts/build.ts",
  "directories:check": "node --import tsx scripts/check_directory_guides.ts",
  "skills:check": "node --import tsx scripts/check_skill_templates.ts",
  "cli:check": "node --import tsx scripts/check_cli_contract.ts",
  "project:quality": "node --import tsx scripts/check_project_quality.ts",
  lint: "eslint .",
  "format:check":
    'prettier --check "{src,bin,scripts,test}/**/*.{ts,json}" ".agent-skill-chain/**/*.json" "*.{json,mjs}" ".github/**/*.yml"',
  "format:write":
    'prettier --write "{src,bin,scripts,test}/**/*.{ts,json}" ".agent-skill-chain/**/*.json" "*.{json,mjs}" ".github/**/*.yml"',
  typecheck: "tsc -p tsconfig.json --noEmit",
  "source:check": "node --import tsx scripts/check_source_quality.ts",
  "docs:format": "node --import tsx scripts/check_japanese_docs.ts",
  "test:format": "node --import tsx scripts/check_gherkin_format.ts",
  "package:check": "node --import tsx scripts/check_package_contents.ts",
  test: "npm run compile --silent && node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs",
  "test:unit":
    "npm run compile --silent && node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --tags @unit",
  "test:integration":
    "npm run compile --silent && node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --tags @integration",
  "test:e2e":
    "npm run compile --silent && node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --tags @e2e",
  "trace:check": "node --import tsx scripts/check_trace.ts",
  "architecture:check": "node --import tsx scripts/check_dependency_graph.ts",
  "audit:check": "node --import tsx scripts/check_file_audit.ts",
  "conformance:check": "node --import tsx scripts/check_conformance.ts",
  quality:
    "npm run lint && npm run format:check && npm run typecheck && npm run source:check && npm test",
  prepack:
    "npm run project:quality && npm run quality && npm run build && npm run docs:format && npm run test:format && npm run trace:check && npm run architecture:check && npm run conformance:check && npm run audit:check && npm run package:check",
};

function readObject(file: string): Record<string, unknown> {
  const value = parseJsonStrict(fs.readFileSync(file, "utf8"), file);
  if (!isRecord(value)) throw new Error(`${file}はobjectでなければなりません`);
  return value;
}

export function checkProjectQualityContract(
  root = process.cwd(),
  trustedRoot?: string,
): ProjectQualityResult {
  const errors: string[] = [];
  const checks: string[] = [];
  const metadata = readObject(path.join(root, "package.json"));
  const scripts = isRecord(metadata.scripts) ? metadata.scripts : {};
  const choices = readObject(
    path.join(root, ".agent-skill-chain/project/choices/development.json"),
  );
  const quality = isRecord(choices.quality) ? choices.quality : {};
  const engines = isRecord(metadata.engines) ? metadata.engines : {};
  if (choices.packageManager !== "npm")
    errors.push(
      "project choiceのpackageManagerは実package manager npmと一致が必要です",
    );
  if (choices.runtime !== "Node.js 20以上" || engines.node !== ">=20")
    errors.push(
      "project choiceのruntimeはpackage.json.engines.nodeと一致が必要です",
    );
  if (choices.ci !== ".github/workflows/ci.yml")
    errors.push("project choiceのciは実workflow pathと一致が必要です");
  checks.push("package manager・runtime・CIのproject choice binding");
  const commandBindings: Record<string, string> = {
    lintCommand: "lint",
    formatCheckCommand: "format:check",
    formatWriteCommand: "format:write",
    typecheckCommand: "typecheck",
  };
  for (const [choice, script] of Object.entries(commandBindings)) {
    if (quality[choice] !== `npm run ${script}`)
      errors.push(`${choice}がpackage script ${script}へ一致していません`);
    if (scripts[script] !== EXPECTED_SCRIPTS[script])
      errors.push(`${script} scriptがtrusted project契約と一致していません`);
  }
  for (const [script, expected] of Object.entries(EXPECTED_SCRIPTS))
    if (scripts[script] !== expected)
      errors.push(`${script} scriptを自己緩和できません`);
  const expectedQuality =
    "npm run lint && npm run format:check && npm run typecheck && npm run source:check && npm test";
  if (scripts.quality !== expectedQuality)
    errors.push(
      "quality scriptはlint→format→typecheck→source→testの順序が必要です",
    );
  const prepack = typeof scripts.prepack === "string" ? scripts.prepack : "";
  if (!prepack.startsWith("npm run project:quality && npm run quality && "))
    errors.push(
      "prepackはproject品質契約とqualityを先頭で実行しなければなりません",
    );
  checks.push("project choiceとpackage scriptの完全一致");

  const tsconfig = readObject(path.join(root, "tsconfig.json"));
  const compilerOptions = isRecord(tsconfig.compilerOptions)
    ? tsconfig.compilerOptions
    : {};
  const include = Array.isArray(tsconfig.include)
    ? (tsconfig.include as unknown[])
    : [];
  if (
    compilerOptions.strict !== true ||
    compilerOptions.noImplicitAny !== true ||
    compilerOptions.allowJs !== false ||
    !include.includes("test/**/*.ts")
  )
    errors.push(
      "tsconfigはstrict・noImplicitAny・allowJs=false・test型検査が必要です",
    );
  checks.push("TypeScript compiler option");

  const eslint = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
  for (const rule of [
    "no-explicit-any",
    "no-unsafe-argument",
    "no-unsafe-assignment",
    "no-unsafe-call",
    "no-unsafe-member-access",
    "no-unsafe-return",
  ])
    if (!eslint.includes(`@typescript-eslint/${rule}`))
      errors.push(`ESLintに${rule}がありません`);
  checks.push("ESLint explicit・propagated any rule");

  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8",
  );
  const projectGate = workflow.indexOf("run: npm run project:quality");
  const qualityGate = workflow.indexOf("run: npm run quality");
  if (projectGate < 0 || qualityGate < 0 || projectGate > qualityGate)
    errors.push("CIはproject品質契約をqualityより先に実行しなければなりません");
  checks.push("CI gate order");

  const trustedWorkflow = fs.readFileSync(
    path.join(root, ".github/workflows/trusted-quality.yml"),
    "utf8",
  );
  for (const required of [
    "pull_request_target:",
    "ref: ${{ github.event.pull_request.base.sha }}",
    "ref: ${{ github.event.pull_request.head.sha }}",
    "working-directory: trusted",
    'scripts/check_project_quality.ts "--root=$GITHUB_WORKSPACE/candidate"',
  ])
    if (!trustedWorkflow.includes(required))
      errors.push(`trusted base品質gateに必須拘束がありません: ${required}`);
  if (/working-directory:\s*candidate/u.test(trustedWorkflow))
    errors.push(
      "trusted base品質gateはcandidate directoryでcommandを実行できません",
    );
  checks.push("base workflowによるcandidate設定のread-only検証");
  if (trustedRoot) {
    for (const relative of [
      ".github/workflows/ci.yml",
      ".github/workflows/trusted-quality.yml",
      ".prettierignore",
      "cucumber.mjs",
      "eslint.config.mjs",
      "package-lock.json",
      "scripts/check_project_quality.ts",
      "scripts/check_source_quality.ts",
      "tsconfig.json",
      "tsconfig.build.json",
    ]) {
      const trusted = fs.readFileSync(path.join(trustedRoot, relative));
      const candidate = fs.readFileSync(path.join(root, relative));
      if (!trusted.equals(candidate))
        errors.push(
          `${relative}はcandidateからtrusted validatorを変更できません`,
        );
    }
    const trustedMetadata = readObject(path.join(trustedRoot, "package.json"));
    for (const field of ["devDependencies", "engines", "type"])
      if (stableJson(trustedMetadata[field]) !== stableJson(metadata[field]))
        errors.push(`package.json.${field}はcandidateから変更できません`);
    checks.push("base-owned validatorの完全一致");
  }
  return { valid: errors.length === 0, errors, checks };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const rootArgument = process.argv.find((argument) =>
    argument.startsWith("--root="),
  );
  const root = rootArgument
    ? path.resolve(rootArgument.slice("--root=".length))
    : process.cwd();
  const trustedRootArgument = process.argv.find((argument) =>
    argument.startsWith("--trusted-root="),
  );
  const trustedRoot = trustedRootArgument
    ? path.resolve(trustedRootArgument.slice("--trusted-root=".length))
    : undefined;
  const result = checkProjectQualityContract(root, trustedRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
