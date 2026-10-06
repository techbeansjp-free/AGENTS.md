import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { deriveWorkflowResume } from "../../src/domain/workflow-resume.js";
import { observeWorkflowHandoff } from "../../src/adapters/workflow-handoff.js";
import { evaluateEvidenceReanchor } from "../../src/adapters/evidence-reanchor.js";
import { exportReviewEvidence } from "../../src/adapters/review-evidence.js";
import {
  assertConvergedReviewSession,
  buildReviewRoundDraft,
  observeReviewDiff,
  previewReviewRound,
} from "../../src/adapters/review-session.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { stableJson } from "../../src/lib/security.js";
import {
  advanceReviewSession,
  effectiveReviewBlocking,
  isReviewSessionConverged,
  latestReviewFindingObservations,
  parseReviewRoundInput,
  parseReviewSessionState,
  pendingReviewFindingIds,
  reviewSessionId,
  type ReviewRoundFinding,
  type ReviewRoundInput,
  type ReviewRoundRecord,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  createReviewEvidence,
  validateReviewEvidenceAgainstSession,
  unresolvedCriticalHighFindings,
  type ReviewEvidence,
} from "../../src/domain/review-evidence.js";

interface ConformanceWorld extends WorkflowWorld {
  session: ReviewSessionState;
  legacy: ReviewSessionState[];
  root: string;
  staging: string;
  draft: ReturnType<typeof buildReviewRoundDraft>;
  gateErrors: unknown[];
  legacySnapshot: string;
  handoff: ReturnType<typeof observeWorkflowHandoff>;
}
const { Given, When, Then } = stepDefinitions<ConformanceWorld>();
const anchor = {
  scopeIds: ["SCOPE-01"],
  acceptanceCriteriaIds: ["AC-01"],
  invariantIds: ["INV-01"],
  diffBaseSha: "a".repeat(40),
  initialHeadSha: "b".repeat(40),
  initialDiffDigest: "c".repeat(64),
};
function finding(
  overrides: Partial<ReviewRoundFinding> = {},
): ReviewRoundFinding {
  return {
    id: "F-01",
    severity: "Medium",
    status: "valid",
    source: "review",
    relation: "acceptance-violation",
    evidence: "固定契約との不一致を再現した",
    path: "src/example.ts",
    contractId: "AC-01",
    causedByFindingId: null,
    ...overrides,
  };
}
function initial(findings: ReviewRoundFinding[]): ReviewSessionState {
  return advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor,
      candidateHeadSha: anchor.initialHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings,
    }),
  );
}
function next(
  session: ReviewSessionState,
  findings: readonly ReviewRoundFinding[],
  overrides: Partial<ReviewRoundInput> = {},
): ReviewRoundInput {
  return parseReviewRoundInput({
    round: session.rounds.length + 1,
    previousRoundDigest: session.latestRoundDigest,
    anchor: session.anchor,
    candidateHeadSha: "e".repeat(40),
    focus: {
      previousBlocking: effectiveReviewBlocking(session),
      fixedDiff: ["src/example.ts"],
      adjacentScope: [],
    },
    findings,
    ...overrides,
  });
}
function readLegacy(name: string): ReviewSessionState {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      new URL(
        `../fixtures/review-conformance/legacy-${name}-session.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const parsed = parseReviewSessionState(raw);
  assert.equal(stableJson(parsed), stableJson(raw));
  return parsed;
}
/** Test-only resealing builds historical counterexamples; it never derives admission. */
function reseal(session: ReviewSessionState): ReviewSessionState {
  let digest: string | null = null;
  const rounds = session.rounds.map((record) => {
    const { roundDigest: _old, ...body } = record;
    void _old;
    body.previousRoundDigest = digest;
    digest = crypto.createHash("sha256").update(stableJson(body)).digest("hex");
    return { ...body, roundDigest: digest };
  });
  return {
    ...session,
    rounds,
    sessionId: reviewSessionId(session.anchor),
    latestRoundDigest: digest!,
  };
}
Given("固定契約admissionの入力がある", function () {
  this.session = initial([]);
});
When("一般改善と固定契約違反を全severityで評価する", function () {
  const findings: ReviewRoundFinding[] = [];
  for (const severity of ["Critical", "High", "Medium", "Low"] as const) {
    findings.push(finding({ id: `AC-${severity.toUpperCase()}`, severity }));
    findings.push(
      finding({
        id: `INV-${severity.toUpperCase()}`,
        severity,
        relation: "invariant-violation",
        contractId: "INV-01",
      }),
    );
    findings.push(
      finding({
        id: `IMP-${severity.toUpperCase()}`,
        severity,
        relation: "improvement",
        contractId: null,
      }),
    );
  }
  this.session = initial(findings);
});
Then("一般改善はrecord-onlyで固定契約違反はblock-currentになる", function () {
  const record = this.session.rounds[0]!;
  assert.equal(record.admissionPolicyVersion, 2);
  assert.equal(record.blocking.length, 8);
  assert.equal(record.recordOnly.length, 4);
  for (const f of record.findings)
    assert.equal(
      f.admission,
      f.relation === "improvement" ? "record-only" : "block-current",
    );
  const improvements = initial([
    finding({ relation: "improvement", contractId: null }),
  ]);
  assert.equal(isReviewSessionConverged(improvements), true);
  assert.throws(
    () =>
      advanceReviewSession(
        improvements,
        next(improvements, [], {
          candidateHeadSha: improvements.latestCandidateHeadSha,
          focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
        }),
      ),
    /収束後/,
  );
});
When("固定契約blockerのseverityをLowへ下げる", function () {
  this.session = initial([finding({ severity: "High" })]);
  this.session = advanceReviewSession(
    this.session,
    next(this.session, [finding({ severity: "Low" })]),
  );
});
Then("validな固定契約blockerが残る", function () {
  assert.deepEqual(effectiveReviewBlocking(this.session), ["F-01"]);
  assert.equal(isReviewSessionConverged(this.session), false);
  assert.deepEqual(unresolvedCriticalHighFindings(this.session), ["F-01"]);
});
Then("固定契約を持たないMediumの修正回帰はrecord-onlyである", function () {
  const s = initial([finding()]);
  const result = advanceReviewSession(
    s,
    next(s, [
      finding({ status: "resolved" }),
      finding({
        id: "REG-01",
        relation: "fix-regression",
        contractId: null,
        causedByFindingId: "F-01",
      }),
    ]),
  );
  assert.deepEqual(result.rounds.at(-1)!.recordOnly, ["F-01", "REG-01"]);
  assert.equal(isReviewSessionConverged(result), true);
});
When("focused範囲外と未知契約と非validのfindingを再評価する", function () {
  const s = initial([finding()]);
  const result = advanceReviewSession(
    s,
    next(
      s,
      [
        finding({ status: "resolved" }),
        finding({ id: "OUT-01", path: "src/outside.ts" }),
        finding({ id: "UNKNOWN-01", contractId: "AC-UNKNOWN" }),
        finding({ id: "FALSE-01", status: "false-positive" }),
        finding({ id: "DUP-01", status: "duplicate" }),
        finding({ id: "ADJ-01", path: "src/adjacent.ts", severity: "Low" }),
      ],
      {
        focus: {
          previousBlocking: ["F-01"],
          fixedDiff: ["src/example.ts"],
          adjacentScope: [
            { path: "src/adjacent.ts", graphEvidence: "d".repeat(64) },
          ],
        },
      },
    ),
  );
  this.session = result;
});
Then(
  "focused範囲外と未知契約と非validのfindingはblockerにならない",
  function () {
    assert.deepEqual(effectiveReviewBlocking(this.session), ["ADJ-01"]);
  },
);
When("2件の契約blockerを1つの修正HEADで解決する", function () {
  this.session = initial([
    finding(),
    finding({
      id: "F-02",
      severity: "Low",
      relation: "invariant-violation",
      contractId: "INV-01",
    }),
  ]);
  const resolved = this.session.rounds[0]!.findings.map((f) => ({
    ...f,
    status: "resolved" as const,
  }));
  this.session = advanceReviewSession(
    this.session,
    next(
      this.session,
      resolved.map(({ admission: _a, admissionReason: _r, ...f }) => {
        void _a;
        void _r;
        return f;
      }),
    ),
  );
});
Then("2 roundで実効収束し追加roundは不要になる", function () {
  assert.equal(this.session.rounds.length, 2);
  assert.equal(
    new Set(this.session.rounds.map((r) => r.candidateHeadSha)).size,
    2,
  );
  assert.equal(isReviewSessionConverged(this.session), true);
  assert.deepEqual(parseReviewSessionState(this.session), this.session);
});
Given(
  "旧mainが生成したMediumとLowの契約違反sessionと履歴省略sessionがある",
  function () {
    this.legacy = [readLegacy("medium"), readLegacy("omitted")];
    this.legacy.push(
      ...this.legacy.map((session) => {
        const low = structuredClone(session);
        low.rounds[0]!.findings[0]!.severity = "Low";
        return parseReviewSessionState(reseal(low));
      }),
    );
  },
);
When("旧sessionを現行validatorで再生する", function () {
  this.legacy = this.legacy.map((session) => parseReviewSessionState(session));
});
Then("元のdigestと保存statusを保ち全historyからpendingを復元する", function () {
  for (const original of this.legacy) {
    const parsed = parseReviewSessionState(original);
    assert.equal(stableJson(parsed), stableJson(original));
    assert.equal(parsed.status, "converged");
    assert.deepEqual(pendingReviewFindingIds(parsed), ["F-LEGACY-01"]);
    assert.deepEqual(effectiveReviewBlocking(parsed), ["F-LEGACY-01"]);
    assert.equal(isReviewSessionConverged(parsed), false);
    assert.equal(latestReviewFindingObservations(parsed)[0]!.round.round, 1);
  }
});
Then("pendingのある証跡生成と証跡照合は拒否する", function () {
  for (const session of this.legacy) {
    assert.throws(
      () =>
        createReviewEvidence({
          issue: 1,
          baseSha: anchor.diffBaseSha,
          implementationHeadSha: session.latestCandidateHeadSha,
          diffDigest: "c".repeat(64),
          session,
          impact: { digest: "c".repeat(64), mode: "full" },
          verification: [],
          independenceMode: "context-isolated",
          reviewer: "reviewer",
          implementer: "implementer",
        }),
      /収束/,
    );
    const fake = {
      observed: {
        session: {
          sessionId: session.sessionId,
          latestRoundDigest: session.latestRoundDigest,
          countedRounds: session.rounds.length,
        },
      },
      findings: [],
      unresolvedCriticalHigh: [],
      declared: {},
    } as unknown as ReviewEvidence;
    assert.match(
      validateReviewEvidenceAgainstSession(fake, session).join(";"),
      /収束/,
    );
  }
});
Then("markerとadmissionの改竄と新版から旧版への逆戻りは拒否する", function () {
  for (const legacy of this.legacy) {
    for (const marker of [1, 2, 3, null]) {
      const tampered = {
        ...legacy,
        rounds: legacy.rounds.map((r, i) =>
          i === 0 ? { ...r, admissionPolicyVersion: marker } : r,
        ),
      };
      assert.throws(() => parseReviewSessionState(tampered));
    }
    const reason = structuredClone(legacy);
    reason.rounds[0]!.findings[0]!.admissionReason = "新しい理由";
    assert.throws(() => parseReviewSessionState(reseal(reason)), /admission/);
  }
  const s = initial([finding()]);
  const migrated = advanceReviewSession(
    s,
    next(s, [finding({ status: "resolved" })]),
  );
  const downgraded = structuredClone(migrated);
  delete downgraded.rounds[1]!.admissionPolicyVersion;
  assert.throws(() => parseReviewSessionState(reseal(downgraded)), /逆戻り/);
  const stripped = structuredClone(s);
  delete stripped.rounds[0]!.admissionPolicyVersion;
  assert.throws(() => parseReviewSessionState(stripped), /admission/);
  assert.throws(
    () => parseReviewRoundInput({ ...next(s, []), admissionPolicyVersion: 2 }),
    /admissionPolicyVersion/,
  );
});
When("pendingのあるfollowとrecordLayerとfinding省略を試みる", function () {
  this.legacySnapshot = stableJson(this.legacy);
  for (const s of this.legacy) {
    assert.throws(
      () => advanceReviewSession(s, next(s, [], { followOnly: true })),
      /非消費/,
    );
    assert.throws(
      () => advanceReviewSession(s, next(s, [], { recordLayerOnly: true })),
      /非消費/,
    );
    assert.throws(() => advanceReviewSession(s, next(s, [])), /脱落/);
    assert.throws(
      () =>
        advanceReviewSession(
          s,
          next(s, [], {
            focus: {
              previousBlocking: [],
              fixedDiff: ["src/example.ts"],
              adjacentScope: [],
            },
          }),
        ),
      /focus/,
    );
  }
});
Then("未評価findingと保存済みdigestは変わらない", function () {
  assert.equal(stableJson(this.legacy), this.legacySnapshot);
  for (const session of this.legacy) {
    assert.deepEqual(pendingReviewFindingIds(session), ["F-LEGACY-01"]);
    assert.equal(isReviewSessionConverged(session), false);
  }
});
When("同HEADで全pendingを明示的に解決する", function () {
  this.legacy = this.legacy.map((s) =>
    advanceReviewSession(
      s,
      next(s, [finding({ id: "F-LEGACY-01", status: "resolved" })], {
        candidateHeadSha: s.latestCandidateHeadSha,
        focus: {
          previousBlocking: effectiveReviewBlocking(s),
          fixedDiff: [],
          adjacentScope: [],
        },
      }),
    ),
  );
});
Then("pendingは復活せず通常の収束済み同HEAD禁止へ戻る", function () {
  for (const s of this.legacy) {
    assert.equal(isReviewSessionConverged(parseReviewSessionState(s)), true);
    assert.deepEqual(pendingReviewFindingIds(s), []);
    assert.throws(
      () =>
        advanceReviewSession(
          s,
          next(s, [], { candidateHeadSha: s.latestCandidateHeadSha }),
        ),
      /収束後/,
    );
    const omitted = advanceReviewSession(s, next(s, []));
    assert.deepEqual(
      pendingReviewFindingIds(parseReviewSessionState(omitted)),
      [],
    );
    assert.equal(isReviewSessionConverged(omitted), true);
  }
});
When("旧historyへresolvedと未知契約とscope外の最新観測を再生する", function () {
  const variants: ReviewSessionState[] = [];
  for (const variant of ["resolved", "unknown", "outside"] as const) {
    const s = structuredClone(this.legacy[1]!);
    const old = s.rounds[0]!.findings[0]!;
    let last = { ...old };
    if (variant === "resolved")
      last = {
        ...last,
        status: "resolved",
        admissionReason: "resolvedまたは非有効findingは履歴だけに保持する",
      };
    if (variant === "unknown") last.contractId = "AC-UNKNOWN";
    if (variant === "outside") last.path = "src/outside.ts";
    s.rounds = [
      s.rounds[0]!,
      {
        ...s.rounds[1]!,
        findings: [last],
        recordOnly: [last.id],
        focus:
          variant === "outside"
            ? s.rounds[1]!.focus
            : {
                ...s.rounds[1]!.focus,
                fixedDiff: [last.path],
              },
      },
    ];
    const parsed = parseReviewSessionState(reseal(s));
    variants.push(parsed);
  }
  this.legacy = variants;
});
Then(
  "旧historyのresolvedと未知契約は解除しscope外の継続違反はpendingに残す",
  function () {
    for (const [index, parsed] of this.legacy.entries()) {
      assert.deepEqual(
        pendingReviewFindingIds(parsed),
        index === 2 ? ["F-LEGACY-01"] : [],
      );
      assert.equal(isReviewSessionConverged(parsed), index !== 2);
    }
  },
);

Given(
  "旧policyでMedium契約違反を再掲しHighだけを解決したsessionがある",
  function () {
    const omitted = readLegacy("omitted");
    const medium = omitted.rounds[0]!.findings[0]!;
    const high = {
      ...readLegacy("high").rounds[0]!.findings[0]!,
      id: "F-HIGH",
      path: "src/other.ts",
    };
    const historical = reseal({
      ...omitted,
      rounds: [
        {
          ...omitted.rounds[0]!,
          findings: [medium, high],
          blocking: [high.id],
        },
        {
          ...omitted.rounds[1]!,
          focus: { ...omitted.rounds[1]!.focus, previousBlocking: [high.id] },
          findings: [
            medium,
            {
              ...high,
              status: "resolved",
              admission: "record-only",
              admissionReason:
                "resolvedまたは非有効findingは履歴だけに保持する",
            },
          ],
          recordOnly: [high.id, medium.id].sort(),
        },
      ],
    });
    this.session = parseReviewSessionState(historical);
    this.legacy = [this.session];
    this.legacySnapshot = stableJson(historical);
  },
);
When("旧sessionの履歴を現policyのsessionと比較する", function () {
  let current: ReviewSessionState | null = null;
  for (const record of this.session.rounds) {
    current = advanceReviewSession(
      current,
      parseReviewRoundInput({
        round: record.round,
        previousRoundDigest: current?.latestRoundDigest ?? null,
        anchor: this.session.anchor,
        candidateHeadSha: record.candidateHeadSha,
        focus: {
          ...record.focus,
          previousBlocking: current ? effectiveReviewBlocking(current) : [],
        },
        findings: record.findings.map(
          ({ admission: _a, admissionReason: _r, ...f }) => f,
        ),
      }),
    );
  }
  assert.ok(current);
  assert.deepEqual(current.rounds.at(-1)!.blocking, ["F-LEGACY-01"]);
  assert.deepEqual(
    effectiveReviewBlocking(this.session),
    effectiveReviewBlocking(current),
  );
});
Then(
  "旧digestとstatusを保持して同じ未解決契約違反をblockerにする",
  function () {
    assert.equal(stableJson(this.session), this.legacySnapshot);
    assert.equal(this.session.status, "converged");
    assert.deepEqual(pendingReviewFindingIds(this.session), ["F-LEGACY-01"]);
    assert.equal(isReviewSessionConverged(this.session), false);
    assert.throws(
      () =>
        createReviewEvidence({
          session: this.session,
          issue: 1,
          implementationHeadSha: this.session.latestCandidateHeadSha,
          baseSha: this.session.anchor.diffBaseSha,
          diffDigest: "c".repeat(64),
          impact: { digest: "c".repeat(64), mode: "full" },
          verification: [],
          reviewer: "reviewer",
          implementer: "implementer",
          independenceMode: "context-isolated",
        }),
      /再評価待ち.*F-LEGACY-01/,
    );
  },
);
When(
  "途中の旧roundで非blockingに分類した後にscope外でvalidを再掲する",
  function () {
    const old = this.session;
    const last = old.rounds[1]!;
    const medium = last.findings[0]!;
    const classifications: Partial<typeof medium>[] = [
      ...(["resolved", "false-positive", "duplicate"] as const).map(
        (status) => ({
          status,
          admissionReason: "resolvedまたは非有効findingは履歴だけに保持する",
        }),
      ),
      { relation: "out-of-scope" },
      { relation: "improvement", contractId: null },
      { contractId: "AC-UNKNOWN" },
    ];
    this.legacy = classifications.map((classification) => {
      const again: ReviewRoundRecord = {
        ...last,
        round: 3,
        candidateHeadSha: "f".repeat(40),
        focus: { ...last.focus, previousBlocking: [] },
        findings: [medium],
        recordOnly: [medium.id],
      };
      return parseReviewSessionState(
        reseal({
          ...old,
          rounds: [
            old.rounds[0]!,
            {
              ...last,
              findings: [{ ...medium, ...classification }, last.findings[1]!],
            },
            again,
          ],
          latestCandidateHeadSha: again.candidateHeadSha,
        }),
      );
    });
  },
);
When("契約findingの初観測をfocused範囲外にする", function () {
  const old = this.session;
  const first = old.rounds[0]!;
  this.legacy = [
    parseReviewSessionState(
      reseal({
        ...old,
        rounds: [
          { ...first, findings: [first.findings[1]!], recordOnly: [] },
          old.rounds[1]!,
          {
            ...old.rounds[1]!,
            round: 3,
            candidateHeadSha: "f".repeat(40),
            focus: { ...old.rounds[1]!.focus, previousBlocking: [] },
            findings: [old.rounds[1]!.findings[0]!],
            recordOnly: ["F-LEGACY-01"],
          },
        ],
        latestCandidateHeadSha: "f".repeat(40),
      }),
    ),
  ];
});
Then("解除済みのfindingはpendingへ復活しない", function () {
  for (const session of this.legacy) {
    assert.deepEqual(pendingReviewFindingIds(session), []);
    assert.deepEqual(effectiveReviewBlocking(session), []);
    assert.equal(isReviewSessionConverged(session), true);
  }
});

function resumeOf(world: ConformanceWorld) {
  return deriveWorkflowResume({
    staging: world.staging,
    headSha: { ok: true, value: world.session.latestCandidateHeadSha },
    journal: { ok: true, value: [] },
    amendments: { ok: true, value: undefined },
    verificationRuns: { ok: true, value: [] },
    reviewSession: { ok: true, value: world.session },
    delivery: { ok: true, value: undefined },
  });
}
function store(world: ConformanceWorld) {
  fs.writeFileSync(
    path.join(world.staging, "review-session.json"),
    JSON.stringify(world.session),
  );
  refreshStoredStagingDigest(world.staging);
}
Given(
  /^隔離repoに旧policyの(履歴省略|High active)sessionを保存した$/,
  function (variant: string) {
    this.root = this.initRepo();
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: this.root, encoding: "utf8" }).trim();
    const baseSha = git("rev-parse", "HEAD");
    fs.mkdirSync(path.join(this.root, "src"));
    fs.writeFileSync(
      path.join(this.root, "src/example.ts"),
      "export const example = 1;\n",
    );
    git("add", "src/example.ts");
    git("commit", "-qm", "fixture candidate");
    const first = git("rev-parse", "HEAD");
    fs.writeFileSync(
      path.join(this.root, "src/other.ts"),
      "export const other = 1;\n",
    );
    git("add", "src/other.ts");
    git("commit", "-qm", "fixture next candidate");
    const head = git("rev-parse", "HEAD");
    this.staging = createIssueStaging(this.root, {
      title: "review-policy",
      requestedMode: "quick",
      now: new Date("2026-10-06T00:00:00Z"),
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [
          id,
          { answer: true, evidence: `${id}固定証拠` },
        ]),
      ) as Record<string, ModeAnswer>,
    }).path;
    const legacy = readLegacy(variant === "High active" ? "high" : "omitted");
    const initialHead = variant === "High active" ? head : first;
    this.session = parseReviewSessionState(
      reseal({
        ...legacy,
        anchor: {
          ...legacy.anchor,
          diffBaseSha: baseSha,
          initialHeadSha: initialHead,
          initialDiffDigest: observeReviewDiff(this.root, baseSha, initialHead)
            .digest,
        },
        rounds: legacy.rounds.map((r, i) => ({
          ...r,
          candidateHeadSha: i === 0 ? initialHead : head,
        })),
        latestCandidateHeadSha: head,
      }),
    );
    store(this);
  },
);
When("Step10とexportとreanchorのgateを評価する", function () {
  this.gateErrors = [];
  const capture = (action: () => unknown) => {
    try {
      action();
      this.gateErrors.push(null);
    } catch (error) {
      this.gateErrors.push(error);
    }
  };
  capture(() =>
    assertConvergedReviewSession({
      staging: this.staging,
      expectedDigest: this.session.latestRoundDigest,
      currentHeadSha: this.session.latestCandidateHeadSha,
    }),
  );
  capture(() =>
    exportReviewEvidence({
      root: this.root,
      staging: this.staging,
      issue: 1,
      reviewer: "reviewer",
      implementer: "implementer",
      independenceMode: "context-isolated",
    }),
  );
  capture(() =>
    evaluateEvidenceReanchor({
      root: this.root,
      staging: this.staging,
      layer: "review",
      newHeadSha: this.session.latestCandidateHeadSha,
      newBaseSha: this.session.anchor.diffBaseSha,
      reason: "fixture reanchor",
    }),
  );
});
Then("Step10とexportとreanchorはpendingを名指しして拒否する", function () {
  assert.equal(this.gateErrors.length, 3);
  for (const error of this.gateErrors) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /再評価待ち.*F-LEGACY-01/);
  }
});
Then("handoffは全pendingを持つ次roundのreviewerを指定する", function () {
  const oldMode = process.env.ASC_EXECUTION_CONTEXT_MODE;
  process.env.ASC_EXECUTION_CONTEXT_MODE = "short-lived";
  try {
    const handoff = observeWorkflowHandoff(this.staging, 10, resumeOf(this));
    assert.ok(handoff && "kind" in handoff);
    assert.equal(handoff.role, "reviewer");
    assert.equal(handoff.reviewRound, 3);
    assert.deepEqual(handoff.findingIds, ["F-LEGACY-01"]);
  } finally {
    if (oldMode === undefined) delete process.env.ASC_EXECUTION_CONTEXT_MODE;
    else process.env.ASC_EXECUTION_CONTEXT_MODE = oldMode;
  }
});
Then("resumeは実効activeを表示し保存sessionのstatusを変えない", function () {
  assert.equal(resumeOf(this).review?.status, "active");
  assert.equal(parseReviewSessionState(this.session).status, "converged");
});
When("同HEADのreview round雛形を作る", function () {
  this.draft = buildReviewRoundDraft({
    staging: this.staging,
    headSha: this.session.latestCandidateHeadSha,
  });
});
Then("全pendingを復元してrecordLayerを自動付与しない", function () {
  assert.deepEqual(this.draft.round.focus.previousBlocking, ["F-LEGACY-01"]);
  assert.deepEqual(
    this.draft.round.findings.map((f) => f.id),
    ["F-LEGACY-01"],
  );
  assert.equal(this.draft.round.recordLayerOnly, undefined);
  assert.deepEqual(this.draft.round.focus.fixedDiff, []);
});
Then("全pendingを解決した後の同HEADの雛形は拒否する", function () {
  this.session = advanceReviewSession(this.session, {
    ...this.draft.round,
    findings: this.draft.round.findings.map((f) => ({
      ...f,
      status: "resolved",
    })),
  });
  store(this);
  assert.throws(
    () =>
      buildReviewRoundDraft({
        staging: this.staging,
        headSha: this.session.latestCandidateHeadSha,
      }),
    /実Git差分が空/,
  );
});

When("2件の契約blockerを同roundに固定して1つのcommitで修正する", function () {
  const headBefore = this.session.latestCandidateHeadSha;
  const batchAnchor = {
    ...this.session.anchor,
    initialHeadSha: headBefore,
    initialDiffDigest: observeReviewDiff(
      this.root,
      this.session.anchor.diffBaseSha,
      headBefore,
    ).digest,
  };
  this.session = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: batchAnchor,
      candidateHeadSha: headBefore,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [
        finding({ id: "F-LEGACY-01" }),
        finding({
          id: "F-BATCH-02",
          severity: "Low",
          relation: "invariant-violation",
          contractId: "INV-01",
        }),
      ],
    }),
  );
  store(this);
  fs.writeFileSync(
    path.join(this.root, "src/example.ts"),
    "export const example = 2;\n",
  );
  execFileSync("git", ["add", "src/example.ts"], { cwd: this.root });
  execFileSync("git", ["commit", "-qm", "fixture batch correction"], {
    cwd: this.root,
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  this.draft = buildReviewRoundDraft({ staging: this.staging, headSha: head });
});
Then("次のfocused roundで全blockerを一括resolvedにして収束する", function () {
  assert.deepEqual(this.draft.round.focus.previousBlocking, [
    "F-BATCH-02",
    "F-LEGACY-01",
  ]);
  assert.deepEqual(this.draft.round.focus.fixedDiff, ["src/example.ts"]);
  const result = previewReviewRound({
    staging: this.staging,
    round: {
      ...this.draft.round,
      findings: this.draft.round.findings.map((f) => ({
        ...f,
        status: "resolved",
      })),
    },
  });
  assert.equal(isReviewSessionConverged(result), true);
  assert.equal(result.rounds.length, this.session.rounds.length + 1);
  assert.equal(
    result.latestCandidateHeadSha,
    this.draft.round.candidateHeadSha,
  );
});

// Generated by main 5d44d2b135a855273583a1a91a5ee58837d0c3f2 dist, not by v2 downgrade.
Given("旧mainが生成したHigh契約blockerがある", function () {
  const high = readLegacy("high");
  assert.equal(
    high.latestRoundDigest,
    "1bc15a75887d563c45e8dc7597b3c4b6f3da1a40fe4f5a7285ebcaf668602e84",
  );
  this.legacy = [high];
  const critical = structuredClone(high);
  critical.rounds[0]!.findings[0]!.severity = "Critical";
  this.legacy.push(parseReviewSessionState(reseal(critical)));
});
When(
  "旧blockerを保持してfollowとrecordLayerの非消費roundを進める",
  function () {
    this.legacy = this.legacy.flatMap((session) => {
      const original = stableJson(session);
      const results = (
        [{ followOnly: true }, { recordLayerOnly: true }] as const
      ).map((flags) =>
        parseReviewSessionState(
          advanceReviewSession(session, next(session, [], flags)),
        ),
      );
      assert.equal(stableJson(session), original);
      for (const result of results)
        assert.deepEqual(result.rounds[0], session.rounds[0]);
      return results;
    });
  },
);
Then(
  "旧CriticalとHighはpendingではなくactive blockerのままである",
  function () {
    for (const session of this.legacy) {
      assert.deepEqual(pendingReviewFindingIds(session), []);
      assert.deepEqual(effectiveReviewBlocking(session), ["F-LEGACY-01"]);
      assert.equal(session.status, "active");
      assert.equal(isReviewSessionConverged(session), false);
    }
  },
);
When("保存sessionのStep10 handoffを観測する", function () {
  const oldMode = process.env.ASC_EXECUTION_CONTEXT_MODE;
  process.env.ASC_EXECUTION_CONTEXT_MODE = "short-lived";
  try {
    this.handoff = observeWorkflowHandoff(this.staging, 10, resumeOf(this));
  } finally {
    if (oldMode === undefined) delete process.env.ASC_EXECUTION_CONTEXT_MODE;
    else process.env.ASC_EXECUTION_CONTEXT_MODE = oldMode;
  }
});
Then("旧Highのhandoffは再評価ではなくcorrectionへblockerを渡す", function () {
  assert.ok(this.handoff && "kind" in this.handoff);
  assert.equal(this.handoff.role, "correction");
  assert.equal(this.handoff.reviewRound, 1);
  assert.deepEqual(this.handoff.findingIds, ["F-LEGACY-01"]);
  assert.deepEqual(pendingReviewFindingIds(this.session), []);
});
