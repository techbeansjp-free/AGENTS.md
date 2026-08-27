import fs from "node:fs";
import path from "node:path";

import { isExecutionEntry } from "../src/lib/entrypoint.js";

const INDEX = ".agent-skill-chain/00_利用案内.md";
const STEP_PREFIXES = Array.from(
  { length: 12 },
  (_, index) => `step-${String(index).padStart(2, "0")}-`,
);
const ENTRY_DOCUMENTS = new Map([
  [".agent-skill-chain", INDEX],
  [".agent-skill-chain/docs", ".agent-skill-chain/docs/00_運用ポリシー.md"],
  [".agent-skill-chain/policy", ".agent-skill-chain/policy/00_利用案内.md"],
  [".agent-skill-chain/project", INDEX],
  [".agent-skill-chain/project/choices", INDEX],
  [".agent-skill-chain/project/conformance", INDEX],
  [".agent-skill-chain/project/providers", INDEX],
  [".agent-skill-chain/project/rules", INDEX],
  [".agent-skill-chain/schemas", ".agent-skill-chain/schemas/00_利用案内.md"],
  [".agent-skill-chain/skills", ".agent-skill-chain/skills/00_利用案内.md"],
  [
    ".agent-skill-chain/skills/asc-step",
    ".agent-skill-chain/skills/asc-step/SKILL.md",
  ],
  [
    ".agent-skill-chain/templates",
    ".agent-skill-chain/templates/00_利用案内.md",
  ],
  [
    ".agent-skill-chain/templates/common",
    ".agent-skill-chain/templates/common/02_利用案内.md",
  ],
  [
    ".agent-skill-chain/templates/issue",
    ".agent-skill-chain/templates/issue/12_利用案内.md",
  ],
  [
    ".agent-skill-chain/templates/specs",
    ".agent-skill-chain/templates/specs/00_利用案内.md",
  ],
]);

const GUIDE_DOCUMENTS = [
  INDEX,
  ".agent-skill-chain/policy/00_利用案内.md",
  ".agent-skill-chain/schemas/00_利用案内.md",
  ".agent-skill-chain/skills/00_利用案内.md",
  ".agent-skill-chain/templates/00_利用案内.md",
  ".agent-skill-chain/templates/common/02_利用案内.md",
  ".agent-skill-chain/templates/issue/12_利用案内.md",
  ".agent-skill-chain/templates/specs/00_利用案内.md",
];
const REQUIRED_GUIDE_HEADINGS = [
  "## 目的",
  "## ownerと編集",
  "## 使い方",
  "## 置かないもの",
  "## 正本",
];
const FIXED_MARKDOWN_DIRECTORIES = [
  "docs/specs",
  ".agent-skill-chain/templates/specs",
] as const;
export const FIXED_MARKDOWN_NAME_EXCEPTIONS = new Set([
  "AGENTS.md",
  "SKILL.md",
  "README.md",
]);
const JAPANESE_FILE_NAME = /[\u3040-\u30ff\u3400-\u9fff]/u;

export function validateFixedMarkdownName(name: string): string[] {
  if (FIXED_MARKDOWN_NAME_EXCEPTIONS.has(name)) return [];
  const errors: string[] = [];
  if (!/^\d{2}_/u.test(name)) errors.push("2桁の連番prefixがありません");
  if (!JAPANESE_FILE_NAME.test(name)) errors.push("日本語名を含みません");
  return errors;
}

export function checkFixedMarkdownNames(root = process.cwd()): string[] {
  const errors: string[] = [];
  const visit = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      if (entry.isSymbolicLink()) {
        if (entry.name.endsWith(".md"))
          errors.push(`固定Markdownはsymlinkにできません: ${relative}`);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      for (const reason of validateFixedMarkdownName(entry.name))
        errors.push(`固定Markdownの名称が不正です: ${relative} (${reason})`);
    }
  };
  for (const relative of FIXED_MARKDOWN_DIRECTORIES)
    visit(path.join(root, relative));
  return errors;
}

function actualDirectories(root: string): string[] {
  const namespace = path.resolve(root, ".agent-skill-chain");
  if (!fs.existsSync(namespace)) return [];
  const visit = (directory: string): string[] => {
    const relative = path.relative(root, directory).replaceAll(path.sep, "/");
    if (
      [
        ".agent-skill-chain/tmp",
        ".agent-skill-chain/role-log",
        ".agent-skill-chain/metrics",
      ].includes(relative)
    )
      return [directory];
    return [
      directory,
      ...fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink()) return [];
        return visit(path.join(directory, entry.name));
      }),
    ];
  };
  return visit(namespace)
    .map((directory) =>
      path.relative(root, directory).replaceAll(path.sep, "/"),
    )
    .sort();
}

