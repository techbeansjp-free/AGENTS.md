import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict, stableJson } from "../src/lib/security.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { isRecord } from "../src/types.js";

interface ProjectQualityResult {
  valid: boolean;
  errors: string[];
  checks: string[];
}

interface QualityContractTarget {
  kind: "file" | "packageField";
  name: string;
  beforeSha256: string;
  afterSha256: string;
}

interface QualityContractProposal {
  proposalId: string;
  status: "staged";
  fromVersion: number;
  toVersion: number;
  owner: string;
  rationale: string;
  rollback: string;
  targets: QualityContractTarget[];
}

interface QualityContractProposalRegistry {
  schemaVersion: "agent-skill-chain/trusted-quality-proposals/v1";
  proposals: QualityContractProposal[];
}

const PROPOSAL_REGISTRY = ".github/trusted-quality-proposals.json";
const PROTECTED_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/trusted-quality.yml",
  ".prettierignore",
  "cucumber.mjs",
  "eslint.config.mjs",
  "package-lock.json",
  "scripts/check_project_quality.ts",
  "scripts/check_source_quality.ts",
  "src/lib/entrypoint.ts",
  "src/lib/security.ts",
  "tsconfig.json",
  "tsconfig.build.json",
] as const;
const PROTECTED_PACKAGE_FIELDS = [
  "agentSkillChain.qualityContractVersion",
  "devDependencies",
  "engines",
  "type",
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

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
    'prettier --check "{src,bin,scripts,test}/**/*.{ts,json}" ".agent-skill-chain/**/*.json" "*.{json,mjs}" ".github/**/*.{json,yml}"',
  "format:write":
    'prettier --write "{src,bin,scripts,test}/**/*.{ts,json}" ".agent-skill-chain/**/*.json" "*.{json,mjs}" ".github/**/*.{json,yml}"',
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
};

/**
 * 配布前品質検証のgate集合。**consumerの準備工程では実行しない。**
 *
 * `prepack`はgit依存installの準備でpnpmが実行する。品質gateをそこへ置くと、`.git`の無い
 * 展開先で`git ls-files`依存の検査が必ず落ち、配布経路が成立しない（Issue #965）。
 */
const DISTRIBUTION_GATES = [
  "project:quality",
  "quality",
  "build",
  "docs:format",
  "test:format",
  "trace:check",
  "architecture:check",
  "conformance:check",
  "audit:check",
  "package:check",
] as const;

/** 新しい形。`prepack`はbuildだけを行い、品質gateは`verify:distribution`が持つ。 */
const DISTRIBUTION_PREPARE_COMMAND = "npm run build";

/**
 * `prepack`と配布前品質検証の組が、現行の形か新しい形のいずれかであることを検査する。
 *
 * **両方を受理するのは前方互換のためである。** 新しい形へ移すには`prepack`の内容を変える
 * 必要があり、この検査自体がprotected fileにあるため、proposal registryによる二段階の
 * 承認を経る。基盤段階でこの検査が両方を受理していなければ、activation段階が提出できない。
 */
function validateDistributionScripts(
  scripts: Record<string, unknown>,
): string[] {
  const prepack = typeof scripts.prepack === "string" ? scripts.prepack : "";
  const gates = DISTRIBUTION_GATES.map((gate) => `npm run ${gate}`).join(
    " && ",
  );
  if (prepack === DISTRIBUTION_PREPARE_COMMAND) {
    const errors: string[] = [];
    if (scripts.prepare !== DISTRIBUTION_PREPARE_COMMAND)
      errors.push(
        `prepackを${DISTRIBUTION_PREPARE_COMMAND}にする場合、prepareも同じ内容が必要です`,
      );
    if (scripts["verify:distribution"] !== gates)
      errors.push(
        "verify:distributionは配布前品質gateを順序どおり完全一致で宣言しなければなりません",
      );
    return errors;
  }
  if (prepack !== gates) return ["prepack scriptを自己緩和できません"];
  if (
    scripts.prepare !== undefined &&
    scripts.prepare !== DISTRIBUTION_PREPARE_COMMAND
  )
    return [`prepareは${DISTRIBUTION_PREPARE_COMMAND}でなければなりません`];
  return [];
}

