import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  classifyMode,
  QUESTIONS,
  type Mode,
  type ModeAnswer,
  type PocDeclaration,
} from "./mode.js";
import type { HumanOverride } from "./role.js";

export const MODE_DECISION_FILE = "00_モード判定.json";
export const WORKFLOW_JOURNAL_DIRECTORY = "journal";
export const STEP_JOURNAL_BASENAME = "steps.jsonl";
export const STEP_JOURNAL_FILE = `${WORKFLOW_JOURNAL_DIRECTORY}/${STEP_JOURNAL_BASENAME}`;

export interface WorkflowStep {
  step: number;
  skillId: string;
  responsibility: string;
  artifact: string;
}

export const WORKFLOW_STEPS: readonly WorkflowStep[] = Object.freeze([
  {
    step: 0,
    skillId: "step-00-stage",
    responsibility: "モード判定と一時ステージングの原子的開始",
    artifact: "`.agent-skill-chain/tmp/issues/<timestamp>_<title>/`",
  },
  {
    step: 1,
    skillId: "step-01-request",
    responsibility: "要求定義。`quick`は計画全体を集約",
    artifact: "`00_要求定義.md`",
  },
  {
    step: 2,
    skillId: "step-02-requirements",
    responsibility: "ストーリー、受け入れ条件、ドメイン規則の定義",
    artifact: "`01_要件定義.md`",
  },
  {
    step: 3,
    skillId: "step-03-requirements-review",
    responsibility: "要求・要件の開始可能性確認",
    artifact: "開始可能性の記録と修正文書",
  },
  {
    step: 4,
    skillId: "step-04-issue-sync",
    responsibility: "開始可能性を確認した計画を1つの耐久トラッカーへ同期",
    artifact: "書き込み後読み取り確認済みトラッカー",
  },
  {
    step: 5,
    skillId: "step-05-design",
    responsibility: "依存関係、安全性、失敗、ロールバックの設計",
    artifact: "`02_設計.md`",
  },
  {
    step: 6,
    skillId: "step-06-plan",
    responsibility: "risk比例検証と最小実装の計画",
    artifact: "`03_実装計画.md`",
  },
  {
    step: 7,
    skillId: "step-07-design-review",
    responsibility: "実装開始可能性の確認",
    artifact: "開始可能性の記録と修正文書",
  },
  {
    step: 8,
    skillId: "step-08-design-sync",
    responsibility: "同じトラッカーへ設計・計画を追記",
    artifact: "書き込み後読み取り確認済みトラッカー",
  },
  {
    step: 9,
    skillId: "step-09-implement",
    responsibility: "専用worktreeで実装",
    artifact: "コード、Gherkinテスト、`docs/specs/`更新",
  },
  {
    step: 10,
    skillId: "step-10-review",
    responsibility: "exact-head最終レビュー、検証、仕様整合性",
    artifact: "実装中発見を含む有限レビューの承認証拠",
  },
  {
    step: 11,
    skillId: "step-11-pr",
    responsibility: "PRを作成しdelivery policyの終端まで進行",
    artifact: "PR URLと`waiting / merge-queued / merged`の観測証拠",
  },
]);

export const MODE_STEP_SEQUENCES: Readonly<Record<Mode, readonly number[]>> =
  Object.freeze({
    full: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    quick: Object.freeze([0, 1, 4, 9, 10, 11]),
    poc: Object.freeze([0, 1, 4, 9, 10, 11]),
  });

export const NEVER_SKIPPABLE_STEPS: readonly number[] = Object.freeze([
  0, 1, 4, 9, 10, 11,
]);

export function requiredSteps(mode: Mode): readonly number[] {
  return MODE_STEP_SEQUENCES[mode];
}

export function skippableSteps(mode: Mode): readonly number[] {
  const required = new Set(requiredSteps(mode));
  return WORKFLOW_STEPS.map(({ step }) => step).filter(
    (step) => !required.has(step),
  );
}

