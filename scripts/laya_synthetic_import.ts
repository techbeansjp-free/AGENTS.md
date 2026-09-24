import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeLayaArtifact } from "../src/adapters/laya-artifact-store.js";
import {
  createTeacherView,
  digestLayaArtifact,
  LAYA_ACTIONS,
  LAYA_SEVERITY,
  LAYA_VALIDITY,
  questionIdsForCase,
  type LayaDecisionCase,
  type LayaEvidence,
  type LayaQuestionId,
  type LayaTrainingManifest,
  type SealedSplit,
  type TeacherAssessment,
  validateTeacherAssessment,
} from "../src/domain/laya-decision-training.js";
import {
  createLayaTrainingArtifactBindings,
  digestLayaTrainingInput,
  validateLayaTrainingDatasets,
  type LayaTrainingRow,
} from "../src/domain/laya-training-contract.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";
import {
  parseJsonStrict,
  resolveContained,
  stableJson,
} from "../src/lib/security.js";

const LOCAL_RUN_ROOT = ".agent-skill-chain/local/laya-runs";
const SHA40 = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYNTHETIC_PATH = /^synthetic\/[A-Za-z0-9._/-]+$/u;
const SOURCE_IDENTITY =
  /(?:https?:\/\/|git@|github\.com|\/(?:Users|home|Volumes)\/|[A-Z]:\\|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/iu;
const ENVIRONMENT_DIGEST =
  "0795cbc6120e9d75db2ff77390ac0b82ab4a59de9d1ccbfe8a15acdad032426e";

interface SyntheticProblem {
  caseId: string;
  groupId: string;
  workflow: "general" | "distribution";
  claim: string;
  evidence: Array<{
    path: string;
    lineStart: number;
    lineEnd: number;
    excerpt: string;
  }>;
}

interface SyntheticProblemSet {
  schemaVersion: "asc/laya-synthetic-problem-set/v1";
  sourceCommit: string;
  createdAt: string;
  cases: SyntheticProblem[];
  split: SealedSplit;
  sealDigest: string;
}

export interface TeacherSet {
  schemaVersion: "asc/laya-teacher-assessment-set/v1";
  teacher: "codex" | "opus";
  assessments: TeacherAssessment[];
}

export interface SyntheticTeacherPacket {
  caseId: string;
  questionId: LayaQuestionId;
  claim: string;
  evidence: LayaEvidence[];
  allowedChoices: readonly string[];
  splitDigest: string;
  sealDigest: string;
  partition: "train" | "validation";
  purpose: "train-label";
}

interface RawSyntheticTeacherAnswer {
  caseId: string;
  questionId: LayaQuestionId;
  answer: string;
  confidence: number;
  evidenceReason: string;
}

export interface SyntheticImportResult {
  manifest: LayaTrainingManifest;
  trainSource: string;
  validationSource: string;
  split: SealedSplit;
  codex: TeacherSet;
  opus: TeacherSet;
  report: {
    schemaVersion: "asc/laya-synthetic-import-report/v1";
    authority: false;
    problemCount: number;
    trainRowCount: number;
    validationRowCount: number;
    excludedQuestionCount: number;
    sealDigest: string;
    splitDigest: string;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}はobjectが必要です`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  )
    throw new Error(`${label}のfieldが契約と一致しません`);
}

function artifactSha(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(`${stableJson(value)}\n`)
    .digest("hex");
}

function sourceSha(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function parseProblemSet(
  input: unknown,
  expectedCount: number,
): {
  value: SyntheticProblemSet;
  decisionCases: LayaDecisionCase[];
} {
  const value = record(input, "synthetic problem set");
  exactKeys(
    value,
    [
      "schemaVersion",
      "sourceCommit",
      "createdAt",
      "cases",
      "split",
      "sealDigest",
    ],
    "synthetic problem set",
  );
  if (
    value.schemaVersion !== "asc/laya-synthetic-problem-set/v1" ||
    typeof value.sourceCommit !== "string" ||
    !SHA40.test(value.sourceCommit) ||
    typeof value.createdAt !== "string" ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    typeof value.sealDigest !== "string" ||
    !DIGEST.test(value.sealDigest) ||
    !Array.isArray(value.cases) ||
    value.cases.length !== expectedCount
  )
    throw new Error(
      `synthetic problem setは${expectedCount}件の固定入力が必要です`,
    );
  const cases = value.cases.map((inputCase, index) => {
    const item = record(inputCase, `synthetic cases[${index}]`);
    exactKeys(
      item,
      ["caseId", "groupId", "workflow", "claim", "evidence"],
      `synthetic cases[${index}]`,
    );
    if (
      typeof item.caseId !== "string" ||
      !SAFE_ID.test(item.caseId) ||
      typeof item.groupId !== "string" ||
      !SAFE_ID.test(item.groupId) ||
      (item.workflow !== "general" && item.workflow !== "distribution") ||
      typeof item.claim !== "string" ||
      !Array.isArray(item.evidence) ||
      item.evidence.length === 0
    )
      throw new Error(`synthetic cases[${index}]が不正です`);
    for (const [evidenceIndex, rawEvidence] of item.evidence.entries()) {
      const evidence = record(
        rawEvidence,
        `synthetic cases[${index}].evidence[${evidenceIndex}]`,
      );
      exactKeys(
        evidence,
        ["path", "lineStart", "lineEnd", "excerpt"],
        `synthetic cases[${index}].evidence[${evidenceIndex}]`,
      );
      if (
        typeof evidence.path !== "string" ||
        !SYNTHETIC_PATH.test(evidence.path) ||
        !Number.isSafeInteger(evidence.lineStart) ||
        !Number.isSafeInteger(evidence.lineEnd) ||
        (evidence.lineStart as number) < 1 ||
        (evidence.lineEnd as number) < (evidence.lineStart as number) ||
        typeof evidence.excerpt !== "string" ||
        evidence.excerpt.trim().length === 0
      )
        throw new Error("synthetic evidenceが不正です");
    }
    const syntheticCase = item as unknown as SyntheticProblem;
    if (
      SOURCE_IDENTITY.test(
        stableJson({
          claim: syntheticCase.claim,
          evidence: syntheticCase.evidence,
        }),
      )
    )
      throw new Error("synthetic problemにsource identity候補があります");
    const decisionCase: LayaDecisionCase = {
      schemaVersion: "asc/laya-decision-dataset/v1",
      caseId: syntheticCase.caseId,
      sourceRepository: "techbeansjp-free/AGENTS.md",
      sourceCommit: value.sourceCommit as string,
      observedAt: value.createdAt as string,
      groupId: syntheticCase.groupId,
      slice: syntheticCase.workflow,
      claim: syntheticCase.claim,
      evidence: syntheticCase.evidence,
      provenance: {
        kind: "review-artifact",
        artifactPath: `synthetic/${syntheticCase.caseId}.json`,
        failBeforeCommit: null,
        passAfterCommit: null,
      },
      strength: "weak",
      gold: {},
      critical: false,
    };
    for (const questionId of questionIdsForCase(decisionCase))
      createTeacherView(decisionCase, questionId);
    return { syntheticCase, decisionCase };
  });
  const ids = cases.map(({ syntheticCase }) => syntheticCase.caseId);
  if (new Set(ids).size !== ids.length)
    throw new Error("synthetic caseIdが重複しています");
  const splitValue = record(value.split, "synthetic split");
  exactKeys(
    splitValue,
    ["schemaVersion", "createdAt", "sourceDigest", "partitions", "splitDigest"],
    "synthetic split",
  );
  const partitionsValue = record(
    splitValue.partitions,
    "synthetic split partitions",
  );
  exactKeys(
    partitionsValue,
    ["train", "validation", "holdout", "reserve"],
    "synthetic split partitions",
  );
  if (
    Object.values(partitionsValue).some(
      (ids) =>
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== "string" || !SAFE_ID.test(id)),
    )
  )
    throw new Error("synthetic split partitionが不正です");
  const split = splitValue as unknown as SealedSplit;
  const unsignedSplit = {
    schemaVersion: split.schemaVersion,
    createdAt: split.createdAt,
    sourceDigest: split.sourceDigest,
    partitions: split.partitions,
  };
  if (
    split.schemaVersion !== "asc/laya-split/v1" ||
    split.sourceDigest !==
      digestLayaArtifact(cases.map(({ syntheticCase }) => syntheticCase)) ||
    split.splitDigest !== digestLayaArtifact(unsignedSplit)
  )
    throw new Error("synthetic splitがproblem setと一致しません");
  const partitionIds = Object.values(split.partitions).flat().sort();
  if (
    partitionIds.length !== ids.length ||
    partitionIds.some((id, index) => id !== [...ids].sort()[index]) ||
    new Set(partitionIds).size !== partitionIds.length
  )
    throw new Error("synthetic splitは全caseを重複なく含む必要があります");
  const caseById = new Map(
    cases.map(({ syntheticCase }) => [syntheticCase.caseId, syntheticCase]),
  );
  const groupPartition = new Map<string, string>();
  for (const [partition, caseIds] of Object.entries(split.partitions)) {
    for (const caseId of caseIds) {
      const groupId = caseById.get(caseId)?.groupId;
      if (!groupId) throw new Error(`split caseがありません: ${caseId}`);
      const assigned = groupPartition.get(groupId);
      if (assigned !== undefined && assigned !== partition)
        throw new Error(
          `synthetic groupをpartition間で分割できません: ${groupId}`,
        );
      groupPartition.set(groupId, partition);
    }
  }
  const expectedSeal = digestLayaArtifact({
    schemaVersion: value.schemaVersion,
    sourceCommit: value.sourceCommit,
    createdAt: value.createdAt,
    cases: value.cases,
    split: value.split,
  });
  if (value.sealDigest !== expectedSeal)
    throw new Error("synthetic problem sealが内容と一致しません");
  return {
    value: value as unknown as SyntheticProblemSet,
    decisionCases: cases.map(({ decisionCase }) => decisionCase),
  };
}

function parseLabels(
  input: unknown,
  sealDigest: string,
): {
  codex: TeacherSet;
  opus: TeacherSet;
} {
  const value = record(input, "synthetic teacher labels");
  exactKeys(
    value,
    ["schemaVersion", "sealDigest", "teachers"],
    "synthetic teacher labels",
  );
  if (
    value.schemaVersion !== "asc/laya-synthetic-teacher-labels/v1" ||
    value.sealDigest !== sealDigest ||
    !Array.isArray(value.teachers) ||
    value.teachers.length !== 2
  )
    throw new Error("synthetic teacher labelsがproblem sealと一致しません");
  const teachers = value.teachers.map((raw, index) => {
    const teacher = record(raw, `teachers[${index}]`);
    exactKeys(
      teacher,
      ["schemaVersion", "teacher", "assessments"],
      `teachers[${index}]`,
    );
    if (
      teacher.schemaVersion !== "asc/laya-teacher-assessment-set/v1" ||
      (teacher.teacher !== "codex" && teacher.teacher !== "opus") ||
      !Array.isArray(teacher.assessments)
    )
      throw new Error(`teachers[${index}]が不正です`);
    return teacher as unknown as TeacherSet;
  });
  const codex = teachers.find((teacher) => teacher.teacher === "codex");
  const opus = teachers.find((teacher) => teacher.teacher === "opus");
  if (!codex || !opus) throw new Error("CodexとOpusの独立labelが必要です");
  return { codex, opus };
}

function questionDefinition(
  questionId: LayaQuestionId,
): Record<string, unknown> {
  const definitions: Record<
    LayaQuestionId,
    { instructions: string; criteria: Record<string, string> }
  > = {
    "finding-validity": {
      instructions:
        "Decide whether the finding is established by the supplied evidence.",
      criteria: {
        yes: "The evidence establishes the finding.",
        no: "The evidence disproves the finding.",
        "insufficient-evidence": "The evidence is insufficient.",
      },
    },
    severity: {
      instructions: "Classify the user impact if the finding is valid.",
      criteria: Object.fromEntries(
        LAYA_SEVERITY.map((label) => [label, label]),
      ),
    },
    "required-action": {
      instructions: "Choose the next action supported by the evidence.",
      criteria: Object.fromEntries(LAYA_ACTIONS.map((label) => [label, label])),
    },
    "distribution-impact": {
      instructions: "Decide whether the distributed artifact is affected.",
      criteria: Object.fromEntries(
        LAYA_VALIDITY.map((label) => [label, label]),
      ),
    },
  };
  return { type: "choice", ...definitions[questionId] };
}

function choicesForQuestion(questionId: LayaQuestionId): readonly string[] {
  if (questionId === "severity") return LAYA_SEVERITY;
  if (questionId === "required-action") return LAYA_ACTIONS;
  return LAYA_VALIDITY;
}

export function createSyntheticTeacherPackets(
  problemsInput: unknown,
  expectedCount: number,
): { packets: SyntheticTeacherPacket[]; source: string } {
  const { value: problems, decisionCases } = parseProblemSet(
    problemsInput,
    expectedCount,
  );
  const byId = new Map(decisionCases.map((item) => [item.caseId, item]));
  const packets = (["train", "validation"] as const).flatMap((partition) =>
    problems.split.partitions[partition].flatMap((caseId) => {
      const decisionCase = byId.get(caseId);
      if (!decisionCase) throw new Error(`split caseがありません: ${caseId}`);
      return questionIdsForCase(decisionCase).map((questionId) => {
        const view = createTeacherView(decisionCase, questionId);
        return {
          caseId: view.caseId,
          questionId: view.questionId,
          claim: view.claim,
          evidence: view.evidence,
          allowedChoices: [...choicesForQuestion(questionId)],
          splitDigest: problems.split.splitDigest,
          sealDigest: problems.sealDigest,
          partition,
          purpose: "train-label" as const,
        };
      });
    }),
  );
  return {
    packets,
    source: packets.map((packet) => `${stableJson(packet)}\n`).join(""),
  };
}

function parseRawTeacherAnswers(source: string): RawSyntheticTeacherAnswer[] {
  if (typeof source !== "string")
    throw new Error("teacher answer JSONLはstringが必要です");
  const lines = source.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const value = record(
      parseJsonStrict(line, `teacher answers[${index}]`),
      `teacher answers[${index}]`,
    );
    exactKeys(
      value,
      ["caseId", "questionId", "answer", "confidence", "evidenceReason"],
      `teacher answers[${index}]`,
    );
    if (
      typeof value.caseId !== "string" ||
      !SAFE_ID.test(value.caseId) ||
      typeof value.questionId !== "string" ||
      ![
        "finding-validity",
        "severity",
        "required-action",
        "distribution-impact",
      ].includes(value.questionId) ||
      typeof value.answer !== "string" ||
      typeof value.confidence !== "number" ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1 ||
      typeof value.evidenceReason !== "string" ||
      value.evidenceReason.trim().length === 0
    )
      throw new Error(`teacher answers[${index}]が不正です`);
    return value as unknown as RawSyntheticTeacherAnswer;
  });
}

export function importSyntheticTeacherAnswers(
  problemsInput: unknown,
  answerSource: string,
  options: {
    expectedCount: number;
    teacher: "codex" | "opus";
    runId: string;
    recordedAt: string;
  },
): TeacherSet {
  if (!SAFE_ID.test(options.runId)) throw new Error("teacher runIdが不正です");
  if (new Date(options.recordedAt).toISOString() !== options.recordedAt)
    throw new Error(
      "teacher recordedAtが正規ISO 8601 UTC instantではありません",
    );
  const { value: problems } = parseProblemSet(
    problemsInput,
    options.expectedCount,
  );
  const { packets } = createSyntheticTeacherPackets(
    problemsInput,
    options.expectedCount,
  );
  const packetByKey = new Map(
    packets.map((packet) => [`${packet.caseId}\0${packet.questionId}`, packet]),
  );
  const caseById = new Map(problems.cases.map((item) => [item.caseId, item]));
  const seen = new Set<string>();
  const assessments = parseRawTeacherAnswers(answerSource).map((answer) => {
    const key = `${answer.caseId}\0${answer.questionId}`;
    const packet = packetByKey.get(key);
    if (!packet || seen.has(key))
      throw new Error("teacher answerがpacketと一致しないか重複しています");
    if (!packet.allowedChoices.includes(answer.answer))
      throw new Error("teacher answerが許可choiceにありません");
    const problem = caseById.get(answer.caseId);
    if (!problem) throw new Error("teacher answerのcaseがありません");
    const inputDigest = digestLayaTrainingInput(
      {
        claim: problem.claim,
        evidence: problem.evidence,
        slice: problem.workflow,
      },
      answer.questionId,
      questionDefinition(answer.questionId),
    );
    seen.add(key);
    const assessment: TeacherAssessment = {
      schemaVersion: "asc/laya-teacher-assessment/v1",
      teacher: options.teacher,
      runId: options.runId,
      caseId: answer.caseId,
      questionId: answer.questionId,
      purpose: packet.purpose,
      partition: packet.partition,
      answer: answer.answer,
      inputDigest,
      confidence: answer.confidence,
      evidenceReason: answer.evidenceReason,
      splitDigest: packet.splitDigest,
      sealDigest: packet.sealDigest,
      recordedAt: options.recordedAt,
    };
    validateTeacherAssessment(assessment, problems.split, problems.sealDigest);
    return assessment;
  });
  if (seen.size !== packetByKey.size)
    throw new Error(
      "teacher answerが全train/validation packetを覆っていません",
    );
  return {
    schemaVersion: "asc/laya-teacher-assessment-set/v1",
    teacher: options.teacher,
    assessments,
  };
}

export function convertSyntheticTrainingInput(
  problemsInput: unknown,
  labelsInput: unknown,
  options: {
    expectedCount: number;
    trainPath: string;
    validationPath: string;
    splitPath: string;
    codexPath: string;
    opusPath: string;
  },
): SyntheticImportResult {
  const { value: problems, decisionCases } = parseProblemSet(
    problemsInput,
    options.expectedCount,
  );
  const labels = parseLabels(labelsInput, problems.sealDigest);
  const splitSha = artifactSha(problems.split);
  const codexSha = artifactSha(labels.codex);
  const opusSha = artifactSha(labels.opus);
  const provisionalManifest: LayaTrainingManifest = {
    schemaVersion: "asc/laya-training-manifest/v1",
    sourceRepository: "techbeansjp-free/AGENTS.md",
    sourceCommit: problems.sourceCommit,
    datasetDigest: "0".repeat(64),
    splitDigest: problems.split.splitDigest,
    sealDigest: problems.sealDigest,
    layaRevision: "2c6c16baf3ea3149948777937d5005a7c7fba425",
    notebookSha256:
      "6b81f290bbd213008d3e79c80d207b9abc1d1b5ab0a23f3f4bd9a289611433ed",
    baseModel: "convaiinnovations/laya-multilingual",
    baseModelRevision: "82d57fc4f2d1be3d2caac494045f2ec51d0842f3",
    environmentDigest: ENVIRONMENT_DIGEST,
    seed: 1480,
    trainPath: options.trainPath,
    validationPath: options.validationPath,
    splitArtifact: { path: options.splitPath, sha256: splitSha },
    teacherArtifacts: [
      { teacher: "codex", path: options.codexPath, sha256: codexSha },
      { teacher: "opus", path: options.opusPath, sha256: opusSha },
    ],
    adjudicationArtifacts: [],
  };
  const bindings = createLayaTrainingArtifactBindings({
    manifest: provisionalManifest,
    split: problems.split,
    teachers: [
      { teacher: "codex", sha256: codexSha, value: labels.codex },
      { teacher: "opus", sha256: opusSha, value: labels.opus },
    ],
    adjudications: [],
  });
  const byId = new Map(decisionCases.map((item) => [item.caseId, item]));
  let excludedQuestionCount = 0;
  const rows = (partition: "train" | "validation"): LayaTrainingRow[] =>
    problems.split.partitions[partition].flatMap((caseId) => {
      const decisionCase = byId.get(caseId);
      if (!decisionCase) throw new Error(`split caseがありません: ${caseId}`);
      const answers: Partial<Record<LayaQuestionId, string>> = {};
      for (const questionId of questionIdsForCase(decisionCase)) {
        const key = `${caseId}\0${questionId}\0${partition}`;
        const codex = bindings.teacherAssessments.get(`codex\0${key}`);
        const opus = bindings.teacherAssessments.get(`opus\0${key}`);
        if (!codex || !opus || codex.answer !== opus.answer) {
          excludedQuestionCount++;
          continue;
        }
        answers[questionId] = codex.answer;
      }
      const questionIds = Object.keys(answers) as LayaQuestionId[];
      if (questionIds.length === 0) return [];
      const questions = Object.fromEntries(
        questionIds.map((questionId) => [
          questionId,
          questionDefinition(questionId),
        ]),
      );
      const gold = Object.fromEntries(
        questionIds.map((questionId) => {
          const classes = choicesForQuestion(questionId);
          return [
            questionId,
            {
              label: answers[questionId],
              probabilities: Object.fromEntries(
                classes.map((label) => [
                  label,
                  answers[questionId] === label ? 1 : 0,
                ]),
              ),
            },
          ];
        }),
      );
      return [
        {
          schemaVersion: "asc/laya-training-row/v1",
          id: caseId,
          workflow: decisionCase.slice,
          state: stableJson({
            claim: decisionCase.claim,
            evidence: decisionCase.evidence,
            slice: decisionCase.slice,
          }),
          questions: stableJson(questions),
          gold: stableJson(gold),
          provenance: {
            labelSource: "teacher-consensus",
            sourceCaseId: caseId,
            splitDigest: problems.split.splitDigest,
            sealDigest: problems.sealDigest,
            purpose: "train-label",
            partition,
            teacherAssessments: [
              {
                teacher: "codex",
                assessmentDigest: codexSha,
                answers,
              },
              { teacher: "opus", assessmentDigest: opusSha, answers },
            ],
          },
        },
      ];
    });
  const trainRows = rows("train");
  const validationRows = rows("validation");
  const toJsonl = (items: LayaTrainingRow[]): string =>
    items.map((item) => `${stableJson(item)}\n`).join("");
  const trainSource = toJsonl(trainRows);
  const validationSource = toJsonl(validationRows);
  const manifest = {
    ...provisionalManifest,
    datasetDigest: crypto
      .createHash("sha256")
      .update(sourceSha(trainSource) + sourceSha(validationSource))
      .digest("hex"),
  };
  validateLayaTrainingDatasets(
    trainSource,
    validationSource,
    manifest,
    bindings,
  );
  return {
    manifest,
    trainSource,
    validationSource,
    split: problems.split,
    codex: labels.codex,
    opus: labels.opus,
    report: {
      schemaVersion: "asc/laya-synthetic-import-report/v1",
      authority: false,
      problemCount: problems.cases.length,
      trainRowCount: trainRows.length,
      validationRowCount: validationRows.length,
      excludedQuestionCount,
      sealDigest: problems.sealDigest,
      splitDigest: problems.split.splitDigest,
    },
  };
}

function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`${prefix}<value>が必要です`);
  return value;
}

export function runLayaSyntheticImport(): void {
  const root = fs.realpathSync(path.resolve(required("root")));
  const problemsPath = resolveContained(root, required("problems"));
  const labelsPath = resolveContained(root, required("labels"));
  const output = required("output");
  if (!/^synthetic-[A-Za-z0-9._-]+$/u.test(output))
    throw new Error("outputはsynthetic-で始まる安全なrun名が必要です");
  const runRoot = resolveContained(root, LOCAL_RUN_ROOT);
  const stat = fs.lstatSync(runRoot);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(runRoot) !== runRoot
  )
    throw new Error("local run rootが通常directoryではありません");
  const outputRoot = `${LOCAL_RUN_ROOT}/${output}`;
  const paths = {
    trainPath: `${outputRoot}/train.jsonl`,
    validationPath: `${outputRoot}/validation.jsonl`,
    splitPath: `${outputRoot}/split.json`,
    codexPath: `${outputRoot}/teacher-codex.json`,
    opusPath: `${outputRoot}/teacher-opus.json`,
  };
  const result = convertSyntheticTrainingInput(
    parseJsonStrict(
      fs.readFileSync(problemsPath, "utf8"),
      "synthetic problems",
    ),
    parseJsonStrict(fs.readFileSync(labelsPath, "utf8"), "synthetic labels"),
    { expectedCount: 1000, ...paths },
  );
  const outputDirectory = resolveContained(root, outputRoot, {
    allowMissingLeaf: true,
  });
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  writeLayaArtifact(root, paths.splitPath, result.split);
  writeLayaArtifact(root, paths.codexPath, result.codex);
  writeLayaArtifact(root, paths.opusPath, result.opus);
  fs.writeFileSync(
    resolveContained(root, paths.trainPath, { allowMissingLeaf: true }),
    result.trainSource,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  fs.writeFileSync(
    resolveContained(root, paths.validationPath, { allowMissingLeaf: true }),
    result.validationSource,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  writeLayaArtifact(root, `${outputRoot}/manifest.json`, result.manifest);
  writeLayaArtifact(root, `${outputRoot}/import-report.json`, result.report);
  process.stdout.write(`${stableJson(result.report)}\n`);
}

if (isExecutionEntry(import.meta.url)) runLayaSyntheticImport();
