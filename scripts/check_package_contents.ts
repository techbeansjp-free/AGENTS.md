import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { isExecutionEntry } from "../src/lib/entrypoint.js";
import { checkConsumerAcceptance } from "./check_consumer_acceptance.js";

const root = path.resolve(import.meta.dirname, "..");
/**
 * 配布対象から除外するrepository相対prefix。
 * 一時ライフサイクル領域の整合検査が参照するため、複製せず参照させる目的でexportする。
 */
export const FORBIDDEN_DISTRIBUTION_PREFIXES: readonly string[] = Object.freeze(
  [
    "test/",
    ".github/",
    "scripts/",
    "docs/specs/",
    "node_modules/",
    "memo/",
    ".agent-skill-chain/tmp/",
    ".agent-skill-chain/role-log/",
    ".agent-skill-chain/metrics/",
    ".agent-skill-chain/project/",
    "secret-fixtures/",
  ],
);
const forbiddenPrefixes = FORBIDDEN_DISTRIBUTION_PREFIXES;
const forbiddenFiles = new Set([
  "cucumber.mjs",
  "tsconfig.json",
  "tsconfig.build.json",
  "eslint.config.mjs",
  "test-execution.log",
  ".agent-skill-chain/project-policy.json",
]);
const secretKey =
  /^(?:token|password|secret|api[_-]?key|apikey|databaseurl|connectionstring|privatekey|authorization)$/iu;
const secretText =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{20,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@|["']?(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey)["']?\s*[=:]\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|(?![/[{(])[A-Za-z0-9._+~-]{8,})/iu;

function run(command: string, args: string[], cwd = root, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: "utf8" });
}

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(current)
      : entry.isFile()
        ? [current]
        : [];
  });
}

function matchesManifest(file: string, entries: string[]): boolean {
  return (
    file === "package.json" ||
    entries.some(
      (entry) =>
        file === entry.replace(/\/$/u, "") ||
        file.startsWith(`${entry.replace(/\/$/u, "")}/`),
    )
  );
}

function sensitive(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return (
    name.startsWith(".env") ||
    /(?:^|[._-])(?:credentials?|secrets?|auth|client-secrets?)(?:$|[._-])/u.test(
      stem,
    ) ||
    /\.(?:pem|key|p12|pfx)$/u.test(name)
  );
}

function structuredSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(structuredSecret);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) => secretKey.test(key) || structuredSecret(item),
  );
}

function contentSensitive(contents: Buffer): boolean {
  const text = contents.toString("utf8");
  if (secretText.test(text)) return true;
  try {
    return structuredSecret(JSON.parse(text) as unknown);
  } catch {
    return false;
  }
}