export interface JournalHumanOverride extends Pick<
  HumanOverride,
  "issue" | "scope" | "instructedBy" | "instructedAt" | "expiresAt"
> {
  scope: "workflow.pr.create";
  reason: string;
}

const NON_HUMAN_OVERRIDE_ISSUERS = new Set([
  "coordinator",
  "analyst",
  "implementer",
  "reviewer",
  "verifier",
  "finalizer",
  "agent",
  "ai",
  "assistant",
  "codex",
  "claude",
]);

export function validateJournalHumanOverride(input: {
  override: JournalHumanOverride;
  issue: number;
  now: string;
}): { valid: boolean; errors: string[] } {
  const parsed = parseHumanOverride(input.override, "HumanOverride");
  const errors = [...parsed.errors];
  if (input.override.issue !== input.issue)
    errors.push("HumanOverrideのIssueが対象と一致しません");
  if (
    NON_HUMAN_OVERRIDE_ISSUERS.has(
      input.override.instructedBy.trim().toLowerCase(),
    )
  )
    errors.push(
      "AI agentまたはroleによる自己発行HumanOverrideは使用できません",
    );
  const now = Date.parse(input.now);
  const instructedAt = Date.parse(input.override.instructedAt);
  const expiresAt = Date.parse(input.override.expiresAt);
  if (!Number.isFinite(now) || new Date(now).toISOString() !== input.now)
    errors.push("HumanOverride検証時刻が不正です");
  if (
    Number.isFinite(now) &&
    Number.isFinite(instructedAt) &&
    instructedAt > now
  )
    errors.push("HumanOverrideの指示日時が未来です");
  if (Number.isFinite(now) && Number.isFinite(expiresAt) && expiresAt <= now)
    errors.push("HumanOverrideは失効しています");
  return { valid: errors.length === 0, errors };
}

export interface StepJournalEntry {
  step: number;
  skillId: string;
  mode: Mode;
  recordedAt: string;
  artifacts: string[];
  evidence: string;
  humanOverride?: JournalHumanOverride;
}

export interface ModeDecision {
  mode: Mode;
  requestedMode: Mode;
  answers: Record<string, ModeAnswer>;
  changedFiles: string[];
  reasons: string[];
  decidedAt: string;
  poc?: PocDeclaration;
}

const JOURNAL_FIELDS = new Set([
  "step",
  "skillId",
  "mode",
  "recordedAt",
  "artifacts",
  "evidence",
  "humanOverride",
]);
const OVERRIDE_FIELDS = new Set([
  "issue",
  "scope",
  "instructedBy",
  "instructedAt",
  "expiresAt",
  "reason",
]);
const MODE_DECISION_FIELDS = new Set([
  "mode",
  "requestedMode",
  "answers",
  "changedFiles",
  "reasons",
  "decidedAt",
  "poc",
]);
const POC_FIELDS = new Set([
  "purpose",
  "period",
  "outOfScope",
  "successCriteria",
  "abortCriteria",
  "owner",
  "highRisk",
]);
const PERIOD_FIELDS = new Set(["from", "to"]);
const RISK_FIELDS = new Set(["id", "present", "evidence"]);

function isMode(value: unknown): value is Mode {
  return value === "quick" || value === "full" || value === "poc";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(value).filter((field) => !allowed.has(field));
}

function parseHumanOverride(
  value: unknown,
  label: string,
): { value?: JournalHumanOverride; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: [`${label}はobjectが必要です`] };
  const unknown = unknownFields(value, OVERRIDE_FIELDS);
  if (unknown.length > 0)
    errors.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  if (
    typeof value.issue !== "number" ||
    !Number.isInteger(value.issue) ||
    value.issue < 1
  )
    errors.push(`${label}.issueは正の整数が必要です`);
  if (value.scope !== "workflow.pr.create")
    errors.push(`${label}.scopeはworkflow.pr.createが必要です`);
  for (const field of ["instructedBy", "reason"] as const)
    if (!nonEmpty(value[field]))
      errors.push(`${label}.${field}は空でない文字列が必要です`);
  for (const field of ["instructedAt", "expiresAt"] as const)
    if (!isUtcInstant(value[field]))
      errors.push(`${label}.${field}はISO 8601 UTC日時が必要です`);
  if (errors.length > 0) return { errors };
  return {
    value: {
      issue: value.issue as number,
      scope: "workflow.pr.create",
      instructedBy: value.instructedBy as string,
      instructedAt: value.instructedAt as string,
      expiresAt: value.expiresAt as string,
      reason: value.reason as string,
    },
    errors,
  };
}

