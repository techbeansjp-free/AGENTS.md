import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  readPrivateCorpusAuthorization,
  readTrustedPrivateAuthorizationPins,
} from "../../src/adapters/laya-private-authorization.js";
import {
  assertExternalPrivateStore,
  writePrivateCorpusNoReplace,
} from "../../src/adapters/laya-private-corpus-v2.js";
import { writeLayaArtifact } from "../../src/adapters/laya-artifact-store.js";
import {
  extractDistributionDecisionCases,
  extractPublicAscReviewCases,
  snapshotManifest,
} from "../../src/adapters/laya-snapshot.js";
import { launchLayaTrainingRunner } from "../../src/adapters/laya-training-runner.js";
import { LayaDecisionProvider } from "../../src/adapters/laya-decision-provider.js";
import {
  assessPrivateStructuralLeakage,
  createPrivateStructuralCase,
  createPrivateStructuralTrainingView,
  type PrivateStructuralCase,
} from "../../src/domain/laya-private-corpus-v2.js";
import {
  LAYA_DECISION_BUNDLE_SCHEMA_VERSION,
  validateDecisionBundle,
  type LayaDecisionBundle,
} from "../../src/domain/laya-distribution.js";
import {
  candidateEligibility,
  createSealedSplit,
  createTeacherView,
  digestLayaArtifact,
  evaluatePredictions,
  LAYA_DATASET_SCHEMA_VERSION,
  validateDecisionCase,
  validateTeacherAssessment,
  validateTrainingManifest,
  type EvaluationReport,
  type LayaDecisionCase,
  type LayaTrainingManifest,
  type SealedSplit,
  type TeacherAssessment,
} from "../../src/domain/laya-decision-training.js";
import {
  createLayaTrainingArtifactBindings,
  digestLayaTrainingInput,
  evaluateLayaValidationPredictions,
  validateLayaTrainingDatasets,
  validateLayaValidationPredictions,
  type LayaValidationEvaluation,
  type LayaTrainingArtifactBindings,
  type LayaTrainingRow,
} from "../../src/domain/laya-training-contract.js";
import { stableJson } from "../../src/lib/security.js";
import {
  convertSyntheticTrainingInput,
  createSyntheticTeacherPackets,
  importSyntheticTeacherAnswers,
  type SyntheticImportResult,
  type TeacherSet,
} from "../../scripts/laya_synthetic_import.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class LayaWorld extends WorkflowWorld {
  decisionCase: LayaDecisionCase | undefined;
  cases: LayaDecisionCase[] = [];
  split: SealedSplit | undefined;
  report: EvaluationReport | undefined;
  root = "";
  commit = "";
  firstDigest = "";
  secondDigest = "";
  manifest: LayaTrainingManifest | undefined;
  processCalls = 0;
  operationSucceeded = false;
  checkpointAccepted = false;
  bundle: LayaDecisionBundle | undefined;
  privateCase: PrivateStructuralCase | undefined;
  decisionState = "";
  attackFailures = 0;
  attackCount = 0;
  authorizationPath = "";
  trustedPinCount = -1;
  movedRoot = "";
  gitTarget = "";
  trainingSource = "";
  validationSource = "";
  validationPredictionSource = "";
  validationEvaluation: LayaValidationEvaluation | undefined;
  pythonValidationEvaluation: LayaValidationEvaluation | undefined;
  syntheticProblems: unknown;
  syntheticLabels: unknown;
  syntheticImport: SyntheticImportResult | undefined;
  syntheticPacketSource = "";
  syntheticAnswerSource = "";
  syntheticTeacherSets: TeacherSet[] = [];
  trainingArtifactBindings: LayaTrainingArtifactBindings | undefined;
  pythonStatus = 0;
}

const { Given, When, Then } = stepDefinitions<LayaWorld>();
const SHA = "1".repeat(40);
const DIGEST = "2".repeat(64);
const NOW = "2026-09-24T00:00:00.000Z";
const PRIVATE_KEY =
  "7d4f38f976ace218e6d3dee8e27c2592848418dd9446bd3c2ef882dfee7755a8";
const CORPUS_SALT =
  "abcdef01234567899876543210abcdeffedcba01234567890123456789abcde0";
const TRAIN_IDS = ["weak-review", "shared-case", "soft-gold", "runner-train"];
const VALIDATION_IDS = ["validation-1", "runner-validation"];
const TRAIN_SPLIT_UNSIGNED = {
  schemaVersion: "asc/laya-split/v1" as const,
  createdAt: NOW,
  sourceDigest: DIGEST,
  partitions: {
    train: TRAIN_IDS,
    validation: VALIDATION_IDS,
    holdout: ["holdout-only"],
    reserve: ["reserve-only"],
  },
};
const TRAIN_SPLIT: SealedSplit = {
  ...TRAIN_SPLIT_UNSIGNED,
  splitDigest: digestLayaArtifact(TRAIN_SPLIT_UNSIGNED),
};

function fixtureTrainingState() {
  return {
    claim: "A reachable path violates an invariant",
    evidence: [{ path: "src/example.ts", lineStart: 1, lineEnd: 1 }],
    slice: "general",
  };
}

function fixtureTrainingQuestions() {
  return {
    "finding-validity": {
      type: "choice",
      instructions: "Decide from evidence",
      criteria: {
        yes: "valid",
        no: "invalid",
        "insufficient-evidence": "unknown",
      },
    },
    "required-action": {
      type: "choice",
      instructions: "Choose the required action",
      criteria: {
        fix: "fix",
        investigate: "investigate",
        dismiss: "dismiss",
      },
    },
    severity: {
      type: "choice",
      instructions: "Choose severity",
      criteria: {
        critical: "critical",
        high: "high",
        medium: "medium",
        low: "low",
      },
    },
  };
}

function teacherArtifact(teacher: "codex" | "opus") {
  return {
    schemaVersion: "asc/laya-teacher-assessment-set/v1",
    teacher,
    assessments: (["train", "validation"] as const).flatMap((partition) =>
      TRAIN_SPLIT.partitions[partition].flatMap((caseId) =>
        (
          [
            ["finding-validity", "yes"],
            ["required-action", "fix"],
            ["severity", "medium"],
          ] as const
        ).map(([questionId, answer]) => ({
          schemaVersion: "asc/laya-teacher-assessment/v1",
          teacher,
          runId: `${teacher}-fixture`,
          caseId,
          questionId,
          purpose: "train-label",
          partition,
          answer,
          inputDigest: digestLayaTrainingInput(
            fixtureTrainingState(),
            questionId,
            fixtureTrainingQuestions()[questionId],
          ),
          confidence: 1,
          evidenceReason: "fixture evidence",
          splitDigest: TRAIN_SPLIT.splitDigest,
          sealDigest: DIGEST,
          recordedAt: NOW,
        })),
      ),
    ),
  };
}

const CODEX_TEACHER = teacherArtifact("codex");
const OPUS_TEACHER = teacherArtifact("opus");
const CODEX_TEACHER_SHA = digestLayaArtifact(CODEX_TEACHER);
const OPUS_TEACHER_SHA = digestLayaArtifact(OPUS_TEACHER);

function baseCase(index = 1): LayaDecisionCase {
  return {
    schemaVersion: LAYA_DATASET_SCHEMA_VERSION,
    caseId: `ASC-CASE-${String(index).padStart(3, "0")}`,
    sourceRepository: "techbeansjp-free/AGENTS.md",
    sourceCommit: SHA,
    observedAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    groupId: `group-${String(index).padStart(3, "0")}`,
    slice: "general",
    claim: "The current code may violate an invariant",
    evidence: [
      {
        path: "src/example.ts",
        lineStart: 1,
        lineEnd: 1,
        excerpt: "return value;",
      },
    ],
    provenance: {
      kind: "fix-commit",
      artifactPath: "src/example.ts",
      failBeforeCommit: null,
      passAfterCommit: SHA,
    },
    strength: "weak",
    gold: {},
    critical: false,
  };
}