function readObject(file: string): Record<string, unknown> {
  const value = parseJsonStrict(fs.readFileSync(file, "utf8"), file);
  if (!isRecord(value)) throw new Error(`${file}はobjectでなければなりません`);
  return value;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function packageField(
  metadata: Record<string, unknown>,
  field: (typeof PROTECTED_PACKAGE_FIELDS)[number],
): unknown {
  if (field !== "agentSkillChain.qualityContractVersion")
    return metadata[field];
  return isRecord(metadata.agentSkillChain)
    ? metadata.agentSkillChain.qualityContractVersion
    : undefined;
}

function qualityContractVersion(metadata: Record<string, unknown>): number {
  const value = packageField(
    metadata,
    "agentSkillChain.qualityContractVersion",
  );
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1)
    throw new Error(
      "package.json.agentSkillChain.qualityContractVersionは1以上の整数でなければなりません",
    );
  return value;
}

export function normalizeLockfileForProtection(raw: string): string {
  const parsed = parseJsonStrict(raw, "package-lock.json");
  if (!isRecord(parsed)) return raw;
  const normalized: Record<string, unknown> = { ...parsed };
  delete normalized.version;
  if (isRecord(normalized.packages)) {
    const packages: Record<string, unknown> = { ...normalized.packages };
    const own = packages[""];
    if (isRecord(own)) {
      const ownWithoutVersion: Record<string, unknown> = { ...own };
      delete ownWithoutVersion.version;
      packages[""] = ownWithoutVersion;
    }
    normalized.packages = packages;
  }
  return stableJson(normalized);
}

type ProtectedFileRead =
  { readonly content: string | Buffer } | { readonly reason: string };

/**
 * 保護対象fileの内容を読む。
 *
 * **欠損を未捕捉例外にしない。** この関数はenforcement exportである
 * `checkProjectQualityContract`の内側で呼ばれ、同exportは構造化された`errors`を返す契約を持つ。
 * 例外はその契約に反し、「保護対象fileが候補で削除された」という現実の事故・攻撃の形を
 * error名ではなくstack traceとして現す。読めない場合は理由を返し、呼び出し側がerrorへ積む。
 *
 * **欠損と読めないことを区別する。** 前者は削除、後者は権限・種別の異常であり、
 * 次に採る操作が違う。
 */
function protectedFileContent(
  root: string,
  relative: string,
): ProtectedFileRead {
  const absolute = path.join(root, relative);
  let raw: Buffer;
  try {
    raw = fs.readFileSync(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      reason:
        code === "ENOENT"
          ? "存在しません"
          : `読み取れません（${code ?? "不明"}）`,
    };
  }
  return {
    content:
      relative === "package-lock.json"
        ? normalizeLockfileForProtection(raw.toString("utf8"))
        : raw,
  };
}

/**
 * 候補側の`PROTECTED_FILES`をsourceから静的に取り出す。
 *
 * **候補のcodeを実行しない。** base validatorはcandidateのscriptもその依存も走らせない。
 * 取り出せない場合は`undefined`を返し、呼び出し側がfail-closedで拒否する。
 */