function entryFor(directory: string, root: string): string | undefined {
  if (ENTRY_DOCUMENTS.has(directory)) return ENTRY_DOCUMENTS.get(directory);
  if (
    [
      ".agent-skill-chain/tmp",
      ".agent-skill-chain/role-log",
      ".agent-skill-chain/metrics",
    ].some(
      (prefix) => directory === prefix || directory.startsWith(`${prefix}/`),
    )
  )
    return INDEX;
  if (directory.startsWith(".agent-skill-chain/skills/step-")) {
    const name = path.posix.basename(directory);
    const prefix = STEP_PREFIXES.find((item) => name.startsWith(item));
    if (prefix) return `${directory}/SKILL.md`;
  }
  if (directory.startsWith(".agent-skill-chain/templates/specs/")) {
    const absolute = path.resolve(root, directory);
    const candidates = fs.existsSync(absolute)
      ? fs
          .readdirSync(absolute)
          .filter((name) => /^00_.+\.md$/u.test(name))
          .sort((left, right) => left.localeCompare(right, "ja"))
      : [];
    if (candidates.length === 1) return `${directory}/${candidates[0]}`;
  }
  return undefined;
}

function localLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/gu)]
    .map((match) => match[1])
    .filter((link) => !/^(?:https?:|mailto:|#)/u.test(link));
}

export function checkDirectoryGuides(root = process.cwd()) {
  const errors: string[] = [];
  errors.push(...checkFixedMarkdownNames(root));
  const directories = actualDirectories(root);
  const entries = new Map<string, string>();
  for (const directory of directories) {
    const entry = entryFor(directory, root);
    if (!entry) {
      errors.push(`入口文書が未定義です: ${directory}`);
      continue;
    }
    entries.set(directory, entry);
    const absolute = path.resolve(root, entry);
    if (!fs.existsSync(absolute)) {
      errors.push(`入口文書がありません: ${directory} -> ${entry}`);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink())
      errors.push(`入口文書は通常fileでなければなりません: ${entry}`);
  }

  const namespaceRoot = path.resolve(root, ".agent-skill-chain");
  for (const guide of GUIDE_DOCUMENTS) {
    const absolute = path.resolve(root, guide);
    if (!fs.existsSync(absolute)) continue;
    const markdown = fs.readFileSync(absolute, "utf8");
    for (const heading of REQUIRED_GUIDE_HEADINGS)
      if (!markdown.includes(heading))
        errors.push(`利用案内に必須見出しがありません: ${guide} -> ${heading}`);
    for (const link of localLinks(markdown)) {
      const target = path.resolve(
        path.dirname(absolute),
        decodeURIComponent(link.split("#")[0]),
      );
      if (
        target !== path.resolve(root, "AGENTS.md") &&
        target !== namespaceRoot &&
        !target.startsWith(`${namespaceRoot}${path.sep}`)
      ) {
        errors.push(
          `利用案内のlinkがpackage案内境界外です: ${guide} -> ${link}`,
        );
        continue;
      }
      if (!fs.existsSync(target)) {
        errors.push(`利用案内のlink先がありません: ${guide} -> ${link}`);
        continue;
      }
      const real = fs.realpathSync(target);
      const realRoot = fs.realpathSync(root);
      if (
        real !== path.join(realRoot, "AGENTS.md") &&
        !real.startsWith(
          `${path.join(realRoot, ".agent-skill-chain")}${path.sep}`,
        )
      )
        errors.push(
          `利用案内のlink先がsymlinkで境界外です: ${guide} -> ${link}`,
        );
    }
  }

  const indexFile = path.resolve(root, INDEX);
  if (fs.existsSync(indexFile)) {
    const index = fs.readFileSync(indexFile, "utf8");
    for (const directory of [
      ".agent-skill-chain/project/",
      ".agent-skill-chain/project/choices/",
      ".agent-skill-chain/project/providers/",
      ".agent-skill-chain/project/rules/",
      ".agent-skill-chain/project/conformance/",
    ]) {
      if (!index.includes(`\`${directory}\``))
        errors.push(
          `中央索引にproject所有directoryの説明がありません: ${directory}`,
        );
    }
    for (const phrase of [
      "完全inventory",
      "Markdownを混在させない",
      "非規範的な索引",
    ])
      if (!index.includes(phrase))
        errors.push(`中央索引に所有境界の説明がありません: ${phrase}`);
  }

  const specsGuide = path.resolve(
    root,
    ".agent-skill-chain/templates/specs/00_利用案内.md",
  );
  if (fs.existsSync(specsGuide)) {
    const links = new Set(
      localLinks(fs.readFileSync(specsGuide, "utf8")).map((link) =>
        path.posix.dirname(link),
      ),
    );
    for (const directory of directories.filter((item) =>
      item.startsWith(".agent-skill-chain/templates/specs/"),
    )) {
      const relative = path.posix.relative(
        ".agent-skill-chain/templates/specs",
        directory,
      );
      if (!links.has(relative))
        errors.push(
          `仕様template利用案内からcategory入口へのlinkがありません: ${directory}`,
        );
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    directories: directories.length,
    guides: GUIDE_DOCUMENTS.length,
    entries: Object.fromEntries(entries),
  };
}

if (isExecutionEntry(import.meta.url)) {
  const result = checkDirectoryGuides();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