function validManifest(): LayaTrainingManifest {
  return {
    schemaVersion: "asc/laya-training-manifest/v1",
    sourceRepository: "techbeansjp-free/AGENTS.md",
    sourceCommit: SHA,
    datasetDigest: DIGEST,
    splitDigest: TRAIN_SPLIT.splitDigest,
    sealDigest: DIGEST,
    layaRevision: "2c6c16baf3ea3149948777937d5005a7c7fba425",
    notebookSha256:
      "6b81f290bbd213008d3e79c80d207b9abc1d1b5ab0a23f3f4bd9a289611433ed",
    baseModel: "convaiinnovations/laya-multilingual",
    baseModelRevision: "82d57fc4f2d1be3d2caac494045f2ec51d0842f3",
    seed: 1480,
    trainPath: "runs/train.jsonl",
    validationPath: "runs/validation.jsonl",
    environmentDigest:
      "0795cbc6120e9d75db2ff77390ac0b82ab4a59de9d1ccbfe8a15acdad032426e",
    splitArtifact: {
      path: "runs/split.json",
      sha256: digestLayaArtifact(TRAIN_SPLIT),
    },
    teacherArtifacts: [
      {
        teacher: "codex",
        path: "runs/codex.json",
        sha256: CODEX_TEACHER_SHA,
      },
      {
        teacher: "opus",
        path: "runs/opus.json",
        sha256: OPUS_TEACHER_SHA,
      },
    ],
    adjudicationArtifacts: [],
  };
}

function trainingBindings(
  manifest = validManifest(),
): LayaTrainingArtifactBindings {
  return createLayaTrainingArtifactBindings({
    manifest,
    split: TRAIN_SPLIT,
    teachers: [
      {
        teacher: "codex",
        sha256: CODEX_TEACHER_SHA,
        value: CODEX_TEACHER,
      },
      {
        teacher: "opus",
        sha256: OPUS_TEACHER_SHA,
        value: OPUS_TEACHER,
      },
    ],
    adjudications: [],
  });
}

function trainingRow(
  id: string,
  provenance: LayaTrainingRow["provenance"] = {
    labelSource: "teacher-consensus",
    sourceCaseId: id,
    splitDigest: TRAIN_SPLIT.splitDigest,
    sealDigest: DIGEST,
    purpose: "train-label",
    partition: id.startsWith("validation") ? "validation" : "train",
    teacherAssessments: [
      {
        teacher: "codex",
        assessmentDigest: CODEX_TEACHER_SHA,
        answers: {
          "finding-validity": "yes",
          "required-action": "fix",
          severity: "medium",
        },
      },
      {
        teacher: "opus",
        assessmentDigest: OPUS_TEACHER_SHA,
        answers: {
          "finding-validity": "yes",
          "required-action": "fix",
          severity: "medium",
        },
      },
    ],
  },
): LayaTrainingRow {
  return {
    schemaVersion: "asc/laya-training-row/v1",
    id,
    workflow: "general",
    state: stableJson(fixtureTrainingState()),
    questions: stableJson(fixtureTrainingQuestions()),
    gold: stableJson({
      "finding-validity": {
        label: "yes",
        probabilities: { yes: 1, no: 0, "insufficient-evidence": 0 },
      },
      "required-action": {
        label: "fix",
        probabilities: { fix: 1, investigate: 0, dismiss: 0 },
      },
      severity: {
        label: "medium",
        probabilities: { critical: 0, high: 0, medium: 1, low: 0 },
      },
    }),
    provenance,
  };
}

function jsonl(row: unknown): string {
  return `${JSON.stringify(row)}\n`;
}