function candidateProtectedFiles(root: string): readonly string[] | undefined {
  const file = path.join(root, "scripts/check_project_quality.ts");
  if (!fs.existsSync(file)) return undefined;
  const block = /const PROTECTED_FILES = \[([^\]]*)\] as const;/u.exec(
    fs.readFileSync(file, "utf8"),
  );
  if (!block?.[1]) return undefined;
  return [...block[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
}

/**
 * 保護対象のsnapshotを作る。
 *
 * **読めなかったfileはsnapshotへ載せず、どちら側かを名指しして`errors`へ積む。**
 * trusted側の欠損は基準の破損、candidate側の欠損は候補の異常であり意味が違う。
 *
 * **fail-closedを成立させるのは`errors`への追加であって、snapshotへ載せないことではない。**
 * 後段の`actualChanges`は`after === undefined`をskipするため、載せないだけなら
 * 候補による保護対象fileの削除が変更として検出されずに通る。空hashや既定値で
 * 代替しないのは偽の一致を作らないためであり、それ自体は安全側の根拠にならない。
 */
function protectedSnapshot(
  root: string,
  metadata: Record<string, unknown>,
  side: "trusted" | "candidate",
  errors: string[],
): Map<string, string> {
  const snapshot = new Map<string, string>();
  const sideLabel = side === "trusted" ? "trusted base" : "候補";
  for (const relative of PROTECTED_FILES) {
    const read = protectedFileContent(root, relative);
    if ("reason" in read) {
      errors.push(`${sideLabel}の保護対象file ${relative} が${read.reason}`);
      continue;
    }
    snapshot.set(`file:${relative}`, sha256(read.content));
  }
  for (const field of PROTECTED_PACKAGE_FIELDS)
    snapshot.set(
      `packageField:${field}`,
      sha256(stableJson(packageField(metadata, field))),
    );
  return snapshot;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function readProposalRegistry(file: string): QualityContractProposalRegistry {
  const value = readObject(file);
  if (
    !exactKeys(value, ["schemaVersion", "proposals"]) ||
    value.schemaVersion !== "agent-skill-chain/trusted-quality-proposals/v1" ||
    !Array.isArray(value.proposals)
  )
    throw new Error(`${file}のtrusted品質proposal registryが不正です`);
  const proposals: QualityContractProposal[] = [];
  const ids = new Set<string>();
  for (const rawProposal of value.proposals) {
    if (
      !isRecord(rawProposal) ||
      !exactKeys(rawProposal, [
        "proposalId",
        "status",
        "fromVersion",
        "toVersion",
        "owner",
        "rationale",
        "rollback",
        "targets",
      ]) ||
      typeof rawProposal.proposalId !== "string" ||
      !/^TQP-[A-Z0-9][A-Z0-9-]*$/u.test(rawProposal.proposalId) ||
      ids.has(rawProposal.proposalId) ||
      rawProposal.status !== "staged" ||
      typeof rawProposal.fromVersion !== "number" ||
      !Number.isInteger(rawProposal.fromVersion) ||
      typeof rawProposal.toVersion !== "number" ||
      !Number.isInteger(rawProposal.toVersion) ||
      rawProposal.toVersion !== rawProposal.fromVersion + 1 ||
      typeof rawProposal.owner !== "string" ||
      rawProposal.owner.trim() === "" ||
      typeof rawProposal.rationale !== "string" ||
      rawProposal.rationale.trim().length < 12 ||
      typeof rawProposal.rollback !== "string" ||
      rawProposal.rollback.trim().length < 12 ||
      !Array.isArray(rawProposal.targets) ||
      rawProposal.targets.length < 2
    )
      throw new Error(`${file}のtrusted品質proposalが不正です`);
    const targets: QualityContractTarget[] = [];
    const targetKeys = new Set<string>();
    for (const rawTarget of rawProposal.targets) {
      if (
        !isRecord(rawTarget) ||
        !exactKeys(rawTarget, [
          "kind",
          "name",
          "beforeSha256",
          "afterSha256",
        ]) ||
        (rawTarget.kind !== "file" && rawTarget.kind !== "packageField") ||
        typeof rawTarget.name !== "string" ||
        typeof rawTarget.beforeSha256 !== "string" ||
        !SHA256.test(rawTarget.beforeSha256) ||
        typeof rawTarget.afterSha256 !== "string" ||
        !SHA256.test(rawTarget.afterSha256) ||
        rawTarget.beforeSha256 === rawTarget.afterSha256
      )
        throw new Error(`${file}のtrusted品質proposal targetが不正です`);
      const allowed =
        rawTarget.kind === "file"
          ? PROTECTED_FILES.some((item) => item === rawTarget.name)
          : PROTECTED_PACKAGE_FIELDS.some((item) => item === rawTarget.name);
      const key = `${rawTarget.kind}:${rawTarget.name}`;
      if (!allowed || targetKeys.has(key))
        throw new Error(`${file}のtrusted品質proposal target境界が不正です`);
      targetKeys.add(key);
      targets.push({
        kind: rawTarget.kind,
        name: rawTarget.name,
        beforeSha256: rawTarget.beforeSha256,
        afterSha256: rawTarget.afterSha256,
      });
    }
    ids.add(rawProposal.proposalId);
    proposals.push({
      proposalId: rawProposal.proposalId,
      status: rawProposal.status,
      fromVersion: rawProposal.fromVersion,
      toVersion: rawProposal.toVersion,
      owner: rawProposal.owner,
      rationale: rawProposal.rationale,
      rollback: rawProposal.rollback,
      targets,
    });
  }
  return {
    schemaVersion: "agent-skill-chain/trusted-quality-proposals/v1",
    proposals,
  };
}

const PROPOSAL_DESCRIPTION_FIELDS = ["owner", "rationale", "rollback"] as const;

function proposalContract(
  proposal: QualityContractProposal,
): Record<string, unknown> {
  const contract: Record<string, unknown> = { ...proposal };
  for (const field of PROPOSAL_DESCRIPTION_FIELDS) delete contract[field];
  return contract;
}

function targetMap(proposal: QualityContractProposal): Map<string, string> {
  return new Map(
    proposal.targets.map((target) => [
      `${target.kind}:${target.name}`,
      `${target.beforeSha256}:${target.afterSha256}`,
    ]),
  );
}

function sameMap(
  left: Map<string, string>,
  right: Map<string, string>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([key, value]) => right.get(key) === value)
  );
}

