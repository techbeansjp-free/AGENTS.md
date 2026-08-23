import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProjectPolicySet } from "../src/domain/policy.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".mjs"]);
const SOURCE_FILE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".bash",
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mts",
  ".py",
  ".pyw",
  ".sh",
  ".tsx",
  ".zsh",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".agents",
  ".codex",
  "dist",
  "node_modules",
]);
const FORBIDDEN_TYPE_PATTERNS = [
  /:\s*any\b/u,
  /=\s*any\b/u,
  /\bas\s+any\b/u,
  /<\s*any\s*>/u,
  /@(?:param|returns?|type)\s*\{[^}\n]*\bany\b/u,
];
const SOURCE_SHEBANG_PATTERN =
  /^#![^\n]*(?:\b(?:node|deno|bun|python\d*|sh|bash|zsh)\b)/u;

export function validateSourceTypeSyntax(source: string): string[] {
  const errors: string[] = [];
  if (FORBIDDEN_TYPE_PATTERNS.some((pattern) => pattern.test(source)))
    errors.push("禁止された型表現があります");
  if (/@ts-(?:nocheck|ignore)\b/u.test(source))
    errors.push("型検査を迂回するdirectiveがあります");
  return errors;
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory())
      return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : walk(resolved);
    return entry.isFile() ? [resolved] : [];
  });
}

export function checkSourceQuality(root = process.cwd()) {
  const errors: string[] = [];
  const files = walk(root).filter((file) => {
    const extension = path.extname(file).toLowerCase();
    if (SOURCE_FILE_EXTENSIONS.has(extension)) return true;
    if (extension !== "") return false;
    const descriptor = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(256);
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      return SOURCE_SHEBANG_PATTERN.test(buffer.toString("utf8", 0, bytes));
    } finally {
      fs.closeSync(descriptor);
    }
  });
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const extension = path.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension))
      errors.push(
        `実装言語をTypeScriptへ集約したprojectに対象外sourceがあります: ${relative}`,
      );
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const source = fs.readFileSync(file, "utf8");
    errors.push(
      ...validateSourceTypeSyntax(source).map(
        (error) => `${error}: ${relative}`,
      ),
    );
  }
  const choices = loadProjectPolicySet(root).policy.projectChoices;
  if (choices?.quality.implementationLanguage !== "TypeScript")
    errors.push("project choiceの実装言語がTypeScriptではありません");
  if (choices?.quality.strictTypecheck !== true)
    errors.push("project choiceのstrict型検査が有効ではありません");
  if (!choices?.quality.forbiddenTypes.includes("any"))
    errors.push("project choiceに禁止型が登録されていません");
  for (const capability of [
    "privacySecurity",
    "observability",
    "humanCenteredUi",
    "designTokens",
  ] as const) {
    const decision = choices?.capabilities[capability];
    if (!decision || !decision.reason || !decision.evidence)
      errors.push(`${capability}の適用判断、理由、証拠がありません`);
  }
  for (const language of ["python", "shell"]) {
    const decision = choices?.quality.auxiliaryLanguages[language];
    if (
      decision?.status !== "not-applicable" ||
      !decision.reason ||
      !decision.evidence
    )
      errors.push(`${language}の対象外理由と証拠がありません`);
  }
  return { valid: errors.length === 0, errors, files: files.length };
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
  const result = checkSourceQuality(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
