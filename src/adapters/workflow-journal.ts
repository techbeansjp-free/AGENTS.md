import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  refreshStoredStagingDigest,
  readStoredStagingRecord,
} from "../domain/staging.js";
import {
  MODE_DECISION_FILE,
  parseStepJournal,
  STEP_JOURNAL_FILE,
  inspectWorkflowStagingArtifacts,
  validateStepJournal,
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../domain/workflow.js";
import type { Mode } from "../domain/mode.js";

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function assertWorkflowStaging(staging: string): string {
  const resolved = path.resolve(staging);
  const parent = path.dirname(resolved);
  if (
    path.basename(parent) !== "issues" ||
    path.basename(path.dirname(parent)) !== "tmp" ||
    path.basename(path.dirname(path.dirname(parent))) !==
      ".agent-skill-chain" ||
    path.basename(resolved).includes("..")
  )
    throw new Error(
      "--stagingは.agent-skill-chain/tmp/issues/直下のdirectoryが必要です",
    );
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("--stagingはsymlinkでない通常directoryが必要です");
  if (fs.realpathSync(resolved) !== resolved)
    throw new Error("--stagingにsymlink祖先を使用できません");
  return resolved;
}

export function readWorkflowJournal(staging: string): {
  mode: Mode;
  entries: StepJournalEntry[];
  errors: string[];
  source: string;
} {
  const resolved = assertWorkflowStaging(staging);
  const record = readStoredStagingRecord(resolved);
  const journal = path.join(resolved, STEP_JOURNAL_FILE);
  if (!fs.existsSync(journal))
    return {
      mode: record.mode,
      entries: [],
      errors: [`${STEP_JOURNAL_FILE}がありません`],
      source: "",
    };
  const source = fs.readFileSync(journal, "utf8");
  const parsed = parseStepJournal(source);
  return { mode: record.mode, ...parsed, source };
}

export function appendWorkflowJournalEntry(input: {
  staging: string;
  entry: StepJournalEntry;
}): { entry: StepJournalEntry; journalDigest: string; stagingDigest: string } {
  const staging = assertWorkflowStaging(input.staging);
  const current = readWorkflowJournal(staging);
  if (current.errors.length > 0)
    throw new Error(
      `journalの追記前検査に失敗しました: ${current.errors.join("; ")}`,
    );
  if (input.entry.mode !== current.mode)
    throw new Error(
      `entry mode ${input.entry.mode}がstaging mode ${current.mode}と一致しません`,
    );
  const line = `${JSON.stringify(input.entry)}\n`;
  const parsedProposed = parseStepJournal(`${current.source}${line}`);
  if (parsedProposed.errors.length > 0)
    throw new Error(
      `journal entryの構造検査に失敗しました: ${parsedProposed.errors.join("; ")}`,
    );
  const validation = validateStepJournal({
    mode: current.mode,
    entries: parsedProposed.entries,
    upToStep: input.entry.step,
  });
  if (!validation.valid)
    throw new Error(
      `journalの追記を拒否しました: missingSteps=${validation.missingSteps.join(",")}; unexpectedSteps=${validation.unexpectedSteps.join(",")}; outOfOrder=${validation.outOfOrder.join(",")}; modeConflicts=${validation.modeConflicts.join("; ")}; errors=${validation.errors.join("; ")}`,
    );
  const expectedDigest = sha256(`${current.source}${line}`);
  const journal = path.join(staging, STEP_JOURNAL_FILE);
  fs.appendFileSync(journal, line, { encoding: "utf8", mode: 0o600 });
  const reread = fs.readFileSync(journal);
  const journalDigest = sha256(reread);
  if (journalDigest !== expectedDigest)
    throw new Error("journalの書き込み後読み取りdigestが一致しません");
  const stored = refreshStoredStagingDigest(staging);
  return { entry: input.entry, journalDigest, stagingDigest: stored.digest };
}

export function inspectWorkflowStaging(staging: string, upToStep?: number) {
  const resolved = assertWorkflowStaging(staging);
  const record = readStoredStagingRecord(resolved);
  const modeFile = path.join(resolved, MODE_DECISION_FILE);
  const journalFile = path.join(resolved, STEP_JOURNAL_FILE);
  return inspectWorkflowStagingArtifacts({
    staging: resolved,
    mode: record.mode,
    state: record.state,
    ...(fs.existsSync(modeFile)
      ? { modeDecisionSource: fs.readFileSync(modeFile, "utf8") }
      : {}),
    ...(fs.existsSync(journalFile)
      ? { journalSource: fs.readFileSync(journalFile, "utf8") }
      : {}),
    ...(upToStep === undefined ? {} : { upToStep }),
  });
}

export function workflowStep(step: number) {
  return WORKFLOW_STEPS.find((definition) => definition.step === step);
}

export function resolvePullRequestStaging(input: {
  root: string;
  staging?: string;
  issue: number;
}): string {
  if (input.staging) return assertWorkflowStaging(input.staging);
  const issuesRoot = path.join(
    path.resolve(input.root),
    ".agent-skill-chain",
    "tmp",
    "issues",
  );
  if (!fs.existsSync(issuesRoot))
    throw new Error("PR作成に必要なIssue staging directoryがありません");
  const candidates = fs
    .readdirSync(issuesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(issuesRoot, entry.name))
    .filter((candidate) => {
      try {
        const record = readStoredStagingRecord(candidate);
        return (
          record.tracker === `#${input.issue}` ||
          record.tracker === String(input.issue) ||
          record.tracker?.endsWith(`/issues/${input.issue}`) === true
        );
      } catch {
        return false;
      }
    });
  if (candidates.length !== 1)
    throw new Error(
      "PR作成対象のIssue stagingを一意に解決できません。--stagingで明示してください",
    );
  return assertWorkflowStaging(candidates[0] as string);
}
