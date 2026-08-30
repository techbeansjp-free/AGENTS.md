import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  calculateStagingDigest,
  finalizeStoredStagingPromotion,
  listStagingArtifacts,
  promoteStoredStagingModeToFull,
  refreshStoredStagingDigest,
  readStoredStagingRecord,
  STAGING_RECORD_FILE,
  STAGING_PROMOTION_TRANSACTION_FILE as PROMOTION_TRANSACTION_FILE,
  withStagingMutationLock,
} from "../domain/staging.js";
import {
  MODE_DECISION_FILE,
  parseModeDecision,
  parseStepJournal,
  renderModeDecision,
  STEP_JOURNAL_FILE,
  inspectWorkflowStagingArtifacts,
  validateStepJournal,
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../domain/workflow.js";
import {
  assessImplementationDiscovery,
  parseImplementationDiscoveryInput,
  type ImplementationDiscovery,
} from "../domain/agile-verification.js";
import {
  MODE_QUESTIONS,
  type Mode,
  type ModeAnswer,
  type PocDeclaration,
} from "../domain/mode.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  DELIVERY_STATE_FILE,
  parseDeliveryState,
} from "../domain/delivery-state.js";

const packageRoot = findPackageRoot(import.meta.url);
const issueTemplateRoot = path.join(
  packageRoot,
  ".agent-skill-chain",
  "templates",
  "issue",
);
const FULL_PLAN_ARTIFACTS = Object.freeze([
  "01_要件定義.md",
  "02_設計.md",
  "03_実装計画.md",
]);
const PROMOTION_DISCOVERY_FILE = "09_実装中発見_full昇格.json";

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
  if (input.entry.step === 11)
    throw new Error(
      "Step 11はdelivery終端専用です。汎用journal追記では記録できません",
    );
  const staging = assertWorkflowStaging(input.staging);
  return withStagingMutationLock(staging, () =>
    appendWorkflowJournalEntryLocked(staging, input.entry),
  );
}

export function appendDeliveryTerminalJournalEntry(input: {
  staging: string;
  entry: StepJournalEntry;
}): { entry: StepJournalEntry; journalDigest: string; stagingDigest: string } {
  if (input.entry.step !== 11)
    throw new Error("delivery終端journal追記はStep 11だけを記録できます");
  const staging = assertWorkflowStaging(input.staging);
  return withStagingMutationLock(staging, () =>
    appendWorkflowJournalEntryLocked(staging, input.entry),
  );
}

