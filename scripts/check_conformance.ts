import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildRuleCoverage,
  CANONICAL_SCAN_LOCATIONS,
  collectCanonicalScanTargets,
  detectCanonicalDuplication,
  validateCanonicalContracts,
  PROJECT_RULE_ENFORCEMENT_POINTS,
  validateProjectRuleLedgerEntry,
  validateReviewExceptions,
  validateRepositoryConformance,
  type RuleCoverageRow,
} from "../src/domain/conformance.js";
import { MODE_QUESTIONS, validateModeQuestions } from "../src/domain/mode.js";
import { isRecord, type ProviderCapabilityMapping } from "../src/types.js";
import { checkWorkflowSteps } from "./check_workflow_steps.js";
import { checkWorktreeContract } from "./check_worktree_contract.js";
import { checkRequirementIdScheme } from "./check_requirement_id_scheme.js";

const CANONICAL_CONTRACTS_FILE = ".agent-skill-chain/canonical-contracts.json";

function repositoryMarkdownPaths(root: string): string[] {
  const walk = (directory: string): string[] => {
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        if (entry.name === "node_modules" || entry.name === ".git") return [];
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(absolute);
        return [path.relative(root, absolute).replaceAll(path.sep, "/")];
      });
  };
  return walk(root);
}

const CANONICAL_RULE_FILE =
  ".agent-skill-chain/project/rules/canonical-source.json";

export function checkCanonicalScopeAlignment(root: string): string[] {
  const ruleFile = path.join(root, CANONICAL_RULE_FILE);
  if (!fs.existsSync(ruleFile)) return [`${CANONICAL_RULE_FILE}がありません`];
  let rule: unknown;
  try {
    rule = JSON.parse(fs.readFileSync(ruleFile, "utf8")) as unknown;
  } catch {
    return [`${CANONICAL_RULE_FILE}を解析できません`];
  }
  const scope =
    typeof rule === "object" && rule !== null && "scope" in rule
      ? (rule as { scope: unknown }).scope
      : undefined;
  if (!Array.isArray(scope) || scope.some((entry) => typeof entry !== "string"))
    return [`${CANONICAL_RULE_FILE}のscopeは文字列配列が必要です`];
  const declared = [...(scope as string[])].sort();
  const scanned = CANONICAL_SCAN_LOCATIONS.map((location) =>
    location.replace(/\/$/u, ""),
  ).sort();
  const missing = scanned.filter((entry) => !declared.includes(entry));
  const extra = declared.filter((entry) => !scanned.includes(entry));
  return [
    ...missing.map(
      (entry) =>
        `${CANONICAL_RULE_FILE}: 走査locationがscopeに宣言されていません: ${entry}`,
    ),
    ...extra.map(
      (entry) =>
        `${CANONICAL_RULE_FILE}: scopeが走査対象外のlocationを宣言しています: ${entry}`,
    ),
  ];
}

export function checkCanonicalDuplication(root: string): string[] {
  const registryFile = path.join(root, CANONICAL_CONTRACTS_FILE);
  if (!fs.existsSync(registryFile))
    return [`${CANONICAL_CONTRACTS_FILE}がありません`];
  let registry: unknown;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, "utf8")) as unknown;
  } catch {
    return [`${CANONICAL_CONTRACTS_FILE}を解析できません`];
  }
  const allPaths = repositoryMarkdownPaths(root);
  const validation = validateCanonicalContracts(registry, new Set(allPaths));
  if (validation.errors.length > 0) return validation.errors;
  const files = collectCanonicalScanTargets(allPaths).map((relative) => {
    try {
      return {
        path: relative,
        text: fs.readFileSync(path.join(root, relative), "utf8"),
      };
    } catch {
      return { path: relative, text: null };
    }
  });
  const result = detectCanonicalDuplication({
    contracts: validation.contracts,
    files,
  });
  return [
    ...result.errors,
    ...result.violations.map(
      (violation) => `${violation.path}: ${violation.remediation}`,
    ),
  ];
}

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

