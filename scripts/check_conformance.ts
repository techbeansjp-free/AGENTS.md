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
import {
  isStagingLifecyclePath,
  STAGING_LIFECYCLE_AREAS,
} from "../src/domain/staging.js";
import { FORBIDDEN_DISTRIBUTION_PREFIXES } from "./check_package_contents.js";
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
// 一時ライフサイクル領域は分類正本から取り込む。ここへ書き写すと宣言が分岐する。
export const LIFECYCLE_PACKAGE_ENTRIES: readonly string[] = [
  ".agent-skill-chain/project-policy.json",
  ".agent-skill-chain/project",
  ...STAGING_LIFECYCLE_AREAS,
  "memo",
  "issues",
  ".worktrees",
  "test",
  ".github",
  "scripts",
];

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
    const forbidden = LIFECYCLE_PACKAGE_ENTRIES.find(
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
  errors.push(...checkDistributionGateReachability(root));
  errors.push(...checkModeQuestionText(root));
  errors.push(...checkLifecycleIgnore(root));
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

/**
 * モード判定質問の検査も、repositoryとindexの選択へ影響する環境変数を除去した実行環境を使う。
 * 近似した2つのgit helperを残すと、片方だけが強化されて宣言が分岐する。
 */
function modeQuestionGit(
  root: string,
  args: string[],
): { status: number; stdout: string } {
  return isolatedGit(root, args);
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
/**
 * release workflowの`run` stepを構造として取り出す。
 *
 * **YAML全文の文字列検索では足りない。** コメント、`echo`の引数、`if: false`で無効化された
 * step、無関係なjobの記述がすべて「実行する」と誤判定される。
 */
/** 配布準備工程を構築だけへ移した形。`scripts/check_project_quality.ts`と同じ値。 */
const DISTRIBUTION_PREPARE_COMMAND = "npm run build";

function releaseRunSteps(
  yaml: string,
): { command: string; enabled: boolean }[] {
  const lines = yaml
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/u, "$1"));
  const steps: { command: string; enabled: boolean }[] = [];
  let current: string[] = [];
  let indent = -1;
  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.join("\n");
    const disabled =
      /^\s*(?:-\s+)?if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/mu.test(text);
    const block = /^(\s*)(?:-\s+)?run:[ \t]*[|>][-+]?[ \t]*$/mu.exec(text);
    const inline = /^\s*(?:-\s+)?run:[ \t]+(?![|>][-+]?[ \t]*$)(.+)$/mu.exec(
      text,
    );
    let command = "";
    if (block) {
      const after = text.slice(block.index + block[0].length).split("\n");
      const base = block[1]!.length;
      const body: string[] = [];
      for (const line of after) {
        if (line.trim() === "") continue;
        const width = line.length - line.trimStart().length;
        if (width <= base) break;
        body.push(line.trim());
      }
      command = body.join("\n");
    } else if (inline) command = inline[1]!.trim();
    if (command !== "") steps.push({ command, enabled: !disabled });
    current = [];
  };
  for (const line of lines) {
    const start = /^(\s*)-\s/u.exec(line);
    if (start && (indent < 0 || start[1]!.length <= indent)) {
      flush();
      indent = start[1]!.length;
    }
    current.push(line);
  }
  flush();
  return steps;
}

/**
 * 配布準備工程の形と、release workflowが実際に呼ぶ入口の対応を検査する。
 *
 * **`prepack`は形によって意味が変わる。** 全gateを持つ現行の形では`npm run prepack`が
 * 配布前品質検証そのものだが、構築だけへ移した新しい形では`npm run build`と等価になる。
 * release workflowが`npm run prepack`を呼び続けたまま`prepack`の中身だけを軽くすると、
 * **workflowもrelease契約検査も変わらないまま、不可逆なnpm公開の直前検証が消える。**
 *
 * そこで形と呼び出し先の一致を要求する。片方だけの変更を双方向で拒否する。
 */