function parseJournalEntry(
  value: unknown,
  line: number,
): { entry?: StepJournalEntry; errors: string[] } {
  const label = `journal ${line}行目`;
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: [`${label}はobjectが必要です`] };
  const unknown = unknownFields(value, JOURNAL_FIELDS);
  if (unknown.length > 0)
    errors.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  if (
    typeof value.step !== "number" ||
    !Number.isInteger(value.step) ||
    value.step < 0 ||
    value.step > 11
  )
    errors.push(`${label}.stepは0..11の整数が必要です`);
  const definition =
    typeof value.step === "number"
      ? WORKFLOW_STEPS.find(({ step }) => step === value.step)
      : undefined;
  if (!definition || value.skillId !== definition.skillId)
    errors.push(`${label}.skillIdがstep定義と一致しません`);
  if (!isMode(value.mode)) errors.push(`${label}.modeが不正です`);
  if (!isUtcInstant(value.recordedAt))
    errors.push(`${label}.recordedAtはISO 8601 UTC日時が必要です`);
  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length === 0 ||
    !value.artifacts.every(nonEmpty)
  )
    errors.push(
      `${label}.artifactsは空でない文字列を1件以上含む配列が必要です`,
    );
  if (!nonEmpty(value.evidence))
    errors.push(`${label}.evidenceは空でない文字列が必要です`);
  const parsedOverride =
    value.humanOverride === undefined
      ? { errors: [] as string[] }
      : parseHumanOverride(value.humanOverride, `${label}.humanOverride`);
  errors.push(...parsedOverride.errors);
  if (errors.length > 0) return { errors };
  return {
    entry: {
      step: value.step as number,
      skillId: value.skillId as string,
      mode: value.mode as Mode,
      recordedAt: value.recordedAt as string,
      artifacts: [...(value.artifacts as string[])],
      evidence: value.evidence as string,
      ...(parsedOverride.value ? { humanOverride: parsedOverride.value } : {}),
    },
    errors,
  };
}

