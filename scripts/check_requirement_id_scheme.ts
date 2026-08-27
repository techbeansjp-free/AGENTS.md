import fs from "node:fs";
import path from "node:path";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

export const REQUIREMENT_ID_PREFIX = "REQ";
export const ACCEPTANCE_ID_PREFIX = "AC";
export const REQUIREMENT_DOMAIN_PLACEHOLDER = "{domain}";
export const REQUIREMENT_ID_SEQUENCE_DIGITS = 3;

const DOMAIN = `(?:[A-Z][A-Z0-9]*|${REQUIREMENT_DOMAIN_PLACEHOLDER.replace(/[{}]/gu, "\\$&")})`;
const SEQUENCE = `(?:[0-9]{${REQUIREMENT_ID_SEQUENCE_DIGITS},}|\\{[^}]+\\}|\\.\\.\\.)`;
// 連番のないREQ-WFのようなtokenは、context略号そのものを指す散文参照として許可する。
const VALID_REQUIREMENT = new RegExp(
  `^${REQUIREMENT_ID_PREFIX}-${DOMAIN}(?:-${SEQUENCE})?$`,
  "u",
);
const VALID_ACCEPTANCE = new RegExp(
  `^${ACCEPTANCE_ID_PREFIX}-${DOMAIN}(?:-${SEQUENCE})?$`,
  "u",
);
const TOKEN_TAIL =
  "(?:\\{[^}]+\\}|[A-Za-z0-9]+)(?:-(?:[0-9]+|\\{[^}]+\\}|\\.\\.\\.))?";
const REQUIREMENT_LIKE = new RegExp(
  `(?<![A-Za-z0-9-])(?:REQ|FR|NFR)-${TOKEN_TAIL}`,
  "gu",
);
const ACCEPTANCE_LIKE = new RegExp(`(?<![A-Za-z0-9-])AC-${TOKEN_TAIL}`, "gu");

export const REQUIREMENT_TEMPLATES = [
  ".agent-skill-chain/templates/specs/02_要件/00_要件一覧.md",
  ".agent-skill-chain/templates/specs/02_要件/01_受け入れ条件.md",
  ".agent-skill-chain/templates/specs/11_非機能/00_非機能要件一覧.md",
  ".agent-skill-chain/templates/specs/15_要件追跡/00_追跡表.md",
  ".agent-skill-chain/templates/specs/04_機能/01_個別機能テンプレート.md",
] as const;

export function checkRequirementIdScheme(root = process.cwd()): {
  valid: boolean;
  errors: string[];
  documents: number;
} {
  const errors: string[] = [];
  for (const relative of REQUIREMENT_TEMPLATES) {
    const file = path.resolve(root, relative);
    if (!fs.existsSync(file)) {
      errors.push(`${relative}がありません`);
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    for (const matched of text.matchAll(REQUIREMENT_LIKE)) {
      const token = matched[0];
      if (!VALID_REQUIREMENT.test(token))
        errors.push(
          `${relative}の要件IDが規定体系ではありません: ${token}。${REQUIREMENT_ID_PREFIX}-${REQUIREMENT_DOMAIN_PLACEHOLDER}-${"0".repeat(REQUIREMENT_ID_SEQUENCE_DIGITS)}の形式にしてください`,
        );
    }
    for (const matched of text.matchAll(ACCEPTANCE_LIKE)) {
      const token = matched[0];
      if (!VALID_ACCEPTANCE.test(token))
        errors.push(
          `${relative}の受け入れ条件IDが規定体系ではありません: ${token}。${ACCEPTANCE_ID_PREFIX}-${REQUIREMENT_DOMAIN_PLACEHOLDER}-${"0".repeat(REQUIREMENT_ID_SEQUENCE_DIGITS)}の形式にしてください`,
        );
    }
  }
  const guide = path.resolve(root, REQUIREMENT_TEMPLATES[0]);
  if (fs.existsSync(guide)) {
    const text = fs.readFileSync(guide, "utf8");
    for (const phrase of [
      "要件IDの決め方",
      "Issue番号や課題番号をIDに使わない",
      "変更頻度と所有責務が安定する単位",
      "再利用しない",
    ])
      if (!text.includes(phrase))
        errors.push(
          `${REQUIREMENT_TEMPLATES[0]}にdomainの決め方の記述がありません: ${phrase}`,
        );
  }
  return {
    valid: errors.length === 0,
    errors,
    documents: REQUIREMENT_TEMPLATES.length,
  };
}

if (process.argv[1] !== undefined && isExecutionEntry(import.meta.url)) {
  const result = checkRequirementIdScheme();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