const TEXT_ASSET_SUFFIXES = new Set([
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".yaml",
  ".yml",
]);
const NORMATIVE_DOCUMENTS = [
  ".agent-skill-chain/docs/00_運用ポリシー.md",
  ".agent-skill-chain/docs/01_開発ワークフロー.md",
  ".agent-skill-chain/docs/02_品質基準.md",
] as const;
const REQUIRED_QUALITY_SCRIPTS = [
  "docs:format",
  "test:format",
  "typecheck",
  "build",
  "package:check",
  "test:unit",
  "test:integration",
  "test:e2e",
] as const;
const FOREIGN_PACKAGE_MANAGER_FILES = [
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
] as const;
const FORBIDDEN_PACKAGE_ENTRIES = [
  ".agent-skill-chain/project-policy.json",
  ".agent-skill-chain/project",
  ".agent-skill-chain/role-log",
  ".agent-skill-chain/metrics",
  "memo",
  "issues",
  ".worktrees",
  "test",
  ".github",
  "scripts",
] as const;

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

function joinedText(target: string, suffixes: ReadonlySet<string>): string {
  return assetFiles(target)
    .filter((file) => suffixes.has(path.extname(file)))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function topLevelSection(source: string, section: string): string[] {
  const lines = source.split(/\r?\n/u);
  const heading = new RegExp(`^(?:"${section}"|${section}):\\s*(.*)$`, "u");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const first = heading.exec(lines[start] ?? "")?.[1]?.trim() ?? "";
  if (first.length > 0) return [first];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line) && !/^\s*#/u.test(line)) break;
    body.push(line);
  }
  return body;
}

