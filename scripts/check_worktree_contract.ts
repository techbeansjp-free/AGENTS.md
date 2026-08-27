import fs from "node:fs";
import path from "node:path";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import {
  WORKFLOW_DOCUMENT,
  extractWorktreeContract,
  renderWorktreeContract,
} from "./generate_worktree_contract.js";
import {
  WORKTREE_NAME_FORMAT,
  validateWorktreePlacement,
} from "../src/domain/worktree.js";

const GENERATOR = "node --import tsx scripts/generate_worktree_contract.ts";
const SAMPLE_TIMESTAMP = "20260826_142727";
const SAMPLE_ISSUE = 929;
const SAMPLE_SLUG = "worktree-contract-doc";

function sampleName(): string {
  return WORKTREE_NAME_FORMAT.replace("<YYYYMMDD_HHMMSS>", SAMPLE_TIMESTAMP)
    .replace("<Issue番号>", String(SAMPLE_ISSUE))
    .replace("<slug>", SAMPLE_SLUG);
}

export function checkWorktreeContract(root = process.cwd()): {
  valid: boolean;
  errors: string[];
  document: string;
} {
  const errors: string[] = [];
  const file = path.resolve(root, WORKFLOW_DOCUMENT);
  if (!fs.existsSync(file))
    return {
      valid: false,
      errors: [`${WORKFLOW_DOCUMENT}がありません`],
      document: WORKFLOW_DOCUMENT,
    };
  const current = extractWorktreeContract(fs.readFileSync(file, "utf8"));
  if (current === undefined)
    errors.push(
      `${WORKFLOW_DOCUMENT}に自動生成markerがありません。${GENERATOR}を実行してください`,
    );
  else if (current !== renderWorktreeContract())
    errors.push(
      `${WORKFLOW_DOCUMENT}の自動生成区画が正本と一致しません。${GENERATOR}を実行して差分をcommitしてください`,
    );
  const placement = validateWorktreePlacement({
    repoRoot: "/tmp/asc-contract-repository",
    worktreePath: `.worktrees/${sampleName()}`,
    branch: `bugfix/${SAMPLE_ISSUE}-${SAMPLE_SLUG}`,
    issueNumber: SAMPLE_ISSUE,
    slug: SAMPLE_SLUG,
    currentTime: new Date("2026-08-26T05:27:27.000Z"),
    existing: [],
  });
  if (
    placement.errors.some((reason) =>
      reason.includes("worktree directory名が規定書式ではありません"),
    )
  )
    errors.push(
      `正本が述べる書式をruntimeが受理しません: ${sampleName()}。${WORKTREE_NAME_FORMAT}とWORKTREE_NAMEを一致させてください`,
    );
  return { valid: errors.length === 0, errors, document: WORKFLOW_DOCUMENT };
}

if (process.argv[1] !== undefined && isExecutionEntry(import.meta.url)) {
  const result = checkWorktreeContract();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