export function parseStepJournal(text: string): {
  entries: StepJournalEntry[];
  errors: string[];
} {
  const entries: StepJournalEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    try {
      const parsed = parseJournalEntry(
        parseJsonStrict(line, `journal ${index + 1}行目`),
        index + 1,
      );
      errors.push(...parsed.errors);
      if (parsed.entry) entries.push(parsed.entry);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { entries, errors };
}

function modeTransitionConflicts(
  mode: Mode,
  entries: StepJournalEntry[],
): string[] {
  const conflicts: string[] = [];
  let previous: Mode | undefined;
  for (const entry of entries) {
    if (
      previous !== undefined &&
      entry.mode !== previous &&
      !(previous !== "full" && entry.mode === "full")
    )
      conflicts.push(
        `${previous}から${entry.mode}へのモード変更は許可されません`,
      );
    previous = entry.mode;
  }
  if (previous !== undefined && previous !== mode) {
    if (!(previous !== "full" && mode === "full"))
      conflicts.push(
        `journalの最終モード${previous}と検証モード${mode}が一致しません`,
      );
  }
  return [...new Set(conflicts)];
}

export function validateStepJournal(input: {
  mode: Mode;
  entries: StepJournalEntry[];
  upToStep: number;
}): {
  valid: boolean;
  missingSteps: number[];
  unexpectedSteps: number[];
  outOfOrder: number[];
  modeConflicts: string[];
  errors: string[];
} {
  const errors: string[] = [];
  if (
    !Number.isInteger(input.upToStep) ||
    input.upToStep < 0 ||
    input.upToStep > 11
  )
    errors.push("upToStepは0..11の整数が必要です");
  const expected = requiredSteps(input.mode);
  const expectedSet = new Set(expected);
  const lastByStep = new Map<
    number,
    { entry: StepJournalEntry; index: number }
  >();
  input.entries.forEach((entry, index) =>
    lastByStep.set(entry.step, { entry, index }),
  );
  const maximum = errors.length === 0 ? input.upToStep : 11;
  const missingSteps = expected.filter(
    (step) => step <= maximum && !lastByStep.has(step),
  );
  const unexpectedSteps = [...lastByStep.keys()]
    .filter((step) => !expectedSet.has(step))
    .sort((left, right) => left - right);
  const outOfOrder: number[] = [];
  let previousIndex = -1;
  for (const step of expected) {
    const record = lastByStep.get(step);
    if (!record) continue;
    if (record.entry.humanOverride) continue;
    if (record.index < previousIndex) outOfOrder.push(step);
    else previousIndex = record.index;
  }
  const modeConflicts = modeTransitionConflicts(input.mode, input.entries);
  return {
    valid:
      errors.length === 0 &&
      missingSteps.length === 0 &&
      unexpectedSteps.length === 0 &&
      outOfOrder.length === 0 &&
      modeConflicts.length === 0,
    missingSteps,
    unexpectedSteps,
    outOfOrder,
    modeConflicts,
    errors,
  };
}

function parseAnswers(value: unknown): {
  answers?: Record<string, ModeAnswer>;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: ["answersはobjectが必要です"] };
  const expected = new Set(QUESTIONS);
  const missing = QUESTIONS.filter((id) => !(id in value));
  const unknown = Object.keys(value).filter((id) => !expected.has(id));
  if (missing.length > 0)
    errors.push(`answersに必須回答がありません: ${missing.join(", ")}`);
  if (unknown.length > 0)
    errors.push(`answersの未知fieldを拒否しました: ${unknown.join(", ")}`);
  const answers: Record<string, ModeAnswer> = {};
  for (const id of QUESTIONS) {
    const item = value[id];
    if (
      !isRecord(item) ||
      unknownFields(item, new Set(["answer", "evidence"])).length > 0
    ) {
      errors.push(`${id}はanswerとevidenceだけを持つobjectが必要です`);
      continue;
    }
    if (
      item.answer !== true &&
      item.answer !== false &&
      item.answer !== "unknown"
    )
      errors.push(`${id}.answerはbooleanまたはunknownが必要です`);
    if (!nonEmpty(item.evidence))
      errors.push(`${id}.evidenceは空でない文字列が必要です`);
    if (
      (item.answer === true ||
        item.answer === false ||
        item.answer === "unknown") &&
      typeof item.evidence === "string"
    )
      answers[id] = { answer: item.answer, evidence: item.evidence };
  }
  return errors.length === 0 ? { answers, errors } : { errors };
}

