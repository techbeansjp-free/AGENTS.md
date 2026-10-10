import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { readWorkflowJournal } from "./workflow-journal.js";
import { assertPlanFrozenForEntries } from "./plan-seal.js";
import {
  latestPlanSeal,
  PLAN_AMENDMENT_FILE,
  planAmendmentDigests,
} from "../domain/plan-seal.js";
import { git } from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";
import { validateDeliveryEvidence } from "../domain/delivery.js";
import {
  parseReviewEvidence,
  type ReviewIndependenceMode,
} from "../domain/review-evidence.js";
import type { VerificationPolicy } from "../domain/verification-run.js";
import type { DeliveryEvidenceInput } from "./json-input.js";
import { verifyReviewEvidenceWithStaging } from "./review-evidence.js";
import { GIT_ENV } from "./review-diff.js";
import { scenarioKeywords, gherkinStepKeywords } from "../domain/issue.js";
import { loadProjectPolicySetAtCommit } from "../domain/policy.js";
import type { ReviewEvidence } from "../domain/review-evidence.js";

const MAX_BYTES = 256 * 1024;
const TOKENS = ["ASC_VERIFICATION", "ASC_REVIEW", "ASC_HEAD"] as const;

function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    throw new Error("delivery summaryの必須fieldまたは未知fieldが不正です");
  return value;
}

function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim() === "") ||
    new Set(value).size !== value.length
  )
    throw new Error(
      "delivery summaryには重複のない空でない文字列配列が必要です",
    );
  return value as string[];
}

/** Only an immutable regular Git blob is input; filesystem edits are never read. */
export function readDeliveryBlob(
  root: string,
  commit: string,
  relative: string,
  maximumBytes = MAX_BYTES,
): string {
  if (
    !/^[a-f0-9]{40}$/u.test(commit) ||
    relative === "" ||
    path.posix.normalize(relative) !== relative ||
    path.isAbsolute(relative) ||
    relative.split("/").some((part) => part === ".." || part === ".git") ||
    /[\\\x00-\x1f\x7f]/u.test(relative)
  )
    throw new Error("delivery summaryは正規化済みrepository相対pathが必要です");
  const entries = git(["ls-tree", "-z", commit, "--", relative], root, {
    env: GIT_ENV,
  })
    .stdout.split("\0")
    .filter(Boolean);
  const match =
    entries.length === 1
      ? /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/u.exec(entries[0]!)
      : null;
  if (!match || match[3] !== relative)
    throw new Error(
      "delivery summary/reviewは対象commitの通常Git blobが必要です",
    );
  const oid = match[2]!;
  const size = Number(
    git(["cat-file", "-s", oid], root, { env: GIT_ENV }).stdout.trim(),
  );
  if (!Number.isSafeInteger(size) || size < 1 || size > maximumBytes)
    throw new Error(`delivery Git blobは${maximumBytes}byte以下が必要です`);
  return git(["cat-file", "blob", oid], root, {
    env: GIT_ENV,
    maxBufferBytes: maximumBytes,
  }).stdout;
}

export function parseDeliverySummary(source: string, issue: number) {
  const value = fields(
    parseJsonStrict(source, "delivery summary"),
    ["schemaVersion", "issue", "body", "scenarioIds", "spec"],
    ["ownership"],
  );
  if (
    value.schemaVersion !== "asc-delivery-summary/v1" ||
    value.issue !== issue ||
    !Number.isSafeInteger(issue) ||
    issue < 1 ||
    typeof value.body !== "string" ||
    Buffer.byteLength(source, "utf8") > MAX_BYTES
  )
    throw new Error("delivery summaryのschemaVersion/issue/bodyが不正です");
  const body = value.body;
  const found = body.match(/\{\{ASC_[^{}\r\n]*\}\}/gu) ?? [];
  if (
    found.length !== TOKENS.length ||
    TOKENS.some(
      (token) => found.filter((item) => item === `{{${token}}}`).length !== 1,
    )
  )
    throw new Error(
      "delivery summaryのASC_VERIFICATION/ASC_REVIEW/ASC_HEADは各1回必要です",
    );
  const scenarioIds = strings(value.scenarioIds);
  const spec = fields(
    value.spec,
    ["consistent", "impact"],
    ["rationale", "trace"],
  );
  if (
    typeof spec.consistent !== "boolean" ||
    !["updated", "no-spec-impact"].includes(String(spec.impact)) ||
    (spec.rationale !== undefined && typeof spec.rationale !== "string")
  )
    throw new Error("delivery summaryのspec明示宣言が不正です");
  const trace = fields(spec.trace, ["tests"], ["requirements", "scenarios"]);
  strings(trace.tests);
  for (const key of ["requirements", "scenarios"])
    if (trace[key] !== undefined) strings(trace[key]);
  let ownership: Record<string, unknown> | undefined;
  if (value.ownership !== undefined) {
    ownership = fields(value.ownership, ["classified", "owner", "targetLayer"]);
    if (
      ownership.classified !== true ||
      typeof ownership.owner !== "string" ||
      ownership.owner.trim() === "" ||
      typeof ownership.targetLayer !== "string" ||
      !["package", "project", "spec", "evidence"].includes(
        ownership.targetLayer,
      )
    )
      throw new Error("delivery summaryのownership明示宣言が不正です");
  }
  return { body, scenarioIds, spec, ownership };
}

