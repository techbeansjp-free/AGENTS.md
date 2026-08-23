import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLI_USAGE,
  LEGACY_LIFECYCLE_ALIASES,
  PUBLIC_LIFECYCLE_COMMANDS,
} from "../src/cli-contract.js";

const GUIDE = ".agent-skill-chain/00_利用案内.md";
const SPEC_FILES = [
  "docs/specs/04_機能/00_ワークフローv0.3.md",
  "docs/specs/12_運用保守/00_運用設計.md",
  "docs/specs/13_移行・廃止/00_移行方針.md",
];

/** @param {string} root */
export function checkCliContract(root = process.cwd()) {
  const errors = [];
  const metadataFile = path.resolve(root, "package.json");
  const guideFile = path.resolve(root, GUIDE);
  if (!fs.existsSync(metadataFile))
    return { valid: false, errors: ["package.jsonがありません"], commands: 0 };
  if (!fs.existsSync(guideFile))
    return { valid: false, errors: [`${GUIDE}がありません`], commands: 0 };
  const metadata = JSON.parse(
    fs.readFileSync(metadataFile, "utf8"),
  ) as unknown as { name?: string; bin?: Record<string, string> };
  const packageName = metadata.name ?? "";
  const bin = metadata.bin?.[packageName];
  if (
    packageName !== "agent-skill-chain" ||
    bin !== "./dist/bin/agent-skill-chain.js"
  )
    errors.push("package名とnpx解決用bin契約が一致しません");
  if (!CLI_USAGE.startsWith(`npx ${packageName} `))
    errors.push("CLI helpがpackage名を使うnpx形式ではありません");
  for (const command of [
    "issue",
    "project",
    "spec",
    "review",
    "trace",
    "conformance",
    "policy",
    "worktree",
    "pr",
    ...PUBLIC_LIFECYCLE_COMMANDS,
  ]) {
    if (
      !CLI_USAGE.includes(`|${command}|`) &&
      !CLI_USAGE.includes(`<${command}|`) &&
      !CLI_USAGE.includes(`|${command}>`)
    )
      errors.push(`CLI helpに公開commandがありません: ${command}`);
  }
  const expectedAliases = {
    init: "install",
    upgrade: "update",
    uninstall: "delete",
  };
  if (
    JSON.stringify(LEGACY_LIFECYCLE_ALIASES) !== JSON.stringify(expectedAliases)
  )
    errors.push("旧lifecycle aliasが公開commandへ正しく対応していません");

  const guide = fs.readFileSync(guideFile, "utf8");
  for (const command of PUBLIC_LIFECYCLE_COMMANDS) {
    const invocation = `npx ${packageName} ${command}`;
    if (!guide.includes(invocation))
      errors.push(`中央利用案内に公開commandがありません: ${invocation}`);
  }
  for (const alias of Object.keys(LEGACY_LIFECYCLE_ALIASES)) {
    const publicAlias = new RegExp(
      `npx\\s+${packageName}(?:@[^\\s]+)?\\s+${alias}(?:\\s|\x60)`,
      "u",
    );
    if (publicAlias.test(guide))
      errors.push(
        `中央利用案内が旧aliasを公開commandとして案内しています: ${alias}`,
      );
  }

  for (const relative of SPEC_FILES) {
    const file = path.resolve(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`CLI契約仕様がありません: ${relative}`);
      continue;
    }
    const specification = fs.readFileSync(file, "utf8");
    for (const command of PUBLIC_LIFECYCLE_COMMANDS)
      if (!specification.includes(`\`${command}\``))
        errors.push(`${relative}に公開commandがありません: ${command}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    commands: PUBLIC_LIFECYCLE_COMMANDS.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = checkCliContract();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