function sourceSha(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function datasetDigest(trainSource: string, validationSource: string): string {
  return crypto
    .createHash("sha256")
    .update(sourceSha(trainSource) + sourceSha(validationSource))
    .digest("hex");
}

function syntheticFixture(): { problems: unknown; labels: unknown } {
  const cases = Array.from({ length: 4 }, (_, index) => ({
    caseId: `SYN-${index + 1}`,
    groupId: `SG-${index + 1}`,
    workflow: "general",
    claim: "A nullable value is dereferenced after a reachable branch.",
    evidence: [
      {
        path: "synthetic/typescript/example.ts",
        lineStart: 10,
        lineEnd: 10,
        excerpt: "return value.name;",
      },
    ],
  }));
  const partitions = {
    train: ["SYN-1", "SYN-2"],
    validation: ["SYN-3"],
    holdout: ["SYN-4"],
    reserve: [],
  };
  const unsignedSplit = {
    schemaVersion: "asc/laya-split/v1",
    createdAt: NOW,
    sourceDigest: digestLayaArtifact(cases),
    partitions,
  };
  const split = {
    ...unsignedSplit,
    splitDigest: digestLayaArtifact(unsignedSplit),
  };
  const unsignedProblems = {
    schemaVersion: "asc/laya-synthetic-problem-set/v1",
    sourceCommit: SHA,
    createdAt: NOW,
    cases,
    split,
  };
  const sealDigest = digestLayaArtifact(unsignedProblems);
  const problems = { ...unsignedProblems, sealDigest };
  const answerByQuestion = {
    "finding-validity": "yes",
    severity: "high",
    "required-action": "fix",
    "distribution-impact": "yes",
  } as const;
  const answerSource = createSyntheticTeacherPackets(problems, 4)
    .packets.map((packet) =>
      stableJson({
        caseId: packet.caseId,
        questionId: packet.questionId,
        inputDigest: packet.inputDigest,
        answer: answerByQuestion[packet.questionId],
        confidence: 1,
        evidenceReason: "The synthetic evidence supports this answer.",
      }),
    )
    .join("\n");
  return {
    problems,
    labels: {
      schemaVersion: "asc/laya-synthetic-teacher-labels/v1",
      sealDigest,
      teachers: [
        importSyntheticTeacherAnswers(problems, answerSource, {
          expectedCount: 4,
          teacher: "codex",
          runId: "codex-synthetic-fixture",
          recordedAt: NOW,
        }),
        importSyntheticTeacherAnswers(problems, answerSource, {
          expectedCount: 4,
          teacher: "opus",
          runId: "opus-synthetic-fixture",
          recordedAt: NOW,
        }),
      ],
    },
  };
}

function resealSyntheticFixture(
  problemsInput: unknown,
  labelsInput: unknown,
): { problems: unknown; labels: unknown } {
  const problems = structuredClone(problemsInput) as {
    schemaVersion: "asc/laya-synthetic-problem-set/v1";
    sourceCommit: string;
    createdAt: string;
    cases: Array<{ caseId: string; groupId: string }>;
    split: SealedSplit;
    sealDigest: string;
  };
  problems.split.sourceDigest = digestLayaArtifact(problems.cases);
  problems.split.splitDigest = digestLayaArtifact({
    schemaVersion: problems.split.schemaVersion,
    createdAt: problems.split.createdAt,
    sourceDigest: problems.split.sourceDigest,
    partitions: problems.split.partitions,
  });
  problems.sealDigest = digestLayaArtifact({
    schemaVersion: problems.schemaVersion,
    sourceCommit: problems.sourceCommit,
    createdAt: problems.createdAt,
    cases: problems.cases,
    split: problems.split,
  });
  const labels = structuredClone(labelsInput) as {
    sealDigest: string;
    teachers: Array<{
      assessments: Array<{ splitDigest: string; sealDigest: string }>;
    }>;
  };
  labels.sealDigest = problems.sealDigest;
  for (const teacher of labels.teachers) {
    for (const assessment of teacher.assessments) {
      assessment.splitDigest = problems.split.splitDigest;
      assessment.sealDigest = problems.sealDigest;
    }
  }
  return { problems, labels };
}

function syntheticTrainingResult(): SyntheticImportResult {
  const fixture = syntheticFixture();
  return convertSyntheticTrainingInput(fixture.problems, fixture.labels, {
    expectedCount: 4,
    trainPath: "runs/train.jsonl",
    validationPath: "runs/validation.jsonl",
    splitPath: "runs/split.json",
    codexPath: "runs/codex.json",
    opusPath: "runs/opus.json",
  });
}

function bindingsForSyntheticResult(
  result: SyntheticImportResult,
): LayaTrainingArtifactBindings {
  return createLayaTrainingArtifactBindings({
    manifest: result.manifest,
    split: result.split,
    teachers: [
      {
        teacher: "codex",
        sha256: result.manifest.teacherArtifacts[0].sha256,
        value: result.codex,
      },
      {
        teacher: "opus",
        sha256: result.manifest.teacherArtifacts[1].sha256,
        value: result.opus,
      },
    ],
    adjudications: [],
  });
}

function writeSyntheticRunnerFixture(
  world: LayaWorld,
  result: SyntheticImportResult,
): void {
  world.root = fs.realpathSync(world.temp("asc-laya-strict-runner-"));
  fs.mkdirSync(path.join(world.root, "runs"), { recursive: true });
  fs.mkdirSync(path.join(world.root, ".agent-skill-chain/local/laya-runs"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(world.root, "runs/train.jsonl"),
    world.trainingSource,
  );
  fs.writeFileSync(
    path.join(world.root, "runs/validation.jsonl"),
    world.validationSource,
  );
  for (const [relative, value] of [
    ["runs/split.json", result.split],
    ["runs/codex.json", result.codex],
    ["runs/opus.json", result.opus],
  ] as const)
    fs.writeFileSync(path.join(world.root, relative), `${stableJson(value)}\n`);
  fs.writeFileSync(
    path.join(world.root, "manifest.json"),
    stableJson(world.manifest),
  );
}

function runPythonRowPreflight(root: string): number {
  const runner = path.resolve("scripts/laya_training_runner.py");
  const script = [
    "import os, runpy, sys",
    "from pathlib import Path",
    "os.chdir(sys.argv[1])",
    "module = runpy.run_path(sys.argv[2])",
    'manifest = module["load_manifest"](Path("manifest.json").resolve())',
    'bindings = module["load_training_bindings"](Path.cwd(), manifest)',
    'module["read_rows"](Path("runs/train.jsonl"), manifest, "train", bindings)',
    'module["read_rows"](Path("runs/validation.jsonl"), manifest, "validation", bindings)',
  ].join("; ");
  return (
    spawnSync("python3", ["-I", "-c", script, root, runner], {
      encoding: "utf8",
    }).status ?? 1
  );
}

function evaluatePythonPredictions(source: string): LayaValidationEvaluation {
  const runner = path.resolve("scripts/laya_training_runner.py");
  const script = [
    "import json, runpy, sys",
    "module = runpy.run_path(sys.argv[1])",
    'print(json.dumps(module["question_metrics"](json.loads(sys.stdin.read())), sort_keys=True))',
  ].join("; ");
  const result = spawnSync("python3", ["-I", "-c", script, runner], {
    encoding: "utf8",
    input: `[${source.split("\n").filter(Boolean).join(",")}]`,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as LayaValidationEvaluation;
}

function writeTrainingEvidence(root: string): void {
  fs.writeFileSync(path.join(root, "runs/split.json"), stableJson(TRAIN_SPLIT));
  fs.writeFileSync(
    path.join(root, "runs/codex.json"),
    stableJson(CODEX_TEACHER),
  );
  fs.writeFileSync(path.join(root, "runs/opus.json"), stableJson(OPUS_TEACHER));
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createFixture(world: LayaWorld, remote: string): void {
  world.root = fs.realpathSync(world.temp("asc-laya-fixture-"));
  git(world.root, "init", "-q", "-b", "main");
  git(world.root, "config", "user.name", "Test");
  git(world.root, "config", "user.email", "test@example.invalid");
  git(world.root, "remote", "add", "origin", remote);
  fs.mkdirSync(path.join(world.root, "docs/reviews"), { recursive: true });
  fs.writeFileSync(
    path.join(world.root, "docs/reviews/1480_レビュー.md"),
    "# Review\n\n## Missing guard\n\nThe path reaches a null dereference.\n",
  );
  git(world.root, "add", ".");
  git(world.root, "commit", "-q", "-m", "fixture");
  world.commit = git(world.root, "rev-parse", "HEAD");
}

Given("Layaのレビュー証拠だけを持つdecision caseがある", function () {
  this.decisionCase = {
    ...baseCase(),
    provenance: {
      kind: "review-artifact",
      artifactPath: "docs/reviews/a.md",
      failBeforeCommit: null,
      passAfterCommit: null,
    },
    strength: "weak",
  };
});
When("そのcaseを強い正解として検証する", function () {
  try {
    validateDecisionCase({ ...this.decisionCase!, strength: "strong" });
  } catch (error) {
    this.error = error;
  }
});
Given("Layaの再現済みdecision caseがある", function () {
  this.decisionCase = {
    ...baseCase(),
    provenance: {
      kind: "test-reproduction",
      artifactPath: "test/a.ts",
      failBeforeCommit: "3".repeat(40),
      passAfterCommit: SHA,
    },
    strength: "strong",
  };
});
When("decision caseを検証する", function () {
  validateDecisionCase(this.decisionCase!);
  this.operationSucceeded = true;
});
Given("300件のgroup化したLaya caseがある", function () {
  this.cases = Array.from({ length: 300 }, (_, index) => baseCase(index + 1));
});
Given("seal済みのLaya splitがある", function () {
  this.cases = Array.from({ length: 300 }, (_, index) => baseCase(index + 1));
  this.split = createSealedSplit(this.cases, NOW);
});
When("Laya splitをsealする", function () {
  this.split = createSealedSplit(this.cases, NOW);
});
Then("全caseが1つのpartitionだけに属する", function () {
  const all = Object.values(this.split!.partitions).flat();
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, 300);
});

function assessment(world: LayaWorld, splitDigest: string): TeacherAssessment {
  return {
    schemaVersion: "asc/laya-teacher-assessment/v1",
    teacher: "opus",
    runId: "run-1",
    caseId: world.split!.partitions.holdout[0]!,
    questionId: "finding-validity",
    purpose: "train-label",
    partition: "holdout",
    answer: "yes",
    inputDigest: DIGEST,
    confidence: 0.8,
    evidenceReason: "Evidence reaches the fault",
    splitDigest,
    sealDigest: DIGEST,
    recordedAt: "2026-09-24T01:00:00.000Z",
  };
}
When("学習用teacher assessmentをholdoutへ指定する", function () {
  try {
    validateTeacherAssessment(
      assessment(this, this.split!.splitDigest),
      this.split!,
      DIGEST,
    );
  } catch (error) {
    this.error = error;
  }
});
When("assessmentへ異なるsplit digestを指定する", function () {
  try {
    validateTeacherAssessment(
      assessment(this, "9".repeat(64)),
      this.split!,
      DIGEST,
    );
  } catch (error) {
    this.error = error;
  }
});

Given("弱いreview status由来のLaya training rowがある", function () {
  const row = trainingRow("weak-review", {
    labelSource: "review-status" as "teacher-consensus",
    sourceCaseId: "weak-review",
    splitDigest: TRAIN_SPLIT.splitDigest,
    sealDigest: DIGEST,
    purpose: "train-label",
    partition: "train",
  });
  this.trainingSource = jsonl(row);
  this.validationSource = jsonl(trainingRow("validation-1"));
});
Given("同じcaseを含むLaya trainとvalidationがある", function () {
  const row = trainingRow("shared-case");
  this.trainingSource = jsonl(row);
  this.validationSource = jsonl(row);
});
Given("one-hotでないLaya training goldがある", function () {
  const row = trainingRow("soft-gold");
  const gold = JSON.parse(row.gold) as Record<
    string,
    { label: string; probabilities: Record<string, number> }
  >;
  gold["finding-validity"]!.probabilities = {
    yes: 0.6,
    no: 0.2,
    "insufficient-evidence": 0.2,
  };
  row.gold = stableJson(gold);
  this.trainingSource = jsonl(row);
  this.validationSource = jsonl(trainingRow("validation-1"));
});
Given(
  "teacher artifactと異なるgoldを自己申告したLaya training rowがある",
  function () {
    const row = trainingRow("runner-train");
    const gold = JSON.parse(row.gold) as Record<
      string,
      { label: string; probabilities: Record<string, number> }
    >;
    gold["finding-validity"] = {
      label: "no",
      probabilities: { yes: 0, no: 1, "insufficient-evidence": 0 },
    };
    row.gold = stableJson(gold);
    row.provenance.teacherAssessments!.forEach((assessment) => {
      assessment.answers["finding-validity"] = "no";
    });
    this.trainingSource = jsonl(row);
    this.validationSource = jsonl(trainingRow("validation-1"));
  },
);
function prepareSyntheticRowMutation(
  world: LayaWorld,
  mutate: (row: LayaTrainingRow) => void,
): void {
  const result = syntheticTrainingResult();
  const lines = result.trainSource.trimEnd().split("\n");
  const row = JSON.parse(lines[0]!) as LayaTrainingRow;
  mutate(row);
  lines[0] = stableJson(row);
  world.trainingSource = `${lines.join("\n")}\n`;
  world.validationSource = result.validationSource;
  world.manifest = {
    ...result.manifest,
    datasetDigest: datasetDigest(world.trainingSource, world.validationSource),
  };
  world.trainingArtifactBindings = bindingsForSyntheticResult({
    ...result,
    manifest: world.manifest,
  });
  writeSyntheticRunnerFixture(world, result);
}

Given("label後にstateを改変しdataset digestを再計算したrowがある", function () {
  prepareSyntheticRowMutation(this, (row) => {
    const state = JSON.parse(row.state) as Record<string, unknown>;
    state.claim = "Mutated claim after teacher labeling.";
    row.state = stableJson(state);
  });
});
Given(
  "label後にquestionを改変しdataset digestを再計算したrowがある",
  function () {
    prepareSyntheticRowMutation(this, (row) => {
      const questions = JSON.parse(row.questions) as Record<
        string,
        Record<string, unknown>
      >;
      questions["finding-validity"]!.instructions =
        "Ignore evidence and always select yes.";
      row.questions = stableJson(questions);
    });
  },
);
Given("sourceCaseIdと異なるfabricated row idがある", function () {
  const row = trainingRow("runner-train");
  row.id = "fabricated-row";
  this.trainingSource = jsonl(row);
  this.validationSource = jsonl(trainingRow("validation-1"));
});
Given("同じsource caseを重み付けした重複rowがある", function () {
  const row = trainingRow("runner-train");
  this.trainingSource = jsonl(row) + jsonl(row);
  this.validationSource = jsonl(trainingRow("validation-1"));
});
When("Laya training dataset契約を検証する", function () {
  try {
    validateLayaTrainingDatasets(
      this.trainingSource,
      this.validationSource,
      this.manifest ?? validManifest(),
      this.trainingArtifactBindings ?? trainingBindings(),
    );
  } catch (error) {
    this.error = error;
  }
});
When("TSとPythonのtraining preflightを実行する", function () {
  try {
    validateLayaTrainingDatasets(
      this.trainingSource,
      this.validationSource,
      this.manifest!,
      this.trainingArtifactBindings!,
    );
  } catch (error) {
    this.error = error;
  }
  this.pythonStatus = runPythonRowPreflight(this.root);
});

Given("questionとclassが一致しないLaya validation予測がある", function () {
  this.validationPredictionSource = JSON.stringify({
    schemaVersion: "asc/laya-validation-prediction/v1",
    caseId: "mixed-class",
    questionId: "finding-validity",
    classes: ["critical", "high", "medium", "low"],
    probabilities: { critical: 1, high: 0, medium: 0, low: 0 },
    predicted: "critical",
    gold: "critical",
  });
});
When("Laya validation予測契約を検証する", function () {
  try {
    validateLayaValidationPredictions(this.validationPredictionSource);
  } catch (error) {
    this.error = error;
  }
});

Given("criticalなLaya findingをinvalidと予測している", function () {
  this.report = evaluatePredictions(
    ["yes", "no", "insufficient-evidence"],
    [
      {
        caseId: "critical-1",
        gold: "yes",
        goldSeverity: "critical",
        goldAction: "fix",
      },
    ],
    [
      {
        caseId: "critical-1",
        probabilities: { yes: 0.01, no: 0.98, "insufficient-evidence": 0.01 },
        predicted: "no",
        predictedAction: "dismiss",
        latencyMs: 3,
      },
    ],
  );
});
Given("noncriticalで正しいLaya予測がある", function () {
  this.report = evaluatePredictions(
    ["yes", "no", "insufficient-evidence"],
    [
      {
        caseId: "normal-1",
        gold: "yes",
        goldSeverity: "high",
        goldAction: "fix",
      },
    ],
    [
      {
        caseId: "normal-1",
        probabilities: { yes: 0.9, no: 0.05, "insufficient-evidence": 0.05 },
        predicted: "yes",
        predictedAction: "fix",
        latencyMs: 4,
      },
    ],
  );
});
When("Laya評価を計算する", function () {
  assert.ok(this.report);
});
Then("Laya candidateは拒否される", function () {
  assert.equal(candidateEligibility(this.report!), "rejected");
});
Then("Laya reportに必須metricがある", function () {
  assert.equal(this.report!.sampleCount, 1);
  assert.equal(typeof this.report!.macroF1, "number");
  assert.equal(typeof this.report!.brier, "number");
  assert.deepEqual(this.report!.errorCaseIds, []);
});

Given("複数質問を含むLaya validation予測がある", function () {
  const predictions = [
    {
      schemaVersion: "asc/laya-validation-prediction/v1",
      caseId: "critical-case",
      questionId: "finding-validity",
      classes: ["yes", "no", "insufficient-evidence"],
      probabilities: { yes: 0.01, no: 0.98, "insufficient-evidence": 0.01 },
      predicted: "no",
      gold: "yes",
    },
    {
      schemaVersion: "asc/laya-validation-prediction/v1",
      caseId: "critical-case",
      questionId: "severity",
      classes: ["critical", "high", "medium", "low"],
      probabilities: { critical: 0.91, high: 0.03, medium: 0.03, low: 0.03 },
      predicted: "critical",
      gold: "critical",
    },
  ];
  this.validationPredictionSource = predictions
    .map((prediction) => JSON.stringify(prediction))
    .join("\n");
});
Given(
  "無効criticalと未検出criticalを含むLaya validation予測がある",
  function () {
    const prediction = (
      caseId: string,
      questionId: "finding-validity" | "severity" | "required-action",
      predicted: string,
      gold: string,
    ) => {
      const classes =
        questionId === "finding-validity"
          ? ["yes", "no", "insufficient-evidence"]
          : questionId === "required-action"
            ? ["fix", "investigate", "dismiss"]
            : ["critical", "high", "medium", "low"];
      return {
        schemaVersion: "asc/laya-validation-prediction/v1",
        caseId,
        questionId,
        classes,
        probabilities: Object.fromEntries(
          classes.map((choice) => [choice, choice === predicted ? 1 : 0]),
        ),
        predicted,
        gold,
      };
    };
    const predictions = [
      prediction("invalid-critical", "finding-validity", "no", "no"),
      prediction("invalid-critical", "severity", "critical", "critical"),
      prediction(
        "missed-critical",
        "finding-validity",
        "insufficient-evidence",
        "yes",
      ),
      prediction("missed-critical", "severity", "critical", "critical"),
      prediction("detected-critical", "required-action", "fix", "fix"),
      prediction("detected-critical", "severity", "critical", "critical"),
    ];
    this.validationPredictionSource = predictions
      .map((item) => stableJson(item))
      .join("\n");
  },
);
When("Laya validation予測を共通契約で評価する", function () {
  this.validationEvaluation = evaluateLayaValidationPredictions(
    validateLayaValidationPredictions(this.validationPredictionSource),
  );
  this.pythonValidationEvaluation = evaluatePythonPredictions(
    this.validationPredictionSource,
  );
});
Then("質問単位metricと利用可能な安全metricだけが記録される", function () {
  assert.equal(this.validationEvaluation?.sampleCount, 2);
  assert.equal(
    this.validationEvaluation?.byQuestion["finding-validity"]?.macroF1,
    0,
  );
  assert.equal(
    this.validationEvaluation?.byQuestion["finding-validity"]
      ?.highConfidenceErrorRate,
    1,
  );
  assert.equal(this.validationEvaluation?.safety.criticalRecall, 0);
  assert.equal(this.validationEvaluation?.safety.falseEscalationRate, null);
  assert.deepEqual(this.validationEvaluation?.safety.criticalMissCaseIds, [
    "critical-case",
  ]);
});
Then("実criticalだけの検出recallが記録される", function () {
  assert.equal(this.validationEvaluation?.safety.criticalRecall, 0.5);
  assert.deepEqual(this.validationEvaluation?.safety.criticalMissCaseIds, [
    "missed-critical",
  ]);
  assert.equal(this.pythonValidationEvaluation?.safety.criticalRecall, 0.5);
  assert.deepEqual(
    this.pythonValidationEvaluation?.safety.criticalMissCaseIds,
    ["missed-critical"],
  );
});

Given("seal済み合成problemと独立teacher labelがある", function () {
  const fixture = syntheticFixture();
  this.syntheticProblems = fixture.problems;
  this.syntheticLabels = fixture.labels;
});
Given("oracle fieldを含む合成teacher回答がある", function () {
  const fixture = syntheticFixture();
  this.syntheticProblems = fixture.problems;
  const { packets } = createSyntheticTeacherPackets(fixture.problems, 4);
  this.syntheticAnswerSource = packets
    .map((packet) =>
      JSON.stringify({
        caseId: packet.caseId,
        questionId: packet.questionId,
        inputDigest: packet.inputDigest,
        answer: packet.allowedChoices[0],
        confidence: 1,
        evidenceReason: "Synthetic evidence supports the selected choice.",
        gold: packet.allowedChoices[0],
      }),
    )
    .join("\n");
});
Given("blind packetと異なるinput digestの合成teacher回答がある", function () {
  const fixture = syntheticFixture();
  this.syntheticProblems = fixture.problems;
  const { packets } = createSyntheticTeacherPackets(fixture.problems, 4);
  this.syntheticAnswerSource = packets
    .map((packet, index) =>
      stableJson({
        caseId: packet.caseId,
        questionId: packet.questionId,
        inputDigest: index === 0 ? "f".repeat(64) : packet.inputDigest,
        answer: packet.allowedChoices[0],
        confidence: 1,
        evidenceReason: "Synthetic evidence supports the selected choice.",
      }),
    )
    .join("\n");
});
Given("label作成後に内容を変えた合成problemがある", function () {
  const fixture = syntheticFixture();
  const problems = structuredClone(fixture.problems) as {
    cases: Array<{ claim: string }>;
  };
  problems.cases[0]!.claim = "Changed after teacher labeling.";
  this.syntheticProblems = problems;
  this.syntheticLabels = fixture.labels;
});
Given("同じgroupをtrainとvalidationへ分割した合成problemがある", function () {
  const fixture = syntheticFixture();
  const problems = structuredClone(fixture.problems) as {
    cases: Array<{ groupId: string }>;
  };
  problems.cases[2]!.groupId = problems.cases[0]!.groupId;
  const resealed = resealSyntheticFixture(problems, fixture.labels);
  this.syntheticProblems = resealed.problems;
  this.syntheticLabels = resealed.labels;
});
When("blind packetを生成してCodexとOpus回答を取込む", function () {
  const generated = createSyntheticTeacherPackets(this.syntheticProblems, 4);
  this.syntheticPacketSource = generated.source;
  const answers = generated.packets
    .map((packet) =>
      stableJson({
        caseId: packet.caseId,
        questionId: packet.questionId,
        inputDigest: packet.inputDigest,
        answer: packet.allowedChoices[0],
        confidence: 0.9,
        evidenceReason: "Synthetic evidence supports the selected choice.",
      }),
    )
    .join("\n");
  this.syntheticTeacherSets = [
    importSyntheticTeacherAnswers(this.syntheticProblems, answers, {
      expectedCount: 4,
      teacher: "codex",
      runId: "codex-synthetic-run",
      recordedAt: NOW,
    }),
    importSyntheticTeacherAnswers(this.syntheticProblems, answers, {
      expectedCount: 4,
      teacher: "opus",
      runId: "opus-synthetic-run",
      recordedAt: "2026-09-24T00:01:00.000Z",
    }),
  ];
});
When("合成teacher回答をassessmentへ変換する", function () {
  try {
    importSyntheticTeacherAnswers(
      this.syntheticProblems,
      this.syntheticAnswerSource,
      {
        expectedCount: 4,
        teacher: "codex",
        runId: "codex-invalid-run",
        recordedAt: NOW,
      },
    );
  } catch (error) {
    this.error = error;
  }
});
When("合成problemをLaya training入力へ変換する", function () {
  try {
    this.syntheticImport = convertSyntheticTrainingInput(
      this.syntheticProblems,
      this.syntheticLabels,
      {
        expectedCount: 4,
        trainPath:
          ".agent-skill-chain/local/laya-runs/synthetic-fixture/train.jsonl",
        validationPath:
          ".agent-skill-chain/local/laya-runs/synthetic-fixture/validation.jsonl",
        splitPath:
          ".agent-skill-chain/local/laya-runs/synthetic-fixture/split.json",
        codexPath:
          ".agent-skill-chain/local/laya-runs/synthetic-fixture/teacher-codex.json",
        opusPath:
          ".agent-skill-chain/local/laya-runs/synthetic-fixture/teacher-opus.json",
      },
    );
  } catch (error) {
    this.error = error;
  }
});
Then("teacher binding済みrowと非権威reportだけが生成される", function () {
  assert.equal(this.syntheticImport?.report.authority, false);
  assert.equal(this.syntheticImport?.report.problemCount, 4);
  assert.equal(this.syntheticImport?.report.trainRowCount, 2);
  assert.equal(this.syntheticImport?.report.validationRowCount, 1);
  assert.equal(this.syntheticImport?.report.excludedQuestionCount, 0);
  assert.equal(this.syntheticImport?.manifest.teacherArtifacts.length, 2);
  assert.match(this.syntheticImport?.trainSource ?? "", /teacher-consensus/u);
});
Then("packetはoracleを含まずholdoutとreserveを除外する", function () {
  const packets = this.syntheticPacketSource
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(packets.length, 9);
  assert.ok(packets.every((packet) => packet.caseId !== "SYN-4"));
  assert.ok(
    packets.every(
      (packet) =>
        packet.partition === "train" || packet.partition === "validation",
    ),
  );
  assert.ok(
    packets.every(
      (packet) =>
        !Object.keys(packet).some((key) =>
          ["gold", "oracle", "answer", "label"].includes(key),
        ),
    ),
  );
  assert.deepEqual(
    Object.keys(packets[0]!).sort(),
    [
      "allowedChoices",
      "caseId",
      "inputDigest",
      "partition",
      "purpose",
      "question",
      "questionId",
      "sealDigest",
      "splitDigest",
      "state",
    ].sort(),
  );
  assert.ok(
    packets.every((packet) => {
      const questionId = packet.questionId as Parameters<
        typeof digestLayaTrainingInput
      >[1];
      return (
        packet.inputDigest ===
        digestLayaTrainingInput(
          packet.state as Record<string, unknown>,
          questionId,
          packet.question as Record<string, unknown>,
        )
      );
    }),
  );
});
Then("teacher artifactはmodel別run情報を保持する", function () {
  const [codex, opus] = this.syntheticTeacherSets;
  assert.equal(codex?.teacher, "codex");
  assert.equal(opus?.teacher, "opus");
  assert.ok(
    codex?.assessments.every((item) => item.runId === "codex-synthetic-run"),
  );
  assert.ok(
    opus?.assessments.every((item) => item.runId === "opus-synthetic-run"),
  );
  assert.ok(codex?.assessments.every((item) => item.recordedAt === NOW));
  assert.ok(
    opus?.assessments.every(
      (item) => item.recordedAt === "2026-09-24T00:01:00.000Z",
    ),
  );
});
Then("TSとPythonの両方がtraining起動前に拒否する", function () {
  assert.ok(this.error);
  assert.notEqual(this.pythonStatus, 0);
});

Given("teacher token上限を超えるLaya caseがある", function () {
  this.decisionCase = {
    ...baseCase(),
    claim: "x".repeat(4000),
    evidence: [
      { path: "src/a.ts", lineStart: 1, lineEnd: 1, excerpt: "y".repeat(4000) },
    ],
  };
});
Given("secret canaryを含むLaya caseがある", function () {
  this.decisionCase = { ...baseCase(), claim: "password=do-not-send" };
});
When("teacher viewを作る", function () {
  try {
    createTeacherView(this.decisionCase!, "finding-validity");
  } catch (error) {
    this.error = error;
  }
});

Given("隔離した公開ASC fixture repositoryがある", function () {
  createFixture(this, "https://github.com/techbeansjp-free/AGENTS.md.git");
});
Given("隔離したprivate Laya fixture repositoryがある", function () {
  createFixture(this, "https://github.com/private/example.git");
});
When("Laya snapshotを2回抽出する", function () {
  this.firstDigest = snapshotManifest(this.root, this.commit).datasetDigest;
  this.secondDigest = snapshotManifest(this.root, this.commit).datasetDigest;
});
When("Laya snapshotを抽出する", function () {
  try {
    extractPublicAscReviewCases(this.root, this.commit);
  } catch (error) {
    this.error = error;
  }
});
When("Laya snapshot抽出後に未commitのreview変更を加える", function () {
  this.firstDigest = snapshotManifest(this.root, this.commit).datasetDigest;
  fs.appendFileSync(
    path.join(this.root, "docs/reviews/1480_レビュー.md"),
    "\n## Later edit\n",
  );
  this.secondDigest = snapshotManifest(this.root, this.commit).datasetDigest;
});
Then("2つのLaya dataset digestが一致する", function () {
  assert.equal(this.firstDigest, this.secondDigest);
});
Then("固定Laya dataset digestは変わらない", function () {
  assert.equal(this.firstDigest, this.secondDigest);
});

Given("有効な固定済みLaya training manifestがある", function () {
  this.manifest = validManifest();
});
Given("private sourceのLaya training manifestがある", function () {
  this.processCalls = 0;
  this.manifest = {
    ...validManifest(),
    sourceRepository: "techbeansjp-free/AGENTS.md",
  };
  (this.manifest as { sourceRepository: string }).sourceRepository =
    "private/repository";
});
When("training manifestを検証する", function () {
  validateTrainingManifest(this.manifest!);
  this.operationSucceeded = true;
});
When("隔離Laya runnerが失敗を返す", function () {
  this.checkpointAccepted = false;
});
Then("Laya checkpointは受理されない", function () {
  assert.equal(this.checkpointAccepted, false);
});
When("Laya runner preflightを実行する", function () {
  this.root = fs.realpathSync(this.temp("asc-laya-runner-"));
  fs.writeFileSync(
    path.join(this.root, "manifest.json"),
    JSON.stringify(this.manifest),
  );
  try {
    launchLayaTrainingRunner(
      {
        repositoryRoot: this.root,
        manifestPath: "manifest.json",
        outputPath: "output",
      },
      (..._args) => {
        this.processCalls++;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
  } catch (error) {
    this.error = error;
  }
});
When("Git管理対象pathをLaya runner outputに指定する", function () {
  this.root = fs.realpathSync(this.temp("asc-laya-runner-output-"));
  fs.mkdirSync(path.join(this.root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(this.root, "runs"), { recursive: true });
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain/local/laya-runs"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(this.root, "scripts/laya_training_runner.py"), "");
  fs.writeFileSync(
    path.join(this.root, "runs/train.jsonl"),
    jsonl(trainingRow("runner-train")),
  );
  fs.writeFileSync(
    path.join(this.root, "runs/validation.jsonl"),
    jsonl(trainingRow("runner-validation")),
  );
  writeTrainingEvidence(this.root);
  fs.writeFileSync(
    path.join(this.root, "manifest.json"),
    JSON.stringify(this.manifest),
  );
  this.processCalls = 0;
  try {
    launchLayaTrainingRunner(
      {
        repositoryRoot: this.root,
        manifestPath: "manifest.json",
        outputPath: "dist/candidate-model",
      },
      (..._args) => {
        this.processCalls++;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
  } catch (error) {
    this.error = error;
  }
});
Given("SHA結合後に改変したLaya teacher artifactがある", function () {
  this.root = fs.realpathSync(this.temp("asc-laya-bound-artifact-"));
  fs.mkdirSync(path.join(this.root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(this.root, "runs"), { recursive: true });
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain/local/laya-runs"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(this.root, "scripts/laya_training_runner.py"), "");
  fs.writeFileSync(
    path.join(this.root, "runs/train.jsonl"),
    jsonl(trainingRow("runner-train")),
  );
  fs.writeFileSync(
    path.join(this.root, "runs/validation.jsonl"),
    jsonl(trainingRow("runner-validation")),
  );
  writeTrainingEvidence(this.root);
  fs.appendFileSync(path.join(this.root, "runs/codex.json"), "\n");
  fs.writeFileSync(
    path.join(this.root, "manifest.json"),
    JSON.stringify(validManifest()),
  );
  this.processCalls = 0;
});
When("改変済みartifactでLaya runner preflightを実行する", function () {
  try {
    launchLayaTrainingRunner(
      {
        repositoryRoot: this.root,
        manifestPath: "manifest.json",
        outputPath: ".agent-skill-chain/local/laya-runs/candidate",
      },
      (..._args) => {
        this.processCalls++;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
  } catch (error) {
    this.error = error;
  }
});
Then("Laya processは起動されない", function () {
  assert.equal(this.processCalls, 0);
  assert.ok(this.error);
});

Given("空のLaya artifact directoryがある", function () {
  this.root = fs.realpathSync(this.temp("asc-laya-artifact-"));
});
When("同じLaya artifact pathへ2回公開する", function () {
  writeLayaArtifact(this.root, "generation/result.json", { value: 1 });
  try {
    writeLayaArtifact(this.root, "generation/result.json", { value: 2 });
  } catch (error) {
    this.error = error;
  }
});
Then("2回目のLaya公開は拒否される", function () {
  assert.ok(this.error);
});

Given("Laya runtime統合が有効ではない", function () {
  this.operationSucceeded = true;
});
When("既存review authorityを確認する", function () {
  assert.equal(digestLayaArtifact({ localModelAuthority: false }).length, 64);
});
Then("Layaはformal approvalを付与しない", function () {
  assert.equal(this.operationSucceeded, true);
});
Then("Laya操作は拒否される", function () {
  assert.ok(this.error);
});
Then("Laya操作は成功する", function () {
  assert.equal(this.operationSucceeded, true);
});

Given("sourceだけ更新されdistとschemaが古い配布fixtureがある", function () {
  createFixture(this, "https://github.com/techbeansjp-free/AGENTS.md.git");
  fs.mkdirSync(path.join(this.root, "src/domain"), { recursive: true });
  fs.mkdirSync(path.join(this.root, "dist/src/domain"), { recursive: true });
  fs.writeFileSync(
    path.join(this.root, "src/domain/example.ts"),
    "export const value = 1;\n",
  );
  fs.writeFileSync(
    path.join(this.root, "dist/src/domain/example.js"),
    "export const value = 1;\n",
  );
  git(this.root, "add", ".");
  git(this.root, "commit", "-q", "-m", "add packaged example");
  fs.writeFileSync(
    path.join(this.root, "src/domain/example.ts"),
    "export const value = 2;\n",
  );
  git(this.root, "add", "src/domain/example.ts");
  git(this.root, "commit", "-q", "-m", "change source only");
  this.commit = git(this.root, "rev-parse", "HEAD");
});
When("配布物専用判定を行う", function () {
  this.cases = extractDistributionDecisionCases(this.root, this.commit);
});
Then("配布物のdriftとして検出される", function () {
  const candidate = this.cases.find(
    (item) =>
      item.provenance.artifactPath === "dist/src/domain/example.js" &&
      item.gold["distribution-impact"] === "package-drift",
  );
  assert.equal(candidate?.slice, "distribution");
  assert.equal(candidate?.gold["distribution-impact"], "package-drift");
});

Given("digestと互換版を固定したDecision Bundleがある", function () {
  this.bundle = {
    schemaVersion: LAYA_DECISION_BUNDLE_SCHEMA_VERSION,
    bundleId: "laya/decision-v1",
    model: {
      id: "laya-candidate-v1",
      path: "model.bin",
      weightSha256: "1".repeat(64),
    },
    questionSchemaPath: "question.json",
    questionSchemaSha256: "2".repeat(64),
    thresholdPath: "threshold.json",
    thresholdSha256: "3".repeat(64),
    modelCardPath: "model-card.json",
    modelCardSha256: "4".repeat(64),
    evaluationPath: "evaluation.json",
    evaluationSha256: "5".repeat(64),
    datasetDigest: "6".repeat(64),
    splitDigest: "7".repeat(64),
    sealDigest: "8".repeat(64),
    eligibility: "eligible",
    compatibleAscVersions: ["v0.3.1-beta.195"],
    authority: false,
  };
});
When("異なるweight digestでDecision Bundleを検証する", function () {
  try {
    validateDecisionBundle(this.bundle!, "9".repeat(64), "v0.3.1-beta.195");
  } catch (error) {
    this.error = error;
  }
});
Then("Decision Bundleはmodel利用前に拒否される", function () {
  assert.ok(this.error);
  assert.equal(this.bundle?.authority, false);
});

Given("owner許可済みprivate sourceのdecision candidateがある", function () {
  this.privateCase = createPrivateStructuralCase(
    {
      sourceRepository: "private/example",
      sourceCommit: SHA,
      issueKey: "issue-320",
      rootCauseKey: "deploy-contract",
      observedAt: NOW,
      category: "distribution",
      signals: ["reachable-path", "consumer-failure"],
      claim: "A component omits a required invariant",
      evidence: [
        {
          path: "source/component.ts",
          excerpt: "The component returns an invalid state",
        },
      ],
      gold: "yes",
    },
    {
      pseudonymKey: Buffer.from(PRIVATE_KEY, "hex"),
      corpusSalt: CORPUS_SALT,
      authorizedRepository: "private/example",
      forbiddenLiterals: ["AcmeCustomer", "SecretProject", "private/example"],
    },
  );
});
When("private candidateを共通学習形式へ匿名化する", function () {
  assert.ok(this.privateCase);
});
Then("repository名とraw pathは匿名化済みである", function () {
  const serialized = JSON.stringify(this.privateCase);
  for (const forbidden of [
    "private/example",
    SHA,
    NOW,
    "issue-320",
    "deploy-contract",
    "source/component.ts",
    "A component omits a required invariant",
    "The component returns an invalid state",
  ])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(
    assessPrivateStructuralLeakage(
      [this.privateCase!],
      [
        "issue-320",
        "component.ts",
        "invalid state",
        "AcmeCustomer",
        "private/example",
      ],
    ).eligible,
    true,
  );
  const trainingView = createPrivateStructuralTrainingView(this.privateCase!);
  assert.equal(Object.hasOwn(trainingView, "caseId"), false);
  assert.match(trainingView.input, /^category=[a-z-]+;signals=[a-z,-]+$/u);
  assert.deepEqual(Object.keys(this.privateCase!).sort(), [
    "caseId",
    "category",
    "gold",
    "groupId",
    "sanitizationPolicy",
    "schemaVersion",
    "signals",
    "sourceClass",
  ]);
  const differentSaltCase = createPrivateStructuralCase(
    {
      sourceRepository: "private/example",
      sourceCommit: SHA,
      issueKey: "issue-320",
      rootCauseKey: "deploy-contract",
      observedAt: NOW,
      category: "distribution",
      signals: ["reachable-path", "consumer-failure"],
      claim: "A component omits a required invariant",
      evidence: [
        {
          path: "source/component.ts",
          excerpt: "The component returns an invalid state",
        },
      ],
      gold: "yes",
    },
    {
      pseudonymKey: Buffer.from(PRIVATE_KEY, "hex"),
      corpusSalt:
        "123456789abcdef00fedcba987654321abcdef00123456789fedcba987654321",
      authorizedRepository: "private/example",
      forbiddenLiterals: ["AcmeCustomer", "SecretProject", "private/example"],
    },
  );
  assert.notEqual(differentSaltCase.caseId, this.privateCase!.caseId);
});

Given("識別可能情報を含むprivate source candidateがある", function () {
  try {
    createPrivateStructuralCase(
      {
        sourceRepository: "private/example",
        sourceCommit: SHA,
        issueKey: "issue-320",
        rootCauseKey: "deploy-contract",
        observedAt: NOW,
        category: "data-validation",
        signals: ["static-evidence"],
        claim: "Contact Owner@Example.com before training SecretProject",
        evidence: [{ path: "src/example.ts", excerpt: "return deployment;" }],
        gold: "yes",
      },
      {
        pseudonymKey: Buffer.from(PRIVATE_KEY, "hex"),
        corpusSalt: CORPUS_SALT,
        authorizedRepository: "private/example",
        forbiddenLiterals: ["secretproject", "private/example"],
      },
    );
  } catch (error) {
    this.error = error;
  }
});
When("private candidateの匿名化を検証する", function () {
  // Sanitization runs while constructing the fixture.
});
Then("private candidateは学習前に拒否される", function () {
  assert.ok(this.error);
});

Given("private固有情報の攻撃fixtureがある", function () {
  this.attackFailures = 0;
  this.attackCount = 15;
});
When("全fixtureをprivate構造caseへ変換する", function () {
  const values = [
    "owner@example.com",
    "https://private.example/path",
    "arn:aws:iam::123456789012:role/private",
    "/Users/person/project/file.ts",
    "10.20.30.40",
    "password=private-value",
    "github_pat_abcdefghijklmnopqrstuvwxyz",
    "SecretProject",
    "ＳｅｃｒｅｔＰｒｏｊｅｃｔ",
    "550e8400-e29b-41d4-a716-446655440000",
    "C:\\Users\\person\\private.ts",
    "git@private.example:owner/repository.git",
    "service.internal",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
    "ｐａｓｓｗｏｒｄ＝private-value",
  ];
  for (const [index, privateValue] of values.entries()) {
    try {
      createPrivateStructuralCase(
        {
          sourceRepository: "private/example",
          sourceCommit: SHA,
          issueKey: `issue-${index}`,
          rootCauseKey: `cause-${index}`,
          observedAt: NOW,
          category: "data-validation",
          signals: ["static-evidence"],
          claim: `Finding ${privateValue}`,
          evidence: [{ path: "internal/file.ts", excerpt: "generic evidence" }],
          gold: "yes",
        },
        {
          authorizedRepository: "private/example",
          pseudonymKey: Buffer.from(PRIVATE_KEY, "hex"),
          corpusSalt: CORPUS_SALT,
          forbiddenLiterals: ["SecretProject", "private/example"],
        },
      );
    } catch {
      this.attackFailures++;
    }
  }
});
Then("全てのprivate固有情報fixtureが拒否される", function () {
  assert.equal(this.attackFailures, this.attackCount);
});

Given("Git管理外のprivate authorization fileがある", function () {
  this.root = fs.realpathSync(this.temp("laya-private-auth-"));
  this.authorizationPath = path.join(this.root, "authorization.json");
  fs.writeFileSync(
    this.authorizationPath,
    JSON.stringify({
      schemaVersion: "asc/laya-private-authorization/v1",
      repository: "private/example",
      remote: "git@example.invalid:private/example.git",
      revision: SHA,
      inputSha256: DIGEST,
      keyId: "3".repeat(64),
      sanitizerVersion: "asc/laya-private-structural/v1",
      structuralSchemaVersion: "asc/laya-private-structural-case/v1",
      forbiddenLiterals: ["PrivateExample"],
    }),
  );
  fs.chmodSync(this.authorizationPath, 0o600);
});
When("異なるowner承認digestでauthorizationを読む", function () {
  try {
    readPrivateCorpusAuthorization(this.authorizationPath, {
      schemaVersion: "asc/laya-private-authorization-pins/v1",
      sha256: ["9".repeat(64)],
    });
  } catch (error) {
    this.error = error;
  }
});

When("repository内をprivate corpus storeに指定する", function () {
  try {
    assertExternalPrivateStore(
      this.root,
      path.join(this.root, "private-store"),
    );
  } catch (error) {
    this.error = error;
  }
});

Given("trusted refには空のauthorization pinがある", function () {
  this.root = fs.realpathSync(this.temp("laya-trusted-pin-"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: this.root }).status, 0);
  assert.equal(
    spawnSync(
      "git",
      [
        "remote",
        "add",
        "origin",
        "https://github.com/techbeansjp-free/AGENTS.md.git",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
  const pinPath = path.join(
    this.root,
    ".agent-skill-chain/policy/laya-private-training-authorization-pins.json",
  );
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });
  fs.writeFileSync(
    pinPath,
    JSON.stringify({
      schemaVersion: "asc/laya-private-authorization-pins/v1",
      sha256: [],
    }),
  );
  assert.equal(
    spawnSync(
      "git",
      [
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "add",
        ".",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
  assert.equal(
    spawnSync(
      "git",
      [
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "trusted",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
  assert.equal(
    spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: this.root,
      encoding: "utf8",
    }).status,
    0,
  );
  this.commit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  fs.writeFileSync(
    pinPath,
    JSON.stringify({
      schemaVersion: "asc/laya-private-authorization-pins/v1",
      sha256: ["9".repeat(64)],
    }),
  );
  assert.equal(
    spawnSync(
      "git",
      [
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "add",
        ".",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
  assert.equal(
    spawnSync(
      "git",
      [
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "candidate-self-pin",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
  assert.equal(
    spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
      cwd: this.root,
    }).status,
    0,
  );
  assert.equal(
    spawnSync("git", ["tag", "v0.3.1-beta.999999"], {
      cwd: this.root,
    }).status,
    0,
  );
  assert.equal(
    spawnSync(
      "git",
      [
        "config",
        "--local",
        "url.https://attacker.invalid/fake.git.insteadOf",
        "https://github.com/techbeansjp-free/AGENTS.md.git",
      ],
      { cwd: this.root },
    ).status,
    0,
  );
});
When("candidateだけでauthorization pinを追加する", async function () {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input): Promise<Response> => {
    const url = String(input);
    if (
      url ===
      "https://api.github.com/repos/techbeansjp-free/AGENTS.md/git/ref/heads/main"
    )
      return new Response(JSON.stringify({ object: { sha: this.commit } }), {
        status: 200,
      });
    if (
      url ===
      `https://raw.githubusercontent.com/techbeansjp-free/AGENTS.md/${this.commit}/.agent-skill-chain/policy/laya-private-training-authorization-pins.json`
    )
      return new Response(
        JSON.stringify({
          schemaVersion: "asc/laya-private-authorization-pins/v1",
          sha256: [],
        }),
        { status: 200 },
      );
    throw new Error("unexpected URL");
  };
  try {
    this.trustedPinCount = (
      await readTrustedPrivateAuthorizationPins()
    ).sha256.length;
  } catch (error) {
    this.error = error;
  } finally {
    globalThis.fetch = originalFetch;
  }
});
Then("candidate追加pinは信頼されない", function () {
  assert.equal(this.error, undefined);
  assert.equal(this.trustedPinCount, 0);
});

Given("private corpus用にGit worktreeの差替え先がある", function () {
  this.gitTarget = fs.realpathSync(this.temp("laya-output-race-target-"));
  assert.equal(
    spawnSync("git", ["init", "-q"], { cwd: this.gitTarget }).status,
    0,
  );
});
When("固定済みoutput directoryをsymlinkへ差し替える", function () {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  writePrivateCorpusNoReplace(
    path.join(temporaryRoot, "asc-laya-race"),
    "corpus.json",
    '{"safe":true}\n',
    (runRoot) => {
      this.movedRoot = `${runRoot}-moved`;
      fs.renameSync(runRoot, this.movedRoot);
      fs.symlinkSync(this.gitTarget, runRoot);
    },
  );
});
Then("corpusはGit worktreeへ書かれない", function () {
  assert.equal(fs.existsSync(path.join(this.gitTarget, "corpus.json")), false);
  assert.equal(
    fs.readFileSync(path.join(this.movedRoot, "corpus.json"), "utf8"),
    '{"safe":true}\n',
  );
});

Given("loopbackのLaya Decision Providerがある", function () {
  const provider = new LayaDecisionProvider(
    {
      endpoint: "http://127.0.0.1:11435",
      modelId: "laya-common-v1",
      timeoutMs: 1000,
      minimumConfidence: 0.8,
      maximumResponseBytes: 4096,
    },
    async () => ({
      status: 200,
      body: JSON.stringify({ answer: "yes", confidence: 0.4 }),
    }),
  );
  (this as LayaWorld & { provider?: LayaDecisionProvider }).provider = provider;
});
When("低confidenceの判断を要求する", async function () {
  const provider = (this as LayaWorld & { provider: LayaDecisionProvider })
    .provider;
  const result = await provider.decide({
    questionId: "finding-validity",
    claim: "claim",
    evidence: [{ artifactId: "artifact-1", excerpt: "evidence" }],
  });
  this.decisionState = result.state;
});
Then("Decision Providerはdegradedへ退避する", function () {
  assert.equal(this.decisionState, "degraded");
});
