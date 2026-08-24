import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;
const latin = /[A-Za-z]/gu;
const inlineCode = /`[^`]*`/gu;
const url = /https?:\/\/\S+/gu;
const directories = [
  ".agent-skill-chain/skills",
  ".agent-skill-chain/templates",
  ".agent-skill-chain/docs",
  ".agent-skill-chain/policy",
  ".agent-skill-chain/schemas",
  "docs/specs",
  "docs/reviews",
];
const rootDocuments = ["AGENTS.md", ".agent-skill-chain/00_利用案内.md"];

function walkMarkdown(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(current);
    return entry.isFile() && entry.name.endsWith(".md") ? [current] : [];
  });
}

function markdownFiles(root: string): string[] {
  const files = rootDocuments
    .map((name) => path.join(root, name))
    .filter((file) => fs.existsSync(file));
  for (const directory of directories)
    files.push(...walkMarkdown(path.join(root, directory)));
  return [...new Set(files)].sort((left, right) =>
    left.localeCompare(right, "ja"),
  );
}

function humanText(line: string): string {
  return line
    .replace(inlineCode, "")
    .replace(url, "")
    .replace(/[\s#>*_|:[\]().,/0-9-]+/gu, " ")
    .trim();
}

export function checkJapaneseDocuments(root = repositoryRoot): string[] {
  const files = markdownFiles(root);
  if (files.length === 0) return ["検査対象のMarkdown文書がありません"];
  const errors: string[] = [];
  for (const file of files) {
    let inCode = false;
    let inFrontmatter = false;
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const number = index + 1;
      let stripped = line.trim();
      if (number === 1 && stripped === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (stripped === "---") {
          inFrontmatter = false;
          continue;
        }
        if (stripped.startsWith("description:")) {
          stripped = stripped.slice("description:".length).trim();
          if (new Set([">", ">-", ">+", "|", "|-", "|+"]).has(stripped)) {
            errors.push(
              `${relative}:${number}: descriptionは検査可能な単一行で記述し、block scalarを使用しないでください`,
            );
            continue;
          }
        } else continue;
      }
      if (stripped.startsWith("```") || stripped.startsWith("~~~")) {
        inCode = !inCode;
        continue;
      }
      if (inCode || stripped.length === 0 || stripped.startsWith("<!--"))
        continue;
      const text = humanText(stripped);
      if ((text.match(latin)?.length ?? 0) >= 12 && !japanese.test(text))
        errors.push(
          `${relative}:${number}: 人が読む見出し・本文を日本語で記述してください`,
        );
    }
  }
  return errors;
}

if (
  import.meta.url ===
  new URL(`file://${path.resolve(process.argv[1] ?? "")}`).href
) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : repositoryRoot;
  const errors = checkJapaneseDocuments(root);
  if (errors.length > 0) {
    process.stderr.write(
      `日本語文書形式検査: 失敗\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else
    process.stdout.write(
      "日本語文書形式検査: 合格（人向けMarkdownの英語本文なし）\n",
    );
}