function appendWorkflowJournalEntryLocked(
  staging: string,
  entry: StepJournalEntry,
): { entry: StepJournalEntry; journalDigest: string; stagingDigest: string } {
  const current = readWorkflowJournal(staging);
  if (current.errors.length > 0)
    throw new Error(
      `journalの追記前検査に失敗しました: ${current.errors.join("; ")}`,
    );
  if (entry.mode !== current.mode)
    throw new Error(
      `entry mode ${entry.mode}がstaging mode ${current.mode}と一致しません`,
    );
  const line = `${JSON.stringify(entry)}\n`;
  const parsedProposed = parseStepJournal(`${current.source}${line}`);
  if (parsedProposed.errors.length > 0)
    throw new Error(
      `journal entryの構造検査に失敗しました: ${parsedProposed.errors.join("; ")}`,
    );
  const validation = validateStepJournal({
    mode: current.mode,
    entries: parsedProposed.entries,
    upToStep: entry.step,
  });
  if (!validation.valid)
    throw new Error(
      `journalの追記を拒否しました: missingSteps=${validation.missingSteps.join(",")}; unexpectedSteps=${validation.unexpectedSteps.join(",")}; outOfOrder=${validation.outOfOrder.join(",")}; modeConflicts=${validation.modeConflicts.join("; ")}; errors=${validation.errors.join("; ")}`,
    );
  const expectedDigest = sha256(`${current.source}${line}`);
  const journal = path.join(staging, STEP_JOURNAL_FILE);
  fs.appendFileSync(journal, line, { encoding: "utf8", mode: 0o600 });
  const journalDescriptor = fs.openSync(journal, "r");
  try {
    fs.fsyncSync(journalDescriptor);
  } finally {
    fs.closeSync(journalDescriptor);
  }
  const reread = fs.readFileSync(journal);
  const journalDigest = sha256(reread);
  if (journalDigest !== expectedDigest)
    throw new Error("journalの書き込み後読み取りdigestが一致しません");
  const stored = refreshStoredStagingDigest(staging);
  return { entry, journalDigest, stagingDigest: stored.digest };
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

function escapedCell(value: string): string {
  return value
    .replaceAll("|", "｜")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

function assertRegularContainedFile(staging: string, file: string): void {
  const absolute = path.join(staging, file);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`昇格元成果物はsymlinkでない通常fileが必要です: ${file}`);
  if (fs.realpathSync(absolute) !== absolute)
    throw new Error(`昇格元成果物にsymlink祖先を使用できません: ${file}`);
}

function appendEvidence(
  current: ModeAnswer | undefined,
  evidence: string,
): ModeAnswer {
  const existing = current?.evidence?.trim();
  return {
    answer: false,
    evidence: existing ? `${existing}; ${evidence}` : evidence,
  };
}

function promotedModeDecision(input: {
  previousMode: "quick" | "poc";
  decision: NonNullable<ReturnType<typeof parseModeDecision>["decision"]>;
  discovery: ImplementationDiscovery;
  promotedAt: string;
}): string {
  const answers = Object.fromEntries(
    Object.entries(input.decision.answers).map(([id, answer]) => [
      id,
      { ...answer },
    ]),
  );
  const poc: PocDeclaration | undefined = input.decision.poc
    ? {
        ...input.decision.poc,
        period: { ...input.decision.poc.period },
        highRisk: input.decision.poc.highRisk.map((risk) => ({ ...risk })),
      }
    : undefined;

  const questionByDisqualifier = new Map(
    MODE_QUESTIONS.map(({ id, disqualifier }) => [disqualifier, id]),
  );
  const quickQuestion = (disqualifier: string): string | undefined =>
    questionByDisqualifier.get(disqualifier) ??
    (["personal-data", "confidential-data", "external-exposure"].includes(
      disqualifier,
    )
      ? "Q-03"
      : undefined);
  const setPocRisk = (id: string, evidence: string): void => {
    if (!poc) throw new Error("PoC昇格には元のPoC宣言が必要です");
    const existing = poc.highRisk.find((risk) => risk.id === id);
    if (existing) {
      existing.present = true;
      existing.evidence = `${existing.evidence}; ${evidence}`;
    } else poc.highRisk.push({ id, present: true, evidence });
  };

  if (input.previousMode === "quick") {
    for (const disqualifier of input.discovery.modeDisqualifiers) {
      const question = quickQuestion(disqualifier.id);
      if (!question)
        throw new Error(
          `quick昇格理由をQ-01〜Q-08へ写像できません: ${disqualifier.id}`,
        );
      answers[question] = appendEvidence(
        answers[question],
        `実装中発見 ${disqualifier.id}: ${disqualifier.evidence}`,
      );
    }
    if (input.discovery.expandsSecurityBoundary)
      answers["Q-03"] = appendEvidence(
        answers["Q-03"],
        "実装中発見でsecurity境界の拡大を確認した",
      );
    if (input.discovery.introducesIrreversibleOperation)
      answers["Q-06"] = appendEvidence(
        answers["Q-06"],
        "実装中発見で不可逆操作の導入を確認した",
      );
  } else {
    for (const disqualifier of input.discovery.modeDisqualifiers)
      setPocRisk(disqualifier.id, `実装中発見: ${disqualifier.evidence}`);
    if (input.discovery.expandsSecurityBoundary)
      setPocRisk(
        "external-exposure",
        "実装中発見でsecurity境界の拡大を確認した",
      );
    if (input.discovery.introducesIrreversibleOperation)
      setPocRisk(
        "irreversible-operation",
        "実装中発見で不可逆操作の導入を確認した",
      );
  }

  const rendered = renderModeDecision({
    requestedMode: input.decision.requestedMode,
    answers,
    decidedAt: input.promotedAt,
    ...(poc ? { poc } : {}),
    changedFiles: input.decision.changedFiles,
  });
  const parsed = parseModeDecision(rendered);
  if (!parsed.decision || parsed.decision.mode !== "full")
    throw new Error(
      `昇格後のモード判定をfullとして再現できません: ${parsed.errors.join("; ")}`,
    );
  return rendered;
}

function tableValue(source: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^\\|[ \\t]*${escaped}[ \\t]*\\|[ \\t]*([^|]+?)[ \\t]*\\|[ \\t]*$`,
    "mu",
  )
    .exec(source)?.[1]
    ?.trim();
}

function replaceTableValue(
  source: string,
  label: string,
  value: string,
): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return source.replace(
    new RegExp(`^\\|[ \\t]*${escaped}[ \\t]*\\|[^\\n|]+\\|[ \\t]*$`, "mu"),
    `| ${label} | ${escapedCell(value)} |`,
  );
}

function promotedRequirementDocument(input: {
  previousMode: "quick" | "poc";
  previousSource: string;
  tracker: string | null;
  promotedAt: string;
  decision: NonNullable<ReturnType<typeof parseModeDecision>["decision"]>;
  backupArtifact: string;
}): string {
  let source = fs.readFileSync(
    path.join(issueTemplateRoot, "00_要求定義_full.md"),
    "utf8",
  );
  for (const label of ["件名", "仕様の所有箇所"] as const) {
    const value = tableValue(input.previousSource, label);
    if (value) source = replaceTableValue(source, label, value);
  }
  source = replaceTableValue(
    source,
    "正本",
    input.tracker ?? "未同期（full昇格後にStep 4/8で同期する）",
  );
  source = replaceTableValue(source, "作成・更新日", input.promotedAt);
  for (const [id, answer] of Object.entries(input.decision.answers)) {
    const renderedAnswer =
      answer.answer === true
        ? "true"
        : answer.answer === false
          ? "false"
          : "unknown";
    source = source.replace(
      new RegExp(
        `^\\|[ \\t]*${id}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`,
        "mu",
      ),
      `| ${id} | ${renderedAnswer} | ${escapedCell(answer.evidence ?? "根拠なし")} |`,
    );
  }
  const note = `> ${input.previousMode}からfullへ単調昇格した。昇格前の集約契約は\`${input.backupArtifact}\`に保持し、変更された契約部分だけをこの文書と01〜03へ再確定する。`;
  return source.replace("\n\n## 0. 管理情報", `\n\n${note}\n\n## 0. 管理情報`);
}

interface PromotionTransaction {
  schemaVersion: "agent-skill-chain/full-promotion-transaction/v1";
  pid: number;
  previousMode: "quick" | "poc";
  originalRecordSource: string;
  originalDecisionSource: string;
  originalRequirementSource: string;
  absentArtifacts: string[];
}

function parsePromotionTransaction(source: string): PromotionTransaction {
  const value = parseJsonStrict(source, PROMOTION_TRANSACTION_FILE);
  if (!isRecord(value)) throw new Error("full昇格transactionが不正です");
  const fields = new Set([
    "schemaVersion",
    "pid",
    "previousMode",
    "originalRecordSource",
    "originalDecisionSource",
    "originalRequirementSource",
    "absentArtifacts",
  ]);
  const unknown = Object.keys(value).filter((field) => !fields.has(field));
  const missing = [...fields].filter((field) => !(field in value));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error("full昇格transactionのfield集合が不正です");
  if (
    value.schemaVersion !== "agent-skill-chain/full-promotion-transaction/v1" ||
    !Number.isInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    (value.previousMode !== "quick" && value.previousMode !== "poc") ||
    typeof value.originalRecordSource !== "string" ||
    typeof value.originalDecisionSource !== "string" ||
    typeof value.originalRequirementSource !== "string" ||
    !Array.isArray(value.absentArtifacts) ||
    !value.absentArtifacts.every((item) => typeof item === "string")
  )
    throw new Error("full昇格transactionの値が不正です");
  const originalRecord = parseJsonStrict(
    value.originalRecordSource as string,
    "full昇格transaction.originalRecordSource",
  );
  const originalDecision = parseModeDecision(
    value.originalDecisionSource as string,
  );
  if (
    !isRecord(originalRecord) ||
    originalRecord.schemaVersion !== "agent-skill-chain/staging-record/v1" ||
    originalRecord.mode !== value.previousMode ||
    !originalDecision.decision ||
    originalDecision.decision.mode !== value.previousMode
  )
    throw new Error("full昇格transactionの復元元契約が不正です");
  const allowed = new Set([
    ...FULL_PLAN_ARTIFACTS,
    `00_要求定義_昇格前_${value.previousMode}.md`,
    `00_モード判定_昇格前_${value.previousMode}.json`,
    PROMOTION_DISCOVERY_FILE,
  ]);
  const absentArtifacts = [...(value.absentArtifacts as string[])];
  if (
    new Set(absentArtifacts).size !== absentArtifacts.length ||
    absentArtifacts.some((artifact) => !allowed.has(artifact))
  )
    throw new Error("full昇格transactionの復旧対象が不正です");
  return {
    schemaVersion: value.schemaVersion,
    pid: value.pid as number,
    previousMode: value.previousMode,
    originalRecordSource: value.originalRecordSource,
    originalDecisionSource: value.originalDecisionSource,
    originalRequirementSource: value.originalRequirementSource,
    absentArtifacts,
  };
}

function parsePersistedPromotionDiscovery(source: string): {
  previousMode: "quick" | "poc";
  promotedAt: string;
  discovery: ImplementationDiscovery;
  assessment: ReturnType<typeof assessImplementationDiscovery>;
} {
  const value = parseJsonStrict(source, PROMOTION_DISCOVERY_FILE);
  if (!isRecord(value))
    throw new Error("full昇格Evidenceがobjectではありません");
  const expected = new Set([
    "schemaVersion",
    "promotedAt",
    "previousMode",
    "selectedDisposition",
    "discovery",
    "assessment",
  ]);
  if (
    Object.keys(value).some((field) => !expected.has(field)) ||
    [...expected].some((field) => !(field in value))
  )
    throw new Error("full昇格Evidenceのfield集合が不正です");
  if (
    value.schemaVersion !== "agent-skill-chain/implementation-discovery/v1" ||
    (value.previousMode !== "quick" && value.previousMode !== "poc") ||
    value.selectedDisposition !== "promote-to-full" ||
    typeof value.promotedAt !== "string" ||
    !Number.isFinite(Date.parse(value.promotedAt)) ||
    new Date(Date.parse(value.promotedAt)).toISOString() !== value.promotedAt
  )
    throw new Error("full昇格Evidenceの管理値が不正です");
  const discovery = parseImplementationDiscoveryInput(value.discovery);
  if (discovery.workflowMode !== value.previousMode)
    throw new Error("full昇格EvidenceのpreviousModeと発見modeが一致しません");
  const assessment = assessImplementationDiscovery(discovery);
  const promotable =
    (value.previousMode === "quick" &&
      assessment.disposition === "promote-to-full") ||
    (value.previousMode === "poc" &&
      assessment.disposition === "stop-or-promote-full");
  if (!promotable || stableJson(value.assessment) !== stableJson(assessment))
    throw new Error("full昇格Evidenceから昇格判定を再現できません");
  return {
    previousMode: value.previousMode,
    promotedAt: value.promotedAt,
    discovery,
    assessment,
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function fsyncFile(file: string): void {
  const descriptor = fs.openSync(file, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeExclusiveAtomic(destination: string, source: string): void {
  const temporary = path.join(
    path.dirname(path.dirname(destination)),
    `.full-promotion-${path.basename(path.dirname(destination))}-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  fs.writeFileSync(temporary, source, { flag: "wx", mode: 0o600 });
  try {
    const descriptor = fs.openSync(temporary, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.linkSync(temporary, destination);
    fsyncDirectory(path.dirname(destination));
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function recoverPromotionTransaction(staging: string): void {
  const transactionPath = path.join(staging, PROMOTION_TRANSACTION_FILE);
  const transaction = parsePromotionTransaction(
    fs.readFileSync(transactionPath, "utf8"),
  );
  writeFileAtomic(
    path.join(staging, "00_要求定義.md"),
    transaction.originalRequirementSource,
  );
  writeFileAtomic(
    path.join(staging, MODE_DECISION_FILE),
    transaction.originalDecisionSource,
  );
  writeFileAtomic(
    path.join(staging, STAGING_RECORD_FILE),
    transaction.originalRecordSource,
  );
  for (const artifact of transaction.absentArtifacts) {
    const target = path.join(staging, artifact);
    if (!fs.existsSync(target)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(
        `full昇格rollback対象が通常fileではありません: ${artifact}`,
      );
    fs.unlinkSync(target);
  }
  for (const entry of fs.readdirSync(staging))
    if (entry.includes(`.tmp-${transaction.pid}-`)) {
      const target = path.join(staging, entry);
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink() && stat.isFile()) fs.unlinkSync(target);
    }
  fs.unlinkSync(transactionPath);
  const restored = readStoredStagingRecord(staging);
  if (restored.mode !== transaction.previousMode)
    throw new Error("full昇格transactionのrollback確認に失敗しました");
}

function promotionResult(input: {
  previousMode: "quick" | "poc";
  promoted: ReturnType<typeof readStoredStagingRecord>;
  assessment: ReturnType<typeof assessImplementationDiscovery>;
}) {
  if (
    input.promoted.mode !== "full" ||
    (input.promoted.state !== "local-active" &&
      input.promoted.state !== "promotion-active")
  )
    throw new Error("full昇格後のstaging状態が不正です");
  return {
    previousMode: input.previousMode,
    mode: "full" as const,
    state: input.promoted.state,
    tracker: input.promoted.tracker,
    backupArtifact: `00_要求定義_昇格前_${input.previousMode}.md`,
    modeDecisionBackupArtifact: `00_モード判定_昇格前_${input.previousMode}.json`,
    discoveryArtifact: PROMOTION_DISCOVERY_FILE,
    affectedArtifacts: Object.freeze([
      "00_要求定義.md",
      ...FULL_PLAN_ARTIFACTS,
    ]),
    nextSteps: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]),
    assessment: input.assessment,
  };
}

export interface WorkflowStagingPromotion {
  previousMode: "quick" | "poc";
  mode: "full";
  state: "local-active" | "promotion-active";
  tracker: string | null;
  backupArtifact: string;
  modeDecisionBackupArtifact: string;
  discoveryArtifact: string;
  affectedArtifacts: readonly string[];
  nextSteps: readonly number[];
  assessment: ReturnType<typeof assessImplementationDiscovery>;
}

export interface WorkflowStagingPromotionPreview {
  state: "preview";
  operation: "promote-full";
  previousMode: "quick" | "poc";
  targetMode: "full";
  tracker: string | null;
  affectedArtifacts: readonly string[];
  assessment: ReturnType<typeof assessImplementationDiscovery>;
  next: string;
}

export function previewWorkflowStagingPromotion(input: {
  staging: string;
  discovery: ImplementationDiscovery;
}): WorkflowStagingPromotionPreview {
  const staging = assertWorkflowStaging(input.staging);
  const deliveryStatePath = path.join(staging, DELIVERY_STATE_FILE);
  if (fs.existsSync(deliveryStatePath)) {
    assertRegularContainedFile(staging, DELIVERY_STATE_FILE);
    const delivery = parseDeliveryState(
      fs.readFileSync(deliveryStatePath, "utf8"),
    );
    throw new Error(
      `delivery開始後のstagingはfull昇格できません: state=${delivery.state}`,
    );
  }
  const current = readStoredStagingRecord(staging);
  if (current.mode === "full")
    throw new Error("stagingは既にfullであり、再昇格できません");
  if (input.discovery.workflowMode !== current.mode)
    throw new Error(
      `発見入力mode ${input.discovery.workflowMode}がstaging mode ${current.mode}と一致しません`,
    );
  const artifacts = listStagingArtifacts(staging);
  if (
    stableJson(artifacts) !== stableJson(current.artifacts) ||
    calculateStagingDigest(staging, artifacts) !== current.digest
  )
    throw new Error(
      "昇格前の成果物一覧またはdigestがstaging記録と一致しません",
    );
  const assessment = assessImplementationDiscovery(input.discovery);
  const promotable =
    (current.mode === "quick" &&
      assessment.disposition === "promote-to-full") ||
    (current.mode === "poc" &&
      assessment.disposition === "stop-or-promote-full");
  if (!promotable)
    throw new Error(
      `実装中発見の判定${assessment.disposition}はfull昇格を要求していません`,
    );
  return {
    state: "preview",
    operation: "promote-full",
    previousMode: current.mode,
    targetMode: "full",
    tracker: current.tracker,
    affectedArtifacts: Object.freeze([
      "00_要求定義.md",
      ...FULL_PLAN_ARTIFACTS,
    ]),
    assessment,
    next: "内容を確認し、適用する場合は同じ入力で--applyを指定してください",
  };
}

/**
 * 実装中発見のpure assessmentを、同じIssue staging上の耐久的なfull昇格へ適用する。
 * PoCではこのcommandの明示実行自体を「停止ではなくfull昇格を選んだ」証拠とする。
 */
export function promoteWorkflowStagingToFull(input: {
  staging: string;
  discovery: ImplementationDiscovery;
  promotedAt: string;
}): WorkflowStagingPromotion {
  const staging = assertWorkflowStaging(input.staging);
  return withStagingMutationLock(staging, () =>
    promoteWorkflowStagingToFullLocked({ ...input, staging }),
  );
}

function promoteWorkflowStagingToFullLocked(input: {
  staging: string;
  discovery: ImplementationDiscovery;
  promotedAt: string;
}): WorkflowStagingPromotion {
  const staging = assertWorkflowStaging(input.staging);
  const deliveryStatePath = path.join(staging, DELIVERY_STATE_FILE);
  if (fs.existsSync(deliveryStatePath)) {
    assertRegularContainedFile(staging, DELIVERY_STATE_FILE);
    const delivery = parseDeliveryState(
      fs.readFileSync(deliveryStatePath, "utf8"),
    );
    throw new Error(
      `delivery開始後のstagingはfull昇格できません: state=${delivery.state}`,
    );
  }
  const transactionPath = path.join(staging, PROMOTION_TRANSACTION_FILE);
  if (fs.existsSync(transactionPath)) {
    assertRegularContainedFile(staging, PROMOTION_TRANSACTION_FILE);
    const pending = parsePromotionTransaction(
      fs.readFileSync(transactionPath, "utf8"),
    );
    if (pending.pid !== process.pid && processIsAlive(pending.pid))
      throw new Error(`別process（pid=${pending.pid}）がfull昇格を実行中です`);
    recoverPromotionTransaction(staging);
  }

  const recordPath = path.join(staging, STAGING_RECORD_FILE);
  const decisionPath = path.join(staging, MODE_DECISION_FILE);
  for (const file of [
    STAGING_RECORD_FILE,
    MODE_DECISION_FILE,
    "00_要求定義.md",
    STEP_JOURNAL_FILE,
  ])
    assertRegularContainedFile(staging, file);
  const recoveredRecord = readStoredStagingRecord(staging);
  if (recoveredRecord.mode === "full") {
    const actualArtifacts = listStagingArtifacts(staging);
    if (
      stableJson(actualArtifacts) !== stableJson(recoveredRecord.artifacts) ||
      calculateStagingDigest(staging, actualArtifacts) !==
        recoveredRecord.digest
    )
      throw new Error("commit済みfull昇格の成果物またはdigestが一致しません");
    const discoveryPath = path.join(staging, PROMOTION_DISCOVERY_FILE);
    if (!fs.existsSync(discoveryPath))
      throw new Error("stagingは既にfullであり、再昇格できません");
    assertRegularContainedFile(staging, PROMOTION_DISCOVERY_FILE);
    const persisted = parsePersistedPromotionDiscovery(
      fs.readFileSync(discoveryPath, "utf8"),
    );
    if (stableJson(persisted.discovery) !== stableJson(input.discovery))
      throw new Error(
        "再実行した発見入力が永続化済み昇格Evidenceと一致しません",
      );
    const backupArtifact = `00_モード判定_昇格前_${persisted.previousMode}.json`;
    assertRegularContainedFile(staging, backupArtifact);
    const backupDecision = parseModeDecision(
      fs.readFileSync(path.join(staging, backupArtifact), "utf8"),
    );
    const canonicalDecision = parseModeDecision(
      fs.readFileSync(decisionPath, "utf8"),
    );
    if (
      !backupDecision.decision ||
      backupDecision.decision.mode !== persisted.previousMode ||
      !canonicalDecision.decision ||
      canonicalDecision.decision.mode !== "full" ||
      canonicalDecision.decision.requestedMode !==
        backupDecision.decision.requestedMode
    )
      throw new Error("永続化済み昇格のモード判定履歴を再現できません");
    return promotionResult({
      previousMode: persisted.previousMode,
      promoted: recoveredRecord,
      assessment: persisted.assessment,
    });
  }
  const originalRecordSource = fs.readFileSync(recordPath, "utf8");
  const originalDecisionSource = fs.readFileSync(decisionPath, "utf8");
  const current = readStoredStagingRecord(staging);
  if (current.mode === "full")
    throw new Error("stagingは既にfullであり、再昇格できません");
  if (input.discovery.workflowMode !== current.mode)
    throw new Error(
      `発見入力mode ${input.discovery.workflowMode}がstaging mode ${current.mode}と一致しません`,
    );
  const parsedDecision = parseModeDecision(originalDecisionSource);
  if (!parsedDecision.decision || parsedDecision.errors.length > 0)
    throw new Error(
      `昇格前のモード判定成果物が不正です: ${parsedDecision.errors.join("; ")}`,
    );
  if (parsedDecision.decision.mode !== current.mode)
    throw new Error("昇格前のモード判定成果物とstaging modeが一致しません");
  const actualArtifacts = listStagingArtifacts(staging);
  if (stableJson(actualArtifacts) !== stableJson(current.artifacts))
    throw new Error("昇格前の成果物一覧がstaging記録と一致しません");
  if (calculateStagingDigest(staging, actualArtifacts) !== current.digest)
    throw new Error("昇格前のcontent digestがstaging記録と一致しません");
  const assessment = assessImplementationDiscovery(input.discovery);
  const promotable =
    (current.mode === "quick" &&
      assessment.disposition === "promote-to-full") ||
    (current.mode === "poc" &&
      assessment.disposition === "stop-or-promote-full");
  if (!promotable)
    throw new Error(
      `実装中発見の判定${assessment.disposition}はfull昇格を要求していません`,
    );

  const previousRequirementPath = path.join(staging, "00_要求定義.md");
  const previousRequirementSource = fs.readFileSync(
    previousRequirementPath,
    "utf8",
  );
  const backupArtifact = `00_要求定義_昇格前_${current.mode}.md`;
  const backupPath = path.join(staging, backupArtifact);
  const modeDecisionBackupArtifact = `00_モード判定_昇格前_${current.mode}.json`;
  const modeDecisionBackupPath = path.join(staging, modeDecisionBackupArtifact);
  const discoveryPath = path.join(staging, PROMOTION_DISCOVERY_FILE);
  for (const target of [backupPath, modeDecisionBackupPath, discoveryPath])
    if (fs.existsSync(target))
      throw new Error(`昇格成果物が既に存在するため上書きしません: ${target}`);

  const fullDecision = promotedModeDecision({
    previousMode: current.mode,
    decision: parsedDecision.decision,
    discovery: input.discovery,
    promotedAt: input.promotedAt,
  });
  const parsedFullDecision = parseModeDecision(fullDecision);
  if (!parsedFullDecision.decision)
    throw new Error(parsedFullDecision.errors.join("; "));
  const promotedRequirement = promotedRequirementDocument({
    previousMode: current.mode,
    previousSource: previousRequirementSource,
    tracker: current.tracker,
    promotedAt: input.promotedAt,
    decision: parsedFullDecision.decision,
    backupArtifact,
  });
  const newArtifacts = [
    backupArtifact,
    modeDecisionBackupArtifact,
    PROMOTION_DISCOVERY_FILE,
    ...FULL_PLAN_ARTIFACTS,
  ];
  const absentArtifacts = newArtifacts.filter(
    (artifact) => !fs.existsSync(path.join(staging, artifact)),
  );
  const transaction: PromotionTransaction = {
    schemaVersion: "agent-skill-chain/full-promotion-transaction/v1",
    pid: process.pid,
    previousMode: current.mode,
    originalRecordSource,
    originalDecisionSource,
    originalRequirementSource: previousRequirementSource,
    absentArtifacts,
  };
  writeExclusiveAtomic(transactionPath, `${stableJson(transaction)}\n`);
  let committed = false;
  try {
    if (
      fs.readFileSync(recordPath, "utf8") !== originalRecordSource ||
      fs.readFileSync(decisionPath, "utf8") !== originalDecisionSource ||
      fs.readFileSync(previousRequirementPath, "utf8") !==
        previousRequirementSource
    )
      throw new Error("昇格適用直前にstagingのmode状態が変化しました");
    const lockedArtifacts = listStagingArtifacts(staging).filter(
      (artifact) => artifact !== PROMOTION_TRANSACTION_FILE,
    );
    if (
      stableJson(lockedArtifacts) !== stableJson(current.artifacts) ||
      calculateStagingDigest(staging, lockedArtifacts) !== current.digest
    )
      throw new Error("昇格lock取得後にstaging成果物が変化しました");
    writeFileAtomic(backupPath, previousRequirementSource);
    writeFileAtomic(modeDecisionBackupPath, originalDecisionSource);
    writeFileAtomic(previousRequirementPath, promotedRequirement);
    for (const artifact of FULL_PLAN_ARTIFACTS) {
      const destination = path.join(staging, artifact);
      if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile())
          throw new Error(`full成果物が通常fileではありません: ${artifact}`);
        continue;
      }
      fs.copyFileSync(
        path.join(issueTemplateRoot, artifact),
        destination,
        fs.constants.COPYFILE_EXCL,
      );
    }
    writeFileAtomic(
      discoveryPath,
      `${stableJson({
        schemaVersion: "agent-skill-chain/implementation-discovery/v1",
        promotedAt: input.promotedAt,
        previousMode: current.mode,
        selectedDisposition: "promote-to-full",
        discovery: input.discovery,
        assessment,
      })}\n`,
    );
    writeFileAtomic(decisionPath, fullDecision);
    const promoted = promoteStoredStagingModeToFull(staging);
    if (!promoted.artifacts.includes(PROMOTION_TRANSACTION_FILE))
      throw new Error("full昇格記録にtransaction markerがありません");
    const finalized = finalizeStoredStagingPromotion(staging);
    for (const artifact of finalized.artifacts)
      fsyncFile(path.join(staging, artifact));
    fsyncFile(recordPath);
    fsyncDirectory(staging);
    fs.unlinkSync(transactionPath);
    committed = true;
    fsyncDirectory(staging);
    const verifiedArtifacts = listStagingArtifacts(staging);
    if (
      stableJson(verifiedArtifacts) !== stableJson(finalized.artifacts) ||
      calculateStagingDigest(staging, verifiedArtifacts) !== finalized.digest
    )
      throw new Error("full昇格commit後の成果物またはdigestが一致しません");
    return promotionResult({
      previousMode: current.mode,
      promoted: finalized,
      assessment,
    });
  } catch (error) {
    let rollbackError: unknown;
    if (!committed && fs.existsSync(transactionPath)) {
      try {
        recoverPromotionTransaction(staging);
      } catch (rollback) {
        rollbackError = rollback;
      }
    }
    if (rollbackError)
      throw new Error(
        `full昇格に失敗しrollbackも完了できませんでした: ${error instanceof Error ? error.message : String(error)}; rollback=${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
    throw error;
  }
}

export function resolvePullRequestStaging(input: {
  root: string;
  staging?: string;
  issue: number;
  repository: string;
}): string {
  const trackerMatches = (staging: string): boolean => {
    const tracker = readStoredStagingRecord(staging).tracker;
    const matched =
      typeof tracker === "string"
        ? /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9]\d*)$/iu.exec(
            tracker,
          )
        : null;
    return Boolean(
      matched &&
      `${matched[1]}/${matched[2]}`.toLowerCase() ===
        input.repository.toLowerCase() &&
      Number(matched[3]) === input.issue,
    );
  };
  const issuesRoot = path.join(
    path.resolve(input.root),
    ".agent-skill-chain",
    "tmp",
    "issues",
  );
  if (input.staging) {
    const requested = path.resolve(input.staging);
    if (path.dirname(requested) !== issuesRoot)
      throw new Error(
        "明示stagingは対象rootの.agent-skill-chain/tmp/issues/直下にあるdirectoryが必要です",
      );
    const staging = assertWorkflowStaging(requested);
    if (!trackerMatches(staging))
      throw new Error(
        "明示stagingのtrackerが対象repository・Issueと一致しません",
      );
    return staging;
  }
  if (!fs.existsSync(issuesRoot))
    throw new Error("PR作成に必要なIssue staging directoryがありません");
  const candidates = fs
    .readdirSync(issuesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(issuesRoot, entry.name))
    .filter((candidate) => {
      try {
        return trackerMatches(candidate);
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