/**
 * 新たに保護対象へ加えるfileを、同じPRで変更させない。
 *
 * **base validatorは自分の`PROTECTED_FILES`でsnapshotを取るため、候補が追加した対象は
 * hash照合を受けない。** そのため保護対象へ加えるのと同時に、悪意ある版を初期値として
 * 封印できてしまう。2026-08-27の実測では、backdoorを追記したfileを保護対象へ加える候補が
 * `valid: true`で通った。
 *
 * 追加分はtrusted側と候補側で同一内容であることを要求する。読み取れない場合は拒否する。
 * **この検査自体がbase側で走るため、効くのは次の版上げからである。**保護追加の初回には
 * 必ず窓が開く。
 */
function validateProtectionBootstrap(
  root: string,
  trustedRoot: string,
): string[] {
  const candidateProtected = candidateProtectedFiles(root);
  if (candidateProtected === undefined)
    return [
      "候補のPROTECTED_FILESを読み取れません。保護対象の追加を検証できないため拒否します",
    ];
  const errors: string[] = [];
  for (const relative of candidateProtected) {
    if (PROTECTED_FILES.some((item) => item === relative)) continue;
    const trustedFile = path.join(trustedRoot, relative);
    const candidateFile = path.join(root, relative);
    if (!fs.existsSync(trustedFile) || !fs.existsSync(candidateFile)) {
      errors.push(
        `新たに保護対象へ加えるfileが双方に存在しません: ${relative}`,
      );
      continue;
    }
    if (
      sha256(fs.readFileSync(trustedFile)) !==
      sha256(fs.readFileSync(candidateFile))
    )
      errors.push(
        `新たに保護対象へ加えるfileを同じPRで変更できません: ${relative}`,
      );
  }
  return errors;
}