const SOURCE_BYTES = 4 * 1024 * 1024;
function containsId(text: string, id: string): boolean {
  return new RegExp(
    `(^|[^A-Z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[^A-Za-z0-9-])`,
    "mu",
  ).test(text);
}

/** Only sealed planning definitions register SCNs; test comments never do. */
function planningScenarioIds(
  staging: string,
  head: string,
  keywords: readonly string[],
  steps: readonly string[],
): Set<string> {
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length) throw new Error(journal.errors.join("; "));
  const seal = latestPlanSeal(journal.entries);
  if (!seal) throw new Error("delivery summaryには正式計画の封印が必要です");
  const generation = assertPlanFrozenForEntries(
    staging,
    journal.entries,
    head,
    { delivery: true },
  );
  const read = (name: string): string | undefined => {
    const file = path.join(staging, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return undefined;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > SOURCE_BYTES ||
      fs.realpathSync(file) !== path.join(fs.realpathSync(staging), name)
    )
      throw new Error("delivery summaryの正式計画は境界内の通常fileが必要です");
    return fs.readFileSync(file, "utf8");
  };
  const name =
    journal.entries[seal.index]?.mode === "full"
      ? "01_要件定義.md"
      : "00_要求定義.md";
  const source = read(name);
  if (
    source === undefined ||
    crypto.createHash("sha256").update(source).digest("hex") !== seal.seal[name]
  )
    throw new Error("delivery summaryの正式計画が封印と一致しません");
  const texts = [source];
  const amendment = read(PLAN_AMENDMENT_FILE);
  if (
    JSON.stringify(planAmendmentDigests(amendment)) !==
    JSON.stringify(generation?.amendments ?? [])
  )
    throw new Error("delivery summaryのAMDがreview済み世代と一致しません");
  // Include only digest-bound AMD entries, never the unbound document preamble.
  if (amendment !== undefined) {
    let fenced = false;
    let current: string[] | undefined;
    const blocks: string[][] = [];
    for (const line of amendment.split("\n")) {
      const plain = line.replace(/\r$/u, "");
      if (/^\s*(?:```|~~~)/u.test(plain)) fenced = !fenced;
      if (!fenced && /^##\s/u.test(plain)) {
        current = /^##\s+AMD-\d{3}(?:\s|$)/u.test(plain) ? [] : undefined;
        if (current) blocks.push(current);
      }
      current?.push(line);
    }
    texts.push(...blocks.map((block) => block.join("\n")));
  }
  const ids = new Set<string>();
  for (const text of texts) {
    let docString: string | undefined;
    let rawScenario = false;
    let markdownFence: { marker: string; gherkin: boolean } | undefined;
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (docString !== undefined) {
        if (trimmed === docString) docString = undefined;
        continue;
      }
      if (/^ {0,3}#{1,6}\s/u.test(line)) rawScenario = false;
      if (
        markdownFence === undefined &&
        (trimmed.startsWith("* ") ||
          steps.some(
            (keyword) =>
              trimmed === keyword ||
              (trimmed.startsWith(keyword) &&
                /^\s/u.test(trimmed.slice(keyword.length))),
          ))
      )
        rawScenario = true;
      // Raw Gherkin also accepts backtick Doc Strings. Once a raw Scenario
      // starts, an ambiguous triple backtick belongs to it, not a new wrapper.
      if (
        markdownFence === undefined &&
        rawScenario &&
        trimmed.startsWith("```")
      ) {
        docString = "```";
        continue;
      }
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (
        markdownFence !== undefined &&
        fence?.[1] === markdownFence.marker &&
        fence[2]?.trim() === ""
      ) {
        markdownFence = undefined;
        rawScenario = false;
        continue;
      }
      if (markdownFence === undefined && fence !== null) {
        markdownFence = {
          marker: fence[1]!,
          gherkin: ["", "gherkin"].includes(fence[2]!.trim().toLowerCase()),
        };
        continue;
      }
      if (markdownFence !== undefined && !markdownFence.gherkin) continue;
      if (trimmed.startsWith('"""') || trimmed.startsWith("```")) {
        docString = trimmed.slice(0, 3);
        continue;
      }
      if (!keywords.some((keyword) => trimmed.startsWith(`${keyword}:`)))
        continue;
      const id = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .trim()
        .split(/\s+/u)[0];
      if (id) {
        ids.add(id);
        if (markdownFence === undefined) rawScenario = true;
      }
    }
  }
  return ids;
}