export function checkDistributionGateReachability(root: string): string[] {
  const errors: string[] = [];
  const packageFile = path.join(root, "package.json");
  const workflowFile = path.join(root, ".github/workflows/release.yml");
  if (!fs.existsSync(packageFile) || !fs.existsSync(workflowFile)) {
    errors.push(
      "配布gate到達性を判定できません: package.jsonまたはrelease.ymlがありません",
    );
    return errors;
  }
  const parsed = readJson(packageFile);
  const scripts =
    isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : undefined;
  if (!scripts) {
    errors.push(
      "配布gate到達性を判定できません: package.jsonのscriptsが不正です",
    );
    return errors;
  }
  const prepack = typeof scripts.prepack === "string" ? scripts.prepack : "";
  if (prepack === "") {
    errors.push("配布gate到達性を判定できません: prepack scriptがありません");
    return errors;
  }
  /**
   * 準備工程が既知の2形のいずれかであることを要求する。
   *
   * **未知の形を「全gateの形」として扱わない。** `prepack: "echo skip"` を全gate形と誤認すると、
   * release.ymlが`npm run prepack`を呼ぶだけで到達済みと判定してしまう。
   * 保護済みvalidatorも同じ組を拒否するが、本検査だけでも判定が閉じるようにする。
   */
  const lightweight = prepack === DISTRIBUTION_PREPARE_COMMAND;
  const gateChain = prepack
    .split("&&")
    .map((entry) => entry.trim())
    .every((entry) => /^npm run [A-Za-z0-9:._-]+$/u.test(entry));
  if (!lightweight && !gateChain) {
    errors.push(
      "配布gate到達性を判定できません: prepackが既知の形ではありません",
    );
    return errors;
  }
  const steps = releaseRunSteps(fs.readFileSync(workflowFile, "utf8"));
  /**
   * commandを、失敗が伝播する単位へ分割する。
   *
   * `&&`・`;`・改行は前段の失敗を伝えるが、**`||`は伝えない。** `true || npm run x`は
   * 左辺が成功するとxを実行せず、`npm run x || true`はxの失敗を握り潰す。
   * どちらも「実行して成功を要求する」を満たさないため、`||`を含む区間は数えない。
   */
  const reliableSegments = (command: string): string[] =>
    command
      .split(/&&|;|\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !entry.includes("||"));
  const invocationIndex = (kind: "prepack" | "verify"): number => {
    const pattern =
      kind === "prepack"
        ? /^npm\s+run\s+prepack(?![A-Za-z0-9:._-])/u
        : /^npm\s+run\s+verify:distribution(?![A-Za-z0-9:._-])/u;
    return steps.findIndex(
      (step) =>
        step.enabled &&
        reliableSegments(step.command).some((entry) => pattern.test(entry)),
    );
  };
  const invokes = (kind: "prepack" | "verify"): boolean =>
    invocationIndex(kind) >= 0;
  const publishIndex = steps.findIndex(
    (step) =>
      step.enabled &&
      reliableSegments(step.command).some((entry) =>
        /^npm\s+publish(?![A-Za-z0-9:._-])/u.test(entry),
      ),
  );
  const required = lightweight ? "verify:distribution" : "prepack";
  if (!invokes(lightweight ? "verify" : "prepack"))
    errors.push(
      `prepackが${lightweight ? "構築だけの" : "全gateの"}形であるため、release.ymlは有効なstepでnpm run ${required}を実行しなければなりません`,
    );
  if (lightweight && invokes("prepack"))
    errors.push(
      "prepackを構築だけの形にした場合、release.ymlはnpm run prepackを配布前品質検証として実行できません",
    );
  const verificationIndex = invocationIndex(lightweight ? "verify" : "prepack");
  if (
    publishIndex >= 0 &&
    verificationIndex >= 0 &&
    verificationIndex > publishIndex
  )
    errors.push(
      `npm publishより後でしか配布前品質検証を実行していません。npm run ${required}をnpm publishより前の有効なstepで実行してください`,
    );
  return errors;
}

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

/**
 * 一時ライフサイクル領域の宣言が3箇所で分岐していないことを検査する。
 *
 * 分類正本は`STAGING_LIFECYCLE_AREAS`であり、`.gitignore`と配布物検査の除外一覧は
 * そこから照合する。この関数はprefixを1つも自前で書かない。
 */

/** repositoryとindexの選択へ影響する環境変数。除去しないと別repositoryを検査し得る。 */
const GIT_REDIRECT_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
];
/**
 * command scopeの設定注入。`GIT_CONFIG_KEY_0`等から`core.worktree`を注入できるため、
 * 固定名だけでは足りずpatternでも除去する。
 */
const GIT_REDIRECT_ENVIRONMENT_PATTERN = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u;

function isolatedGit(
  root: string,
  args: string[],
): { status: number; stdout: string } {
  const environment = { ...process.env };
  for (const name of GIT_REDIRECT_ENVIRONMENT) delete environment[name];
  for (const name of Object.keys(environment))
    if (GIT_REDIRECT_ENVIRONMENT_PATTERN.test(name)) delete environment[name];
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  return { status: result.status ?? 128, stdout: result.stdout ?? "" };
}

/** `<source>:<line>:<pattern>\t<path>` を分解する。 */
function parseIgnoreMatch(
  output: string,
): { source: string; pattern: string } | undefined {
  const [descriptor] = output.split("\t");
  const parts = (descriptor ?? "").split(":");
  if (parts.length < 3) return undefined;
  const [source, , ...rest] = parts;
  return source === undefined || rest.length === 0
    ? undefined
    : { source, pattern: rest.join(":") };
}