function parsePoc(value: unknown): { poc?: PocDeclaration; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: ["pocはobjectが必要です"] };
  const unknown = unknownFields(value, POC_FIELDS);
  if (unknown.length > 0)
    errors.push(`pocの未知fieldを拒否しました: ${unknown.join(", ")}`);
  for (const field of [
    "purpose",
    "outOfScope",
    "successCriteria",
    "abortCriteria",
    "owner",
  ] as const)
    if (!nonEmpty(value[field]))
      errors.push(`poc.${field}は空でない文字列が必要です`);
  if (
    !isRecord(value.period) ||
    unknownFields(value.period, PERIOD_FIELDS).length > 0
  )
    errors.push("poc.periodはfromとtoだけを持つobjectが必要です");
  else
    for (const field of ["from", "to"] as const)
      if (!nonEmpty(value.period[field]))
        errors.push(`poc.period.${field}は空でない文字列が必要です`);
  if (!Array.isArray(value.highRisk))
    errors.push("poc.highRiskは配列が必要です");
  const highRisk: PocDeclaration["highRisk"] = [];
  if (Array.isArray(value.highRisk))
    value.highRisk.forEach((item, index) => {
      if (!isRecord(item) || unknownFields(item, RISK_FIELDS).length > 0) {
        errors.push(`poc.highRisk[${index}]の構造が不正です`);
        return;
      }
      if (
        !nonEmpty(item.id) ||
        typeof item.present !== "boolean" ||
        !nonEmpty(item.evidence)
      ) {
        errors.push(`poc.highRisk[${index}]のid、present、evidenceが不正です`);
        return;
      }
      highRisk.push({
        id: item.id,
        present: item.present,
        evidence: item.evidence,
      });
    });
  if (errors.length > 0) return { errors };
  return {
    poc: {
      purpose: value.purpose as string,
      period: {
        from: (value.period as Record<string, unknown>).from as string,
        to: (value.period as Record<string, unknown>).to as string,
      },
      outOfScope: value.outOfScope as string,
      successCriteria: value.successCriteria as string,
      abortCriteria: value.abortCriteria as string,
      owner: value.owner as string,
      highRisk,
    },
    errors,
  };
}

export function renderModeDecision(input: {
  requestedMode: Mode;
  answers: Record<string, ModeAnswer>;
  decidedAt: string;
  poc?: PocDeclaration;
  changedFiles?: string[];
  currentMode?: Mode;
}): string {
  if (!isUtcInstant(input.decidedAt))
    throw new Error("decidedAtはISO 8601 UTC日時でなければなりません");
  const result = classifyMode(input.answers, {
    requestedMode: input.requestedMode,
    poc: input.poc,
    changedFiles: input.changedFiles,
    currentMode: input.currentMode,
  });
  const decision: ModeDecision = {
    mode: result.mode,
    requestedMode: input.requestedMode,
    answers: input.answers,
    changedFiles: [...(input.changedFiles ?? [])],
    reasons: result.reasons,
    decidedAt: input.decidedAt,
    ...(input.poc ? { poc: input.poc } : {}),
  };
  const parsed = parseModeDecision(stableJson(decision));
  if (!parsed.decision) throw new Error(parsed.errors.join("; "));
  return `${stableJson(decision)}\n`;
}