export function checkPackageContents(): {
  valid: boolean;
  errors: string[];
  files: number;
} {
  const errors: string[] = [];
  const tracked = run("git", ["ls-files"]);
  if (tracked.status !== 0)
    return { valid: false, errors: [tracked.stderr], files: 0 };
  for (const file of tracked.stdout.split(/\r?\n/u))
    if (file === "memo" || file.startsWith("memo/") || file.includes("/memo/"))
      errors.push(`memoディレクトリはGit管理外にしてください: ${file}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "asc-npm-pack-"));
  try {
    const cache = path.join(temporary, "cache");
    const artifact = path.join(temporary, "artifact");
    const extracted = path.join(temporary, "extracted");
    fs.mkdirSync(artifact);
    fs.mkdirSync(extracted);
    const packed = run(
      "npm",
      ["pack", "--json", "--ignore-scripts", `--pack-destination=${artifact}`],
      root,
      { ...process.env, npm_config_cache: cache },
    );
    if (packed.error)
      return {
        valid: false,
        errors: [`npm packを実行できません: ${packed.error.message}`],
        files: 0,
      };
    if (packed.status !== 0)
      return { valid: false, errors: [packed.stderr], files: 0 };
    const report = JSON.parse(packed.stdout) as Array<{
      files: Array<{ path: string }>;
      filename: string;
    }>;
    const files = report[0]?.files.map((entry) => entry.path) ?? [];
    const archive = report[0]?.filename
      ? path.join(artifact, report[0].filename)
      : "";
    if (!archive || !fs.existsSync(archive))
      return {
        valid: false,
        errors: ["artifactを一意に取得できません"],
        files: files.length,
      };
    // 必須fileの名前だけでは壊れたbinや大規模時の停止を見逃すため、
    // この検査が作った同一tarballを利用者と同じ公開入口から観測する。
    const consumerAcceptance = checkConsumerAcceptance({
      tarballPath: archive,
      sourceRepositoryRoot: root,
      temporaryStagingRoot: path.join(root, ".agent-skill-chain", "tmp"),
      mechanisms: ["packed-bin", "scale-output"],
    });
    if (!consumerAcceptance.accepted) {
      for (const reason of consumerAcceptance.reasons)
        errors.push(`consumer acceptance: ${reason}`);
      for (const mechanism of consumerAcceptance.mechanisms)
        if (mechanism.status !== "accepted")
          errors.push(
            `consumer acceptance (${mechanism.mechanism}): ${mechanism.reasons.join(" / ")}`,
          );
    }
    const unpacked = run("tar", ["-xzf", archive, "-C", extracted]);
    if (unpacked.status !== 0)
      return { valid: false, errors: [unpacked.stderr], files: files.length };
    const metadata = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { files?: string[] };
    for (const file of files) {
      if (
        forbiddenFiles.has(file) ||
        forbiddenPrefixes.some((prefix) => file.startsWith(prefix)) ||
        file.includes("/memo/") ||
        sensitive(file) ||
        !matchesManifest(file, metadata.files ?? [])
      )
        errors.push(`開発専用ファイルが配布物へ混入しています: ${file}`);
    }
    for (const file of walk(path.join(extracted, "package")))
      if (contentSensitive(fs.readFileSync(file)))
        errors.push(
          `配布fileの実contentに秘密patternがあります: ${path.relative(path.join(extracted, "package"), file).replaceAll(path.sep, "/")}`,
        );
    const required = new Set([
      "package.json",
      "dist/bin/agent-skill-chain.js",
      "README.md",
      "AGENTS.md",
      ".agent-skill-chain/00_利用案内.md",
      ".agent-skill-chain/docs/00_運用ポリシー.md",
      ".agent-skill-chain/docs/01_開発ワークフロー.md",
      ".agent-skill-chain/docs/02_品質基準.md",
      ".agent-skill-chain/policy/00_利用案内.md",
      ".agent-skill-chain/schemas/00_利用案内.md",
      ".agent-skill-chain/skills/00_利用案内.md",
      ".agent-skill-chain/skills/asc-step/SKILL.md",
      ".agent-skill-chain/templates/00_利用案内.md",
      ".agent-skill-chain/templates/common/02_利用案内.md",
      ".agent-skill-chain/templates/issue/12_利用案内.md",
      ".agent-skill-chain/templates/specs/00_利用案内.md",
      ".agent-skill-chain/schemas/project-policy.schema.json",
      ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
      ".agent-skill-chain/schemas/project-choice.schema.json",
      ".agent-skill-chain/schemas/project-rule.schema.json",
      ".agent-skill-chain/schemas/project-conformance-binding.schema.json",
      ".agent-skill-chain/schemas/conformance-contract.schema.json",
      ".agent-skill-chain/schemas/workflow-mode-decision.schema.json",
      ".agent-skill-chain/schemas/workflow-step-journal.schema.json",
      ".agent-skill-chain/schemas/poc-observation.schema.json",
      ".agent-skill-chain/policy/default.json",
      ".agent-skill-chain/policy/conformance.json",
    ]);
    for (const file of required)
      if (!files.includes(file))
        errors.push(`必須実行資産が不足しています: ${file}`);
    return { valid: errors.length === 0, errors, files: files.length };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// importされただけで npm pack を起動しないよう、実行entryのときだけ検査する。
if (isExecutionEntry(import.meta.url)) {
  const result = checkPackageContents();
  if (!result.valid) {
    process.stderr.write(
      `パッケージ内容検査: 失敗\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else
    process.stdout.write(
      `パッケージ内容検査: 合格（実行・配布ファイル${result.files}件、project policy・role log・開発計測・test fixture・秘密情報は除外）\n`,
    );
}
