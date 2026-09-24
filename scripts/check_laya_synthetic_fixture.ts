import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  evaluateLayaValidationPredictions,
  validateLayaValidationPredictions,
} from "../src/domain/laya-training-contract.js";

const ROOT = path.resolve("docs/evidence/1480-laya-training/dataset");
const EXPECTED_HASHES = new Map([
  [
    "problem-set.json",
    "8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b",
  ],
  [
    "teacher-codex-legacy.jsonl",
    "6d1fed7950520941fede6a0b3c79ad702a8e98f92d809bde12185ffee6f451e5",
  ],
  [
    "teacher-opus-legacy.jsonl",
    "3c015cd8fb708e834d4b564c673e3f863a5cf4f372147c91128e2890246864e6",
  ],
  [
    "validation-predictions-legacy.jsonl",
    "fd2a2f4ffc7fd020d00e2cabbcead8db2841d64bdc6ebdbcbf879b3af2f4db78",
  ],
]);

// 公開source上に組織・案件固有の名称を平文で置かないため、案件固有markerは
// .agent-skill-chain/local/ 配下のgitignore対象fileから読み込む。
// 汎用markerだけが public source に残る。
const GENERIC_PRIVATE_MARKERS = [
  /\/Users\//u,
  /\/Volumes\//u,
  /\/private\//u,
  /https?:\/\//iu,
  /git@/iu,
  /github\.com/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
];

const LOCAL_TERMS_PATH = path.resolve(
  ".agent-skill-chain/local/laya-private-fixture-terms.json",
);

function loadOrgSpecificMarkers(): RegExp[] {
  if (!fs.existsSync(LOCAL_TERMS_PATH))
    fail(
      `${LOCAL_TERMS_PATH} が見つかりません。組織・案件固有の禁止語をローカルのみで用意してください（このfileはgit管理外）。`,
    );
  const raw = JSON.parse(fs.readFileSync(LOCAL_TERMS_PATH, "utf8")) as {
    terms: string[];
  };
  if (!Array.isArray(raw.terms) || raw.terms.length === 0)
    fail(`${LOCAL_TERMS_PATH} の terms は空にできません。`);
  return raw.terms.map(
    (term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"),
  );
}

const PRIVATE_MARKERS = [
  ...GENERIC_PRIVATE_MARKERS,
  ...loadOrgSpecificMarkers(),
];

function fail(message: string): never {
  throw new Error(message);
}

function lines(source: string): string[] {
  return source.split(/\r?\n/u).filter((line) => line.length > 0);
}

const sources = new Map<string, string>();
for (const [name, expectedHash] of EXPECTED_HASHES) {
  const source = fs.readFileSync(path.join(ROOT, name), "utf8");
  const actualHash = crypto.createHash("sha256").update(source).digest("hex");
  if (actualHash !== expectedHash)
    fail(`${name} SHA-256 mismatch: ${actualHash}`);
  const marker = PRIVATE_MARKERS.find((pattern) => pattern.test(source));
  if (marker) fail(`${name} contains rejected private marker: ${marker}`);
  sources.set(name, source);
}

const problemSet = JSON.parse(sources.get("problem-set.json")!) as {
  cases: Array<{ groupId: string }>;
  sealDigest: string;
  split: {
    splitDigest: string;
    partitions: Record<string, string[]>;
  };
};
if (problemSet.cases.length !== 1000)
  fail("problem set must contain 1000 cases");
if (new Set(problemSet.cases.map((entry) => entry.groupId)).size !== 100)
  fail("problem set must contain 100 groups");
const expectedPartitions = {
  train: 700,
  validation: 100,
  holdout: 100,
  reserve: 100,
};
for (const [partition, expected] of Object.entries(expectedPartitions)) {
  if (problemSet.split.partitions[partition]?.length !== expected)
    fail(`${partition} must contain ${expected} cases`);
}
if (
  problemSet.sealDigest !==
  "ba0dd4e7ad067c46b3e7e57520633d55796aef4a0991ebcf3f23780074b955fd"
)
  fail("seal digest mismatch");
if (
  problemSet.split.splitDigest !==
  "239106854e92a969bc712952c02f95f2fd779f8f30e31166168199713097e1c0"
)
  fail("split digest mismatch");

for (const name of [
  "teacher-codex-legacy.jsonl",
  "teacher-opus-legacy.jsonl",
]) {
  if (lines(sources.get(name)!).length !== 2400)
    fail(`${name} must contain 2400 answers`);
}

const predictions = validateLayaValidationPredictions(
  sources.get("validation-predictions-legacy.jsonl")!,
);
const evaluation = evaluateLayaValidationPredictions(predictions);
if (evaluation.safety.criticalRecall !== 4 / 12)
  fail(`critical recall mismatch: ${evaluation.safety.criticalRecall}`);
if (evaluation.safety.criticalMissCaseIds.length !== 8)
  fail("critical miss count must be 8");
if (evaluation.safety.falseEscalationRate !== 0.575)
  fail(`false escalation mismatch: ${evaluation.safety.falseEscalationRate}`);

console.log(
  JSON.stringify({
    valid: true,
    cases: problemSet.cases.length,
    groups: 100,
    teacherAnswers: { codex: 2400, opus: 2400 },
    predictions: predictions.length,
    criticalRecall: evaluation.safety.criticalRecall,
    criticalMisses: evaluation.safety.criticalMissCaseIds.length,
    falseEscalationRate: evaluation.safety.falseEscalationRate,
  }),
);