/** Resolve declarations against bounded Git sources; execution semantics remain the trusted runner/review contract. */
function assertSummarySources(
  input: {
    root: string;
    staging: string;
    headSha: string;
    implementationHeadSha: string;
    summaryPath: string;
  },
  summary: ReturnType<typeof parseDeliverySummary>,
  review: ReviewEvidence,
): void {
  const trace = fields(
    summary.spec.trace,
    ["tests"],
    ["requirements", "scenarios"],
  );
  const tests = strings(trace.tests);
  if (tests.length > 256)
    throw new Error("delivery summaryのtest根拠は256file以下が必要です");
  const dialect =
    loadProjectPolicySetAtCommit(input.root, input.implementationHeadSha).policy
      .projectChoices?.gherkinDialect ?? "en";
  const keywords = scenarioKeywords(dialect);
  const registered = planningScenarioIds(
    input.staging,
    input.headSha,
    keywords,
    gherkinStepKeywords(dialect),
  );
  for (const id of summary.scenarioIds)
    if (!registered.has(id))
      throw new Error(`delivery summaryのSCNが正式計画にありません: ${id}`);
  const found = new Set<string>();
  let hasFeature = false;
  let totalBytes = 0;
  for (const file of tests) {
    if (
      file === input.summaryPath ||
      file.startsWith("docs/reviews/") ||
      file.startsWith(".agent-skill-chain/reviews/")
    )
      throw new Error("delivery summary/reviewをtest根拠へ自己参照できません");
    if (
      !review.observed.verification.some(
        (record) => record.scope === "full" || record.command.includes(file),
      )
    )
      throw new Error(
        `delivery summaryのtest根拠が正式検証範囲にありません: ${file}`,
      );
    const text = readDeliveryBlob(
      input.root,
      input.implementationHeadSha,
      file,
      SOURCE_BYTES,
    );
    totalBytes += Buffer.byteLength(text, "utf8");
    if (totalBytes > 16 * 1024 * 1024)
      throw new Error("delivery summaryのsource観測が16MiBを超えました");
    let observed = "";
    if (file.endsWith(".feature")) {
      hasFeature = true;
      let fence: string | undefined;
      observed = text
        .split(/\r?\n/u)
        .filter((line) => {
          const trimmed = line.trim();
          if (fence !== undefined) {
            if (trimmed.startsWith(fence)) fence = undefined;
            return false;
          }
          if (trimmed.startsWith('"""') || trimmed.startsWith("```")) {
            fence = trimmed.slice(0, 3);
            return false;
          }
          return keywords.some((keyword) => trimmed.startsWith(`${keyword}:`));
        })
        .map(
          (line) =>
            line
              .slice(line.indexOf(":") + 1)
              .trim()
              .split(/\s+/u)[0] ?? "",
        )
        .join("\n");
    }
    for (const id of summary.scenarioIds)
      if (containsId(observed, id)) found.add(id);
  }
  for (const id of summary.scenarioIds)
    if (hasFeature && !found.has(id))
      throw new Error(`delivery summaryのSCNが固定test根拠にありません: ${id}`);
  if (trace.scenarios !== undefined) {
    const declared = strings(trace.scenarios);
    if (
      declared.length !== summary.scenarioIds.length ||
      declared.some((id) => !summary.scenarioIds.includes(id))
    )
      throw new Error(
        "delivery summaryのtrace.scenariosとscenarioIdsが一致しません",
      );
  }
  if (summary.spec.impact === "updated") {
    const requirements = strings(trace.requirements);
    const files = git(
      [
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        input.implementationHeadSha,
        "--",
        "docs/specs/02_要件/",
      ],
      input.root,
      { env: GIT_ENV },
    )
      .stdout.split("\0")
      .filter(Boolean);
    if (files.length > 256)
      throw new Error("delivery summaryの正式要件観測は256file以下が必要です");
    const known = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const text = readDeliveryBlob(
        input.root,
        input.implementationHeadSha,
        file,
        SOURCE_BYTES,
      );
      totalBytes += Buffer.byteLength(text, "utf8");
      if (totalBytes > 16 * 1024 * 1024)
        throw new Error("delivery summaryのsource観測が16MiBを超えました");
      for (const id of requirements) if (containsId(text, id)) known.add(id);
    }
    for (const id of requirements)
      if (!known.has(id))
        throw new Error(
          `delivery summaryの要件IDが正式仕様にありません: ${id}`,
        );
  }
}