function checkAreaIgnored(root: string, area: string): string[] {
  const expected = `${area}/`;
  const observed: Array<{ source: string; pattern: string }> = [];
  for (const probe of [`${area}/probe`, `${area}/nested/deeper/probe`]) {
    const result = isolatedGit(root, ["check-ignore", "-v", "--", probe]);
    if (result.status === 1)
      return [
        `一時ライフサイクル領域が無視対象ではありません: ${area}。root .gitignoreへ ${expected} を追加してください`,
      ];
    if (result.status !== 0)
      return [
        `一時ライフサイクル領域の無視設定を問い合わせできません: ${area}（終了値${result.status}）。無視されているとみなさずに拒否します`,
      ];
    const matched = parseIgnoreMatch(result.stdout.trim());
    if (!matched)
      return [
        `一時ライフサイクル領域の無視設定を解釈できません: ${area}（観測値: ${result.stdout.trim()}）`,
      ];
    observed.push(matched);
  }
  const [shallow, deep] = observed as [
    { source: string; pattern: string },
    { source: string; pattern: string },
  ];
  if (shallow.pattern !== expected || deep.pattern !== expected)
    return [
      `一時ライフサイクル領域の無視patternが領域全体を指していません: ${area}（観測したpattern: ${shallow.pattern}、${deep.pattern}）`,
    ];
  if (shallow.source !== ".gitignore" || deep.source !== ".gitignore")
    return [
      `一時ライフサイクル領域の無視設定がrepositoryで追跡される .gitignore にありません: ${area}（観測した一致元: ${shallow.source}、${deep.source}）`,
    ];
  return [];
}

/**
 * 領域一覧が配布物検査の除外一覧に含まれることを照合する。
 * 引数で受けるのはtest seamではなく、判定を観測から分離するための純関数境界である。
 */
export function checkLifecycleDistributionExclusion(
  areas: readonly string[],
  prefixes: readonly string[],
): string[] {
  return areas
    .filter((area) => !prefixes.includes(`${area}/`))
    .map(
      (area) =>
        `一時ライフサイクル領域が配布物検査の除外一覧にありません: ${area}`,
    );
}

/** 領域一覧がpackage資産の禁止entry一覧に含まれることを照合する。 */
export function checkLifecyclePackageEntries(
  areas: readonly string[],
  entries: readonly string[],
): string[] {
  return areas
    .filter((area) => !entries.includes(area))
    .map(
      (area) =>
        `一時ライフサイクル領域がpackage資産の禁止entry一覧にありません: ${area}`,
    );
}

export function checkLifecycleIgnore(root: string): string[] {
  const errors: string[] = [];
  const toplevel = isolatedGit(root, ["rev-parse", "--show-toplevel"]);
  if (toplevel.status !== 0)
    return [
      `検査対象のrepository rootを解決できません（終了値${toplevel.status}）。無視設定を検証できないため拒否します`,
    ];
  // realpathSyncは存在しないpathで例外を投げる。診断APIとして例外を漏らさない。
  let resolved: string;
  let expected: string;
  try {
    resolved = fs.realpathSync(toplevel.stdout.trim());
    expected = fs.realpathSync(root);
  } catch {
    return [
      `検査対象のrepository rootを解決できません: 観測値=${toplevel.stdout.trim()}。無視設定を検証できないため拒否します`,
    ];
  }
  if (resolved !== expected)
    return [
      `検査対象と解決されたrepository rootが一致しません: 指定=${root}、解決=${resolved}。GIT_DIR等の環境変数を外して再実行してください`,
    ];
  const tracked = isolatedGit(root, ["ls-files", "-z"]);
  if (tracked.status !== 0)
    return [
      `追跡fileを列挙できません（終了値${tracked.status}）。無視設定を検証できないため拒否します`,
    ];
  const ignoreTracked = isolatedGit(root, [
    "ls-files",
    "--error-unmatch",
    "--",
    ".gitignore",
  ]);
  if (ignoreTracked.status !== 0)
    errors.push(
      "無視設定を持つ .gitignore がrepositoryで追跡されていません。git add .gitignore を実行してください",
    );
  for (const area of STAGING_LIFECYCLE_AREAS)
    errors.push(...checkAreaIgnored(root, area));
  for (const relative of tracked.stdout.split("\0").filter(Boolean))
    if (isStagingLifecyclePath(relative))
      errors.push(
        `一時ライフサイクル領域配下のfileが追跡されています: ${relative}。git rm --cached で追跡を外してください`,
      );
  errors.push(
    ...checkLifecycleDistributionExclusion(
      STAGING_LIFECYCLE_AREAS,
      FORBIDDEN_DISTRIBUTION_PREFIXES,
    ),
  );
  errors.push(
    ...checkLifecyclePackageEntries(
      STAGING_LIFECYCLE_AREAS,
      LIFECYCLE_PACKAGE_ENTRIES,
    ),
  );
  return errors;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = checkConformance(root);