export function parseModeDecision(text: string): {
  decision?: ModeDecision;
  errors: string[];
} {
  const errors: string[] = [];
  let value: unknown;
  try {
    value = parseJsonStrict(text, "モード判定成果物");
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
  if (!isRecord(value))
    return { errors: ["モード判定成果物はobjectが必要です"] };
  const unknown = unknownFields(value, MODE_DECISION_FIELDS);
  if (unknown.length > 0)
    errors.push(
      `モード判定成果物の未知fieldを拒否しました: ${unknown.join(", ")}`,
    );
  if (!isMode(value.mode)) errors.push("modeが不正です");
  if (!isMode(value.requestedMode)) errors.push("requestedModeが不正です");
  if (!isUtcInstant(value.decidedAt))
    errors.push("decidedAtはISO 8601 UTC日時が必要です");
  if (
    !Array.isArray(value.reasons) ||
    !value.reasons.every((item) => typeof item === "string")
  )
    errors.push("reasonsは文字列配列が必要です");
  const parsedAnswers = parseAnswers(value.answers);
  errors.push(...parsedAnswers.errors);
  const changedFiles = value.changedFiles ?? [];
  if (
    !Array.isArray(changedFiles) ||
    !changedFiles.every((file) => nonEmpty(file))
  )
    errors.push("changedFilesは空でない文字列の配列が必要です");
  const parsedPoc =
    value.poc === undefined ? { errors: [] as string[] } : parsePoc(value.poc);
  errors.push(...parsedPoc.errors);
  if (value.mode === "poc" && !parsedPoc.poc)
    errors.push("pocモードにはPocDeclarationが必要です");
  if (parsedAnswers.answers && isMode(value.requestedMode)) {
    const classified = classifyMode(parsedAnswers.answers, {
      requestedMode: value.requestedMode,
      poc: parsedPoc.poc,
      changedFiles: Array.isArray(changedFiles)
        ? changedFiles.filter(nonEmpty)
        : [],
    });
    if (value.mode !== classified.mode)
      errors.push(`modeが既存のモード判定結果${classified.mode}と一致しません`);
    if (
      Array.isArray(value.reasons) &&
      JSON.stringify(value.reasons) !== JSON.stringify(classified.reasons)
    )
      errors.push("reasonsが既存のモード判定結果と一致しません");
  }
  if (
    errors.length > 0 ||
    !parsedAnswers.answers ||
    !isMode(value.mode) ||
    !isMode(value.requestedMode)
  )
    return { errors };
  return {
    decision: {
      mode: value.mode,
      requestedMode: value.requestedMode,
      answers: parsedAnswers.answers,
      changedFiles: [...(changedFiles as string[])],
      reasons: [...(value.reasons as string[])],
      decidedAt: value.decidedAt as string,
      ...(parsedPoc.poc ? { poc: parsedPoc.poc } : {}),
    },
    errors,
  };
}

export function inspectWorkflowStagingArtifacts(input: {
  staging: string;
  mode: Mode;
  state: string;
  modeDecisionSource?: string;
  journalSource?: string;
  upToStep?: number;
}) {
  const modeDecision =
    input.modeDecisionSource === undefined
      ? { errors: [`${MODE_DECISION_FILE}がありません`] }
      : parseModeDecision(input.modeDecisionSource);
  const journal =
    input.journalSource === undefined
      ? { entries: [], errors: [`${STEP_JOURNAL_FILE}がありません`] }
      : parseStepJournal(input.journalSource);
  const completedSteps = [...new Set(journal.entries.map(({ step }) => step))];
  const currentStep = completedSteps.at(-1);
  const validation = validateStepJournal({
    mode: input.mode,
    entries: journal.entries,
    upToStep: input.upToStep ?? currentStep ?? 0,
  });
  const completed = new Set(completedSteps);
  const nextStep = requiredSteps(input.mode).find(
    (step) => !completed.has(step),
  );
  const errors = [
    ...journal.errors,
    ...modeDecision.errors,
    ...(modeDecision.decision && modeDecision.decision.mode !== input.mode
      ? [
          `モード判定成果物のmode ${modeDecision.decision.mode}がstaging recordのmode ${input.mode}と一致しません`,
        ]
      : []),
    ...validation.errors,
  ];
  return {
    staging: input.staging,
    mode: input.mode,
    state: input.state,
    modeDecision: {
      exists: input.modeDecisionSource !== undefined,
      valid: Boolean(modeDecision.decision) && modeDecision.errors.length === 0,
      errors: modeDecision.errors,
    },
    journal: {
      exists: input.journalSource !== undefined,
      valid: journal.errors.length === 0 && validation.valid,
      errors: journal.errors,
    },
    completedSteps,
    currentStep,
    nextStep,
    validation,
    errors,
    valid:
      errors.length === 0 && Boolean(modeDecision.decision) && validation.valid,
  };
}

export function completePullRequestWorkflow<
  Created extends { url?: string },
  Recorded,
>(created: Created, staging: string, record: () => Recorded) {
  try {
    return {
      exitCode: 0,
      output: { ...created, workflow: record() },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: {
        ...created,
        workflow: {
          recorded: false,
          diagnostic: {
            ruleId: "ASC-WORKFLOW-JOURNAL-001",
            reasons: [`PR作成後のStep 11記録に失敗しました: ${reason}`],
            next: `作成済みPR ${created.url ?? "（URL不明）"} を確認し、PR作成を再実行せず、workflow record --staging=${staging} --step=11 --artifact=<PR URL> --evidence=<PR作成確認>で記録だけを再実行した後、workflow verify --staging=${staging} --up-to=11で確認してください`,
          },
        },
      },
    };
  }
}
