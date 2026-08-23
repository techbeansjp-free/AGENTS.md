import fs from "node:fs";
import path from "node:path";
import { safeSlug } from "../lib/security.js";
import { publishDirectoryAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
import {
  classifyMode,
  detectQuickDisqualifiers,
  QUESTIONS,
  type ModeAnswer,
} from "./mode.js";
import { validateDevelopmentConsiderations } from "./conformance.js";

const packageRoot = findPackageRoot(import.meta.url);
const templateRoot = path.join(
  packageRoot,
  ".agent-skill-chain",
  "templates",
  "issue",
);
const FULL_FILES = {
  "01_要件定義.md": "01_要件定義.md",
  "02_設計.md": "02_設計.md",
  "03_実装計画.md": "03_実装計画.md",
};

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

function requirementDocument(
  mode: "quick" | "full",
  title: string,
  answers: Record<string, ModeAnswer>,
): string {
  const name =
    mode === "quick" ? "00_要求定義_quick.md" : "00_要求定義_full.md";
  let content = fs.readFileSync(path.join(templateRoot, name), "utf8");
  content = content.replace(
    "| 件名 | （人が識別できる件名） |",
    `| 件名 | ${escapeCell(title)} |`,
  );
  for (const id of QUESTIONS) {
    const item = answers?.[id];
    const answer =
      item?.answer === true
        ? "true"
        : item?.answer === false
          ? "false"
          : "unknown";
    const evidence = escapeCell(item?.evidence || "根拠なし");
    content = content.replace(
      new RegExp(`\\| ${id} \\| [^|]+ \\| [^|]+ \\|`),
      `| ${id} | ${answer} | ${evidence} |`,
    );
  }
  return content;
}

function escapeCell(value: unknown): string {
  return String(value)
    .replaceAll("|", "｜")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function createIssueStaging(
  root: string,
  options: { title: string; answers: Record<string, ModeAnswer>; now?: Date },
) {
  const slug = safeSlug(options.title);
  const decision = classifyMode(options.answers);
  const finalPath = path.join(
    root,
    ".agent-skill-chain",
    "tmp",
    "issues",
    `${timestamp(options.now ?? new Date())}_${slug}`,
  );
  publishDirectoryAtomic(finalPath, (temporary) => {
    fs.writeFileSync(
      path.join(temporary, "00_要求定義.md"),
      requirementDocument(decision.mode, options.title, options.answers),
      { flag: "wx" },
    );
    if (decision.mode === "full") {
      for (const [name, template] of Object.entries(FULL_FILES))
        fs.copyFileSync(
          path.join(templateRoot, template),
          path.join(temporary, name),
          fs.constants.COPYFILE_EXCL,
        );
    }
  });
  return {
    path: finalPath,
    mode: decision.mode,
    reasons: decision.reasons,
    durable: false,
    synced: false,
  };
}

export function validateIssue(
  issuePath: string,
  options: { changedFiles?: string[] } = {},
) {
  const errors: string[] = [];
  const requirementPath = path.join(issuePath, "00_要求定義.md");
  if (!fs.existsSync(requirementPath))
    return {
      valid: false,
      mode: "full",
      errors: ["00_要求定義.mdがありません"],
    };
  const text = fs.readFileSync(requirementPath, "utf8");
  const declared: "quick" | "full" =
    /^\| モード \| `?(quick|full)`? \|$/m.exec(text)?.[1] === "quick"
      ? "quick"
      : "full";
  let mode: "quick" | "full" = declared;
  const requiredHeadings =
    declared === "quick"
      ? [
          "1. 目的、現在、期待状態（必須）",
          "2. 対象範囲と権限（必須）",
          "3. ドメイン影響（必須）",
          "4. Q-01〜Q-08の回答と根拠（必須）",
          "5. 要求、受け入れ条件、最小Gherkin（必須）",
          "6. 最小設計",
          "7. 実装とテストの計画",
          "8. P-01〜P-07の証拠",
          "9. 仕様、図表、識別子",
          "10. リスク、レビュー、再開地点",
        ]
      : [
          "1. 目的と背景",
          "2. 対象範囲",
          "3. 利害関係者と利用場面",
          "4. ドメイン影響",
          "5. 要求の概要",
          "6. 制約、前提、依存関係",
          "7. 受け入れ条件と成功基準",
          "8. リスクと安全側への縮小",
          "9. モード判定Q-01〜Q-08",
          "10. P-01〜P-07の適用計画",
          "11. 図表と識別子の判断",
          "12. 参考資料、未決事項、再開地点",
        ];
  for (const heading of requiredHeadings) {
    if (!text.includes(`## ${heading}`))
      errors.push(`必須項目がありません: ${heading}`);
  }
  const allText = [
    text,
    ...Object.keys(FULL_FILES)
      .filter((name) => fs.existsSync(path.join(issuePath, name)))
      .map((name) => fs.readFileSync(path.join(issuePath, name), "utf8")),
  ].join("\n");
  if (
    /<[^>\n]+>|\{[^}\n]+\}|（[^）\n]*(?:記載|記入|件名|名称|内容|役割|日時|ISO 8601形式|状態|結果|根拠|条件|パス|URL|SHA|値|対象)[^）\n]*）/.test(
      allText,
    )
  )
    errors.push("未解決のplaceholderが残っています");
  for (let index = 1; index <= 7; index += 1) {
    const id = `P-${String(index).padStart(2, "0")}`;
    if (!text.includes(id)) errors.push(`${id}の証拠がありません`);
  }
  if (!/Scenario:\s+SCN-[A-Z0-9-]+/.test(allText))
    errors.push("GherkinシナリオIDがありません");
  const disqualifiers = detectQuickDisqualifiers(options.changedFiles ?? []);
  if (declared === "quick" && disqualifiers.length > 0) {
    mode = "full";
    errors.push(`quickからfullへの単調昇格が必要: ${disqualifiers.join(", ")}`);
  }
  if (mode === "full") {
    for (const name of Object.keys(FULL_FILES))
      if (!fs.existsSync(path.join(issuePath, name)))
        errors.push(`fullモードには${name}が必要です`);
  }
  const considerationFiles =
    mode === "full"
      ? ["00_要求定義.md", ...Object.keys(FULL_FILES)]
      : ["00_要求定義.md"];
  for (const name of considerationFiles) {
    const file = path.join(issuePath, name);
    if (!fs.existsSync(file)) continue;
    errors.push(
      ...validateDevelopmentConsiderations(fs.readFileSync(file, "utf8"), name)
        .errors,
    );
  }
  return { valid: errors.length === 0, mode, errors };
}