/** Semantic declarations come from the reviewed implementation blob; success comes from observations. */
export function generateDeliveryInput(input: {
  root: string;
  staging: string;
  issue: number;
  summaryPath: string;
  headSha: string;
  implementationHeadSha: string;
  independenceMode: ReviewIndependenceMode;
  verificationPolicy: VerificationPolicy;
}): { body: string; evidence: DeliveryEvidenceInput } {
  const summary = parseDeliverySummary(
    readDeliveryBlob(
      input.root,
      input.implementationHeadSha,
      input.summaryPath,
    ),
    input.issue,
  );
  const review = parseReviewEvidence(
    readDeliveryBlob(
      input.root,
      input.headSha,
      `docs/reviews/${input.issue}_review.json`,
    ),
  );
  if (
    review.issue !== input.issue ||
    review.observed.implementationHeadSha !== input.implementationHeadSha
  )
    throw new Error("delivery summaryと正式reviewのIssue/H_implが一致しません");
  const errors = verifyReviewEvidenceWithStaging({
    staging: input.staging,
    evidence: review,
    independenceMode: input.independenceMode,
    verificationPolicy: input.verificationPolicy,
  });
  if (errors.length > 0)
    throw new Error(
      `delivery summaryの正式review/検証が不正です: ${errors.join("; ")}`,
    );
  const changedPaths = git(
    [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      review.observed.baseSha,
      input.implementationHeadSha,
      "--",
    ],
    input.root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean);
  if (
    summary.spec.impact === "no-spec-impact" &&
    changedPaths.some((file) => file.startsWith("docs/specs/"))
  )
    throw new Error(
      "delivery summaryのno-spec-impactは正式docs/specs変更と矛盾します",
    );
  assertSummarySources(input, summary, review);
  const evidence: DeliveryEvidenceInput = {
    headSha: input.headSha,
    review: { approved: true, headSha: input.headSha },
    tests: {
      passed: true,
      headSha: input.headSha,
      scenarioIds: summary.scenarioIds,
    },
    spec: { ...summary.spec, headSha: input.headSha },
    ...(summary.ownership ? { ownership: summary.ownership } : {}),
  };
  validateDeliveryEvidence(evidence, input.headSha);
  const replacements: Record<(typeof TOKENS)[number], string> = {
    ASC_HEAD: `H_impl: ${input.implementationHeadSha}; PR HEAD: ${input.headSha}`,
    ASC_REVIEW: `approved; evidenceDigest: ${review.evidenceDigest}; roundDigest: ${review.observed.session.latestRoundDigest}`,
    ASC_VERIFICATION: review.observed.verification
      .map(
        (record) =>
          `scope=${record.scope}; exitCode=${record.exitCode}; recordDigest=${record.recordDigest}; command=${JSON.stringify(record.command)}`,
      )
      .join("\n"),
  };
  const body = summary.body.replace(
    /\{\{(ASC_VERIFICATION|ASC_REVIEW|ASC_HEAD)\}\}/gu,
    (_match, token: (typeof TOKENS)[number]) => replacements[token],
  );
  return { body, evidence };
}
