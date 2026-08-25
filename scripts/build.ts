import fs from "node:fs";
import path from "node:path";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  PACKAGE_VERSION,
  SUPPORTED_POLICY_SCHEMA_VERSIONS,
  packageReleaseVersion,
} from "../src/lib/version.js";
import { checkDirectoryGuides } from "./check_directory_guides.js";
import { checkSkillTemplateContracts } from "./check_skill_templates.js";
import { checkCliContract } from "./check_cli_contract.js";
import { checkWorkflowSteps } from "./check_workflow_steps.js";

const required = [
  "dist/bin/agent-skill-chain.js",
  "AGENTS.md",
  ".agent-skill-chain/00_利用案内.md",
  ".agent-skill-chain/docs/00_運用ポリシー.md",
  ".agent-skill-chain/docs/01_開発ワークフロー.md",
  ".agent-skill-chain/docs/02_品質基準.md",
  ".agent-skill-chain/schemas/project-policy.schema.json",
  ".agent-skill-chain/policy/default.json",
  ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
  ".agent-skill-chain/schemas/project-choice.schema.json",
  ".agent-skill-chain/schemas/project-rule.schema.json",
  ".agent-skill-chain/schemas/project-conformance-binding.schema.json",
  ".agent-skill-chain/schemas/conformance-contract.schema.json",
  ".agent-skill-chain/schemas/workflow-mode-decision.schema.json",
  ".agent-skill-chain/schemas/workflow-step-journal.schema.json",
  ".agent-skill-chain/policy/conformance.json",
];
const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));
if (missing.length)
  throw new Error(`パッケージ資産が不足しています: ${missing.join(", ")}`);
const directoryGuides = checkDirectoryGuides();
if (!directoryGuides.valid)
  throw new Error(
    `directory利用案内が不正です: ${directoryGuides.errors.join("; ")}`,
  );
const skillContracts = checkSkillTemplateContracts();
if (!skillContracts.valid)
  throw new Error(
    `skill・template契約が不正です: ${skillContracts.errors.join("; ")}`,
  );
const cliContract = checkCliContract();
if (!cliContract.valid)
  throw new Error(`公開CLI契約が不正です: ${cliContract.errors.join("; ")}`);
const workflowSteps = checkWorkflowSteps();
if (!workflowSteps.valid)
  throw new Error(
    `workflow step契約が不正です: ${workflowSteps.errors.join("; ")}`,
  );
const packageMetadata = JSON.parse(
  fs.readFileSync("package.json", "utf8"),
) as unknown as { version?: unknown };
const lockMetadata = JSON.parse(
  fs.readFileSync("package-lock.json", "utf8"),
) as unknown as {
  version?: unknown;
  packages?: Record<string, { version?: unknown }>;
};
const policySchema = JSON.parse(
  fs.readFileSync(
    ".agent-skill-chain/schemas/project-policy.schema.json",
    "utf8",
  ),
) as unknown as {
  properties?: { schemaVersion?: { enum?: unknown } };
};
const manifestSchema = JSON.parse(
  fs.readFileSync(
    ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
    "utf8",
  ),
) as unknown as {
  properties?: {
    policy?: { properties?: { schemaVersion?: { const?: unknown } } };
  };
};
const defaultPolicy = JSON.parse(
  fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
) as unknown as { schemaVersion?: unknown };
const samplePolicy = JSON.parse(
  fs.readFileSync(".agent-skill-chain/policy/sample.json", "utf8"),
) as unknown as { schemaVersion?: unknown };
const releaseVersion = packageReleaseVersion(PACKAGE_VERSION);
if (
  packageMetadata.version !== PACKAGE_VERSION ||
  lockMetadata.version !== PACKAGE_VERSION ||
  lockMetadata.packages?.[""]?.version !== PACKAGE_VERSION
)
  throw new Error("package.jsonとpackage-lock.jsonの製品versionが一致しません");
if (
  CURRENT_POLICY_SCHEMA_VERSION !==
  `agent-skill-chain/project-policy/v${releaseVersion}`
)
  throw new Error(
    "製品versionと現行project policy schema versionが一致しません",
  );
if (
  JSON.stringify(policySchema.properties?.schemaVersion?.enum) !==
  JSON.stringify(SUPPORTED_POLICY_SCHEMA_VERSIONS)
)
  throw new Error(
    "package.jsonとproject policy schemaの対応versionが一致しません",
  );
for (const [name, version] of [
  [
    "manifest schema",
    manifestSchema.properties?.policy?.properties?.schemaVersion?.const,
  ],
  ["default policy", defaultPolicy.schemaVersion],
  ["sample policy", samplePolicy.schemaVersion],
])
  if (version !== CURRENT_POLICY_SCHEMA_VERSION)
    throw new Error(
      `${name}がpackage.jsonの現行project policy schema versionと一致しません`,
    );
fs.chmodSync(path.resolve("dist/bin/agent-skill-chain.js"), 0o755);
process.stdout.write(
  `v${releaseVersion}パッケージ資産検査: 合格（製品${PACKAGE_VERSION}、project policy ${CURRENT_POLICY_SCHEMA_VERSION}、directory入口${directoryGuides.directories}件、skill・template契約${skillContracts.skills}件、公開CLI ${cliContract.commands}件）\n`,
);