function yamlMappingKeys(lines: string[]): string[] {
  if (lines.length === 1 && /^\{.*\}$/u.test(lines[0] ?? ""))
    return [
      ...(lines[0] ?? "").matchAll(/(?:^|[{,])\s*([A-Za-z0-9_-]+)\s*:/gu),
    ].map((match) => match[1] ?? "");
  if (lines.length === 1 && /^\[.*\]$/u.test(lines[0] ?? ""))
    return (lines[0] ?? "")
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  return lines.flatMap((line) => {
    const match = /^\s{2}([A-Za-z0-9_-]+):/u.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
}

export function checkQualityCiTriggers(source: string): string[] {
  const triggers = yamlMappingKeys(topLevelSection(source, "on"));
  return triggers.length === 1 && triggers[0] === "pull_request"
    ? []
    : [
        `品質CI triggerはpull_requestだけでなければなりません: ${triggers.join(",") || "未定義"}`,
      ];
}

export function checkQualityCiPermissions(source: string): string[] {
  const lines = topLevelSection(source, "permissions");
  if (lines.length === 0) return ["品質CIのtop-level permissionsがありません"];
  const invalid = lines.flatMap((line) => {
    const match = /^\s{2}([A-Za-z0-9_-]+):\s*([^\s#]+)/u.exec(line);
    return match?.[1] && match[2] !== "read" && match[2] !== "none"
      ? [`${match[1]}:${match[2]}`]
      : [];
  });
  return invalid.length === 0
    ? []
    : [`品質CIにread-only以外のpermissionがあります: ${invalid.join(",")}`];
}

export function checkPackageManagerBoundary(root: string): string[] {
  const errors: string[] = [];
  if (!fs.existsSync(path.join(root, "package-lock.json")))
    errors.push("package-lock.jsonがありません");
  for (const relative of FOREIGN_PACKAGE_MANAGER_FILES)
    if (fs.existsSync(path.join(root, relative)))
      errors.push(`npm以外のlockfileがあります: ${relative}`);
  const choices = readJson(
    path.join(root, ".agent-skill-chain/project/choices/development.json"),
  );
  if (!isRecord(choices) || choices.packageManager !== "npm")
    errors.push("project choiceのpackageManagerはnpmでなければなりません");
  for (const workflow of ["ci.yml", "trusted-quality.yml", "release.yml"]) {
    const file = path.join(root, ".github/workflows", workflow);
    if (
      !fs.existsSync(file) ||
      !/\brun:\s*npm ci(?:\s|$)/mu.test(fs.readFileSync(file, "utf8"))
    )
      errors.push(`${workflow}にnpm ciによる依存導入がありません`);
  }
  return errors;
}

export function checkNodeRuntimeAlignment(root: string): string[] {
  const metadata = readJson(path.join(root, "package.json"));
  const engine =
    isRecord(metadata) && isRecord(metadata.engines)
      ? metadata.engines.node
      : undefined;
  const minimum =
    typeof engine === "string" ? /^>=\s*(\d+)/u.exec(engine)?.[1] : undefined;
  if (!minimum) return ["package engineのNode.js下限を解決できません"];
  const minimumMajor = Number.parseInt(minimum, 10);
  const ciText = joinedText(
    path.join(root, ".github/workflows"),
    new Set([".yml", ".yaml"]),
  );
  const versions = [
    ...ciText.matchAll(/node-version:\s*[\x22\x27]?(\d+)/gu),
  ].map((match) => Number.parseInt(match[1] ?? "0", 10));
  if (versions.length === 0) return ["CIのNode.js versionがありません"];
  return versions.some((version) => version < minimumMajor)
    ? [
        `CIのNode.js versionがpackage engine ${String(engine)}を満たしません: ${versions.join(",")}`,
      ]
    : [];
}

export function checkQualityCommands(root: string): string[] {
  const metadata = readJson(path.join(root, "package.json"));
  const scripts =
    isRecord(metadata) && isRecord(metadata.scripts) ? metadata.scripts : {};
  const errors = REQUIRED_QUALITY_SCRIPTS.flatMap((name) =>
    typeof scripts[name] === "string" && scripts[name].trim().length > 0
      ? []
      : [`品質commandがありません: ${name}`],
  );
  const choices = readJson(
    path.join(root, ".agent-skill-chain/project/choices/development.json"),
  );
  const layers =
    isRecord(choices) && Array.isArray(choices.testLayers)
      ? choices.testLayers
      : [];
  for (const layer of ["unit", "integration", "e2e"])
    if (!layers.includes(layer))
      errors.push(`project choiceにtest layer ${layer}がありません`);
  return errors;
}

function normalPackageEntry(value: string): string {
  return value.replace(/^\.\//u, "").replace(/\/+$/u, "");
}

export function checkPackageDistributionBoundary(root: string): string[] {
  const metadata = readJson(path.join(root, "package.json"));
  const entries =
    isRecord(metadata) && Array.isArray(metadata.files)
      ? metadata.files.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
  if (!isRecord(metadata) || !Array.isArray(metadata.files))
    return ["package.json files allowlistがありません"];
  return entries.flatMap((rawEntry) => {
    const entry = normalPackageEntry(rawEntry);
    const forbidden = FORBIDDEN_PACKAGE_ENTRIES.find(
      (candidate) =>
        entry === candidate ||
        entry.startsWith(`${candidate}/`) ||
        candidate.startsWith(`${entry}/`),
    );
    return forbidden
      ? [`npm filesが配布外境界を含みます: ${rawEntry} -> ${forbidden}`]
      : [];
  });
}

export function checkTrustedPolicyBoundary(root: string): string[] {
  const trustedFile = path.join(root, ".github/workflows/trusted-quality.yml");
  const ciFile = path.join(root, ".github/workflows/ci.yml");
  if (!fs.existsSync(trustedFile) || !fs.existsSync(ciFile))
    return ["trusted default branch policy workflowがありません"];
  const trusted = fs.readFileSync(trustedFile, "utf8");
  const ci = fs.readFileSync(ciFile, "utf8");
  const errors: string[] = [];
  for (const [pattern, message] of [
    [
      /pull_request_target:/u,
      "trusted workflowはpull_request_targetでなければなりません",
    ],
    [
      /ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u,
      "trusted validatorはPR base SHAから取得しなければなりません",
    ],
    [
      /--trusted-root=\$GITHUB_WORKSPACE\/trusted/u,
      "candidateはtrusted base validatorで検証しなければなりません",
    ],
  ] as const)
    if (!pattern.test(trusted)) errors.push(message);
  if (
    !/ASC_TRUSTED_COMMIT:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u.test(
      ci,
    )
  )
    errors.push(
      "candidate policy検証は同じPRのbase SHAへ拘束しなければなりません",
    );
  return errors;
}

export function checkWorkflowStepDocument(
  root: string,
  document = path.join(root, ".agent-skill-chain/docs/01_開発ワークフロー.md"),
): string[] {
  const result = checkWorkflowSteps(root, document);
  return result.errors.map((error) => `workflow step契約: ${error}`);
}

export interface RepositoryRuleLedgerResult {
  valid: boolean;
  errors: string[];
  rules: unknown[];
  coverage: {
    rows: RuleCoverageRow[];
    orphans: Array<{ ruleId: string; reason: string }>;
  };
}

export function checkRepositoryRuleLedger(
  root: string,
): RepositoryRuleLedgerResult {
  const errors: string[] = [];
  const manifest = readJson(
    path.join(root, ".agent-skill-chain/project-policy.json"),
  );
  const ruleFiles =
    isRecord(manifest) && Array.isArray(manifest.ruleFiles)
      ? manifest.ruleFiles.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  if (!isRecord(manifest) || !Array.isArray(manifest.ruleFiles))
    errors.push("project policyのruleFiles inventoryがありません");
  const sorted = [...ruleFiles].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (JSON.stringify(sorted) !== JSON.stringify(ruleFiles))
    errors.push("project policyのruleFilesはsort順でなければなりません");
  const actualRuleFiles = fs
    .readdirSync(path.join(root, ".agent-skill-chain/project/rules"), {
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `project/rules/${entry.name}`)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(sorted) !== JSON.stringify(actualRuleFiles))
    errors.push(
      "project policyのruleFilesがrules directoryの完全inventoryではありません",
    );
  const rules = ruleFiles.map((relative) =>
    readJson(path.join(root, ".agent-skill-chain", relative)),
  );
  const ids = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const label = ruleFiles[index] ?? `rule[${index}]`;
    const validation = validateProjectRuleLedgerEntry(rule, label);
    errors.push(...validation.errors);
    if (isRecord(rule) && typeof rule.ruleId === "string") {
      if (ids.has(rule.ruleId))
        errors.push(`ruleIdが重複しています: ${rule.ruleId}`);
      ids.add(rule.ruleId);
    }
  }
  const normativeText = NORMATIVE_DOCUMENTS.map((relative) =>
    fs.readFileSync(path.join(root, relative), "utf8"),
  ).join("\n");
  const coverage = buildRuleCoverage({
    rules,
    normativeText,
    schemaText: joinedText(
      path.join(root, ".agent-skill-chain/schemas"),
      new Set([".json"]),
    ),
    runtimeText: [
      joinedText(path.join(root, "src"), new Set([".ts"])),
      ...Object.keys(PROJECT_RULE_ENFORCEMENT_POINTS),
    ].join("\n"),
    ciText: joinedText(
      path.join(root, ".github/workflows"),
      new Set([".yml", ".yaml"]),
    ),
  });
  const reviewExceptionFile = path.join(
    root,
    ".agent-skill-chain/review-exceptions.json",
  );
  if (!fs.existsSync(reviewExceptionFile))
    errors.push(".agent-skill-chain/review-exceptions.jsonがありません");
  else
    errors.push(
      ...validateReviewExceptions({
        document: JSON.parse(fs.readFileSync(reviewExceptionFile, "utf8")),
        now: new Date().toISOString(),
      }).errors,
    );
  errors.push(...checkModeQuestionText(root));
  errors.push(...checkWorktreeContract(root).errors);
  errors.push(...checkRequirementIdScheme(root).errors);
  errors.push(...checkCanonicalScopeAlignment(root));
  errors.push(...checkCanonicalDuplication(root));
  errors.push(
    ...coverage.orphans.map((orphan) => `${orphan.ruleId}: ${orphan.reason}`),
    ...checkQualityCiTriggers(
      fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
    ),
    ...checkQualityCiPermissions(
      fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
    ),
    ...checkPackageManagerBoundary(root),
    ...checkNodeRuntimeAlignment(root),
    ...checkQualityCommands(root),
    ...checkPackageDistributionBoundary(root),
    ...checkTrustedPolicyBoundary(root),
    ...checkWorkflowStepDocument(root),
  );
  return { valid: errors.length === 0, errors, rules, coverage };
}

export function findPackageModelSlugViolations(
  root: string,
  mapping?: ProviderCapabilityMapping,
): PackageModelSlugViolation[] {
  const slugs = new Set<string>();
  const modelSlug = /\b(?:gpt|claude)-[a-z0-9][a-z0-9.-]*\b/gu;
  if (mapping)
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
  const ledger = checkRepositoryRuleLedger(root);
  if (!ledger.valid) {
    process.stderr.write(
      `project rule台帳検査: 失敗\n${ledger.errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    return 1;
  }
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
    const ownershipViolations = findPackageModelSlugViolations(root);
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
      `conformance検査: 合格（project rule ${ledger.coverage.rows.length}件、orphan 0件、I1〜I12、実在source/export、成功SCN証拠、固定model slug 0件）\n`,
    );
    return 0;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** モード判定質問の文面を人が読む形で持つ規範文書。機械可読な定義との対を成す。 */
const MODE_QUESTION_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
/** 質問文の出現を許可するpath。この2箇所以外に現れたら複製として拒否する。 */
const MODE_QUESTION_SOURCES = [MODE_QUESTION_DOCUMENT, "src/domain/mode.ts"];

function modeQuestionGit(
  root: string,
  args: string[],
): { status: number; stdout: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { status: result.status ?? 128, stdout: result.stdout ?? "" };
}

/** `| Q-0N | <分類> | <質問文> |` を順序どおり抽出する。 */
function parseModeQuestionRows(
  markdown: string,
): Array<{ id: string; disqualifier: string; question: string }> {
  const rows: Array<{ id: string; disqualifier: string; question: string }> =
    [];
  for (const line of markdown.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 3 || !/^Q-\d{2}$/u.test(cells[0] ?? "")) continue;
    rows.push({
      id: cells[0]!,
      disqualifier: (cells[1] ?? "").replaceAll("`", ""),
      question: cells[2] ?? "",
    });
  }
  return rows;
}

/**
 * モード判定質問の整合を検査する。
 *
 * 規範文書と機械可読な定義を`(id, 分類, 質問文)`の順序付き8行として比較する。
 * IDと質問文だけを比べると、機械可読側で分類を別の質問へ付け替えても通過する。
 */
export function checkModeQuestionText(root: string): string[] {
  const errors = [...validateModeQuestions(MODE_QUESTIONS)];
  const documentPath = path.join(root, MODE_QUESTION_DOCUMENT);
  if (!fs.existsSync(documentPath))
    return [...errors, `${MODE_QUESTION_DOCUMENT}がありません`];
  const rows = parseModeQuestionRows(fs.readFileSync(documentPath, "utf8"));
  const expected = MODE_QUESTIONS.map(
    (entry) => `${entry.id}\u0000${entry.disqualifier}\u0000${entry.question}`,
  );
  const actual = rows.map(
    (row) => `${row.id}\u0000${row.disqualifier}\u0000${row.question}`,
  );
  if (actual.length !== expected.length)
    errors.push(
      `モード判定質問の行数が規範文書と一致しません: 文書=${actual.length}、定義=${expected.length}`,
    );
  for (const [index, value] of expected.entries())
    if (actual[index] !== value)
      errors.push(
        `モード判定質問が規範文書と一致しません: ${MODE_QUESTIONS[index]!.id}（文書: ${(actual[index] ?? "（なし）").replaceAll("\u0000", " / ")}／定義: ${value.replaceAll("\u0000", " / ")}）`,
      );
  const tracked = modeQuestionGit(root, ["ls-files", "-z"]);
  if (tracked.status !== 0)
    return [
      ...errors,
      `追跡fileを列挙できません（終了値${tracked.status}）。質問文の複製を検証できないため拒否します`,
    ];
  for (const relative of tracked.stdout.split("\0").filter(Boolean)) {
    if (MODE_QUESTION_SOURCES.includes(relative)) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(path.join(root, relative), "utf8");
    } catch {
      errors.push(
        `追跡fileを読めません: ${relative}。質問文の複製を検証できないため拒否します`,
      );
      continue;
    }
    for (const entry of MODE_QUESTIONS)
      if (contents.includes(entry.question))
        errors.push(
          `モード判定質問の文面が許可外のfileにあります: ${relative}（${entry.id}）`,
        );
  }
  return errors;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = checkConformance(root);