function validateTrustedQualityMigration(
  root: string,
  trustedRoot: string,
  metadata: Record<string, unknown>,
  trustedMetadata: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const trustedRegistry = readProposalRegistry(
    path.join(trustedRoot, PROPOSAL_REGISTRY),
  );
  const candidateRegistry = readProposalRegistry(
    path.join(root, PROPOSAL_REGISTRY),
  );
  const trustedById = new Map(
    trustedRegistry.proposals.map((proposal) => [
      proposal.proposalId,
      proposal,
    ]),
  );
  const candidateById = new Map(
    candidateRegistry.proposals.map((proposal) => [
      proposal.proposalId,
      proposal,
    ]),
  );
  const newProposalIds = candidateRegistry.proposals
    .filter((proposal) => !trustedById.has(proposal.proposalId))
    .map((proposal) => proposal.proposalId);
  for (const trustedProposal of trustedRegistry.proposals) {
    const candidateProposal = candidateById.get(trustedProposal.proposalId);
    if (candidateProposal === undefined) {
      errors.push(
        `${trustedProposal.proposalId}のtrusted品質proposalは削除できません`,
      );
      continue;
    }
    if (
      stableJson(proposalContract(candidateProposal)) !==
      stableJson(proposalContract(trustedProposal))
    )
      errors.push(
        `${trustedProposal.proposalId}のtrusted品質proposalの契約fieldは変更できません`,
      );
  }
  const trustedVersion = qualityContractVersion(trustedMetadata);
  const candidateVersion = qualityContractVersion(metadata);
  const trustedSnapshot = protectedSnapshot(
    trustedRoot,
    trustedMetadata,
    "trusted",
    errors,
  );
  const candidateSnapshot = protectedSnapshot(
    root,
    metadata,
    "candidate",
    errors,
  );
  errors.push(...validateProtectionBootstrap(root, trustedRoot));
  for (const proposal of candidateRegistry.proposals) {
    if (trustedById.has(proposal.proposalId)) continue;
    if (
      proposal.fromVersion !== trustedVersion ||
      proposal.toVersion !== trustedVersion + 1
    )
      errors.push(
        `${proposal.proposalId}は現在のtrusted品質契約versionから1段階だけ提案してください`,
      );
    const targets = targetMap(proposal);
    const versionTarget = targets.get(
      "packageField:agentSkillChain.qualityContractVersion",
    );
    const expectedVersionTarget = `${trustedSnapshot.get("packageField:agentSkillChain.qualityContractVersion")}:${sha256(stableJson(proposal.toVersion))}`;
    if (versionTarget !== expectedVersionTarget)
      errors.push(
        `${proposal.proposalId}はqualityContractVersionの一段階更新をtargetへ含めてください`,
      );
    for (const target of proposal.targets) {
      const key = `${target.kind}:${target.name}`;
      if (trustedSnapshot.get(key) !== target.beforeSha256)
        errors.push(
          `${proposal.proposalId}.${key}のbefore hashがtrustedと不一致です`,
        );
    }
  }
  const actualChanges = new Map<string, string>();
  for (const [key, before] of trustedSnapshot) {
    const after = candidateSnapshot.get(key);
    if (after !== before && after !== undefined)
      actualChanges.set(key, `${before}:${after}`);
  }
  if (actualChanges.size === 0) {
    if (candidateVersion !== trustedVersion)
      errors.push("protected差分なしで品質契約versionを変更できません");
    return errors;
  }
  if (newProposalIds.length > 0)
    errors.push(
      `品質契約を有効化するPRで新規proposalを同時登録できません: ${newProposalIds.join(", ")}`,
    );
  const approved = trustedRegistry.proposals.find(
    (proposal) =>
      proposal.fromVersion === trustedVersion &&
      proposal.toVersion === candidateVersion &&
      sameMap(targetMap(proposal), actualChanges),
  );
  if (!approved)
    errors.push(
      "candidateのtrusted品質契約変更はbaseで事前登録済みのversioned staged proposalと完全一致しません",
    );
  return errors;
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
  errors.push(...validateDistributionScripts(scripts));
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
  if (!eslint.includes('files: ["{src,bin,scripts,test}/**/*.ts"]'))
    errors.push("ESLintの型認識ruleはtestを含む全TypeScriptへ適用が必要です");
  const stepsRoot = path.join(root, "test/steps");
  if (!fs.existsSync(stepsRoot)) {
    errors.push("型付きCucumber stepを検証するtest/stepsがありません");
  } else {
    const stepFiles = fs
      .readdirSync(stepsRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => path.join(entry.parentPath, entry.name));
    for (const file of stepFiles) {
      const source = fs.readFileSync(file, "utf8");
      if (
        /import\s*\{[^}]*\b(?:Given|When|Then)\b[^}]*\}\s*from\s*["']@cucumber\/cucumber["']/su.test(
          source,
        )
      )
        errors.push(
          `${path.relative(root, file)}はCucumber stepを直接importせず型付きstepDefinitionsを使用してください`,
        );
      if (!source.includes("stepDefinitions<"))
        errors.push(
          `${path.relative(root, file)}は型付きstepDefinitionsでWorld型を拘束してください`,
        );
    }
  }
  checks.push("ESLint explicit・propagated any rule");
  checks.push("testの型認識lint・型付きCucumber World binding");

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
    const trustedMetadata = readObject(path.join(trustedRoot, "package.json"));
    errors.push(
      ...validateTrustedQualityMigration(
        root,
        trustedRoot,
        metadata,
        trustedMetadata,
      ),
    );
    checks.push("base事前登録済みversioned staged proposalによる品質契約更新");
  }
  return { valid: errors.length === 0, errors, checks };
}

if (isExecutionEntry(import.meta.url)) {
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
