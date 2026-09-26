import assert from "node:assert/strict";

import {
  advanceReviewSession,
  parseReviewRoundInput,
  REVIEW_RECOVERY_ROUND,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  comparableReviewEvidence,
  createReviewEvidence,
  parseReviewEvidence,
  renderReviewEvidence,
  reviewEvidenceDigest,
  validateReviewEvidenceAgainstSession,
  type ReviewEvidence,
} from "../../src/domain/review-evidence.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import {
  resealReviewEvidence,
  reviewEvidenceFromSession,
} from "../support/review-evidence-fixture.js";

interface ReviewEvidenceWorld extends WorkflowWorld {
  session: ReviewSessionState;
  evidence: ReviewEvidence;
  reread: ReviewEvidence;
  errors: string[];
  comparisons: Record<string, boolean>;
}

const { Given, When, Then } = stepDefinitions<ReviewEvidenceWorld>();

const BASE = "1".repeat(40);
const INITIAL = "2".repeat(40);
const FIXED = "3".repeat(40);

function anchor() {
  return {
    scopeIds: ["SCOPE-001"],
    acceptanceCriteriaIds: ["AC-001"],
    invariantIds: [],
    diffBaseSha: BASE,
    initialHeadSha: INITIAL,
    initialDiffDigest: "a".repeat(64),
  };
}

function finding(status: "valid" | "resolved", severity = "High") {
  return {
    id: "F-001",
    severity,
    status,
    source: "review",
    relation: "acceptance-violation",
    evidence: `F-001は${status}である`,
    path: "src/a.ts",
    contractId: "AC-001",
    causedByFindingId: null,
  };
}

function roundOne(): ReviewSessionState {
  return advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: anchor(),
      candidateHeadSha: INITIAL,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [
        finding("valid"),
        {
          ...finding("valid", "Low"),
          id: "F-002",
          relation: "improvement",
          contractId: null,
        },
      ],
    }),
  );
}

function converged(): ReviewSessionState {
  const first = roundOne();
  const second = advanceReviewSession(
    first,
    parseReviewRoundInput({
      round: 2,
      previousRoundDigest: first.latestRoundDigest,
      anchor: anchor(),
      candidateHeadSha: FIXED,
      focus: {
        previousBlocking: ["F-001"],
        fixedDiff: ["src/a.ts"],
        adjacentScope: [],
      },
      findings: [finding("resolved")],
    }),
  );
  assert.equal(second.status, "converged");
  return second;
}

function rejectionOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

Given("2 roundで収束したreview sessionがある", function () {
  this.session = converged();
});

Given("未解決blockerを持つreview sessionがある", function () {
  this.session = roundOne();
  assert.equal(this.session.status, "active");
});

When("review証跡を生成して正規直列化から読み戻す", function () {
  this.evidence = reviewEvidenceFromSession(this.session, { issue: 1500 });
  this.reread = parseReviewEvidence(renderReviewEvidence(this.evidence));
});

Then("読み戻した証跡は生成した証跡と一致しsessionの値を持つ", function () {
  assert.deepEqual(this.reread, this.evidence);
  assert.equal(this.reread.issue, 1500);
  assert.equal(this.reread.baseSha, BASE);
  assert.equal(this.reread.implementationHeadSha, FIXED);
  assert.equal(this.reread.session.sessionId, this.session.sessionId);
  assert.equal(
    this.reread.session.latestRoundDigest,
    this.session.latestRoundDigest,
  );
  assert.equal(this.reread.session.countedRounds, 2);
  assert.equal(this.reread.verdict, "approved");
  assert.equal(this.reread.independence.reviewerModifiedCandidate, false);
  assert.deepEqual(this.reread.verification, [
    { command: "npm test", result: "pass" },
  ]);
  assert.equal(this.reread.evidenceDigest, reviewEvidenceDigest(this.reread));
  assert.deepEqual(
    validateReviewEvidenceAgainstSession(this.reread, this.session, {
      independenceMode: "context-isolated",
      requireSessionHead: true,
    }),
    [],
  );
});

Then(
  "findingは各IDの最終roundの状態であり未解決Critical\\/Highは空である",
  function () {
    assert.deepEqual(this.reread.findings, [
      {
        id: "F-001",
        severity: "High",
        status: "resolved",
        relation: "acceptance-violation",
        path: "src/a.ts",
        contractId: "AC-001",
      },
      {
        id: "F-002",
        severity: "Low",
        status: "valid",
        relation: "improvement",
        path: "src/a.ts",
        contractId: null,
      },
    ]);
    assert.deepEqual(this.reread.unresolvedCriticalHigh, []);
  },
);

When("review証跡の構造を1箇所ずつ壊して読む", function () {
  const evidence = reviewEvidenceFromSession(this.session);
  const plain = JSON.parse(renderReviewEvidence(evidence)) as Record<
    string,
    unknown
  >;
  const mutate = (change: (value: Record<string, unknown>) => void): string => {
    const copy = JSON.parse(JSON.stringify(plain)) as Record<string, unknown>;
    change(copy);
    return `${JSON.stringify(copy, null, 2)}\n`;
  };
  this.errors = [
    mutate((value) => (value.extra = true)),
    mutate((value) => (value.issue = "1")),
    mutate((value) => (value.baseSha = "ABC")),
    mutate((value) => (value.implementationHeadSha = "1".repeat(39))),
    mutate(
      (value) => ((value.session as Record<string, unknown>).status = "active"),
    ),
    mutate((value) => (value.unresolvedCriticalHigh = ["F-001"])),
    mutate((value) => (value.verdict = "rejected")),
    mutate((value) => (value.verification = [])),
    mutate(
      (value) =>
        ((value.independence as Record<string, unknown>).implementer =
          "reviewer-context"),
    ),
    mutate(
      (value) =>
        ((
          value.independence as Record<string, unknown>
        ).reviewerModifiedCandidate = true),
    ),
    mutate(
      (value) =>
        ((value.findings as Array<Record<string, unknown>>)[0]!.path = "../x"),
    ),
    '{"schemaVersion":"a","schemaVersion":"b"}',
  ].map((source) => rejectionOf(() => parseReviewEvidence(source)));
});

Then("壊したすべての証跡をfield名つきで拒否する", function () {
  const expected = [
    /未知field.*extra/u,
    /issue/u,
    /baseSha/u,
    /implementationHeadSha/u,
    /session\.status/u,
    /unresolvedCriticalHigh/u,
    /verdict/u,
    /verification/u,
    /reviewerとimplementer/u,
    /reviewerModifiedCandidate/u,
    /findings\[0\]\.path/u,
    /duplicate|重複/iu,
  ];
  assert.equal(this.errors.length, expected.length);
  for (const [index, pattern] of expected.entries())
    assert.match(this.errors[index]!, pattern, `mutation ${index}`);
});

When("review証跡の値を書き換えるか再整形して読む", function () {
  const evidence = reviewEvidenceFromSession(this.session);
  const canonical = renderReviewEvidence(evidence);
  this.errors = [
    rejectionOf(() =>
      parseReviewEvidence(canonical.replace('"npm test"', '"npm run lint"')),
    ),
    rejectionOf(() =>
      parseReviewEvidence(`${JSON.stringify(JSON.parse(canonical))}\n`),
    ),
    rejectionOf(() => parseReviewEvidence(`${canonical}\n`)),
    rejectionOf(() => parseReviewEvidence(canonical)),
  ];
});

Then("digest不一致と再整形をそれぞれ拒否する", function () {
  assert.match(this.errors[0]!, /evidenceDigest/u);
  assert.match(this.errors[1]!, /正規直列化/u);
  assert.match(this.errors[2]!, /正規直列化/u);
  assert.equal(this.errors[3], "");
});

When("不正な入力でreview証跡を生成する", function () {
  const input = {
    issue: 1,
    baseSha: BASE,
    implementationHeadSha: INITIAL,
    independenceMode: "context-isolated" as const,
    reviewer: "reviewer-context",
    implementer: "implementer-context",
    verification: ["npm test"],
  };
  const convergedSession = converged();
  this.errors = [
    rejectionOf(() =>
      createReviewEvidence({ ...input, session: this.session }),
    ),
    rejectionOf(() =>
      createReviewEvidence({
        ...input,
        session: convergedSession,
        implementer: "reviewer-context",
      }),
    ),
    rejectionOf(() =>
      createReviewEvidence({
        ...input,
        session: convergedSession,
        verification: [],
      }),
    ),
  ];
});

Then("未収束と同一identityと検証command欠落をそれぞれ拒否する", function () {
  assert.match(this.errors[0]!, /収束していない.*status=active/u);
  assert.match(this.errors[1]!, /reviewerとimplementer/u);
  assert.match(this.errors[2]!, /verification/u);
});

When("別sessionと別独立性モードで証跡を照合する", function () {
  const evidence = reviewEvidenceFromSession(this.session, {
    implementationHeadSha: INITIAL,
  });
  const other = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: { ...anchor(), scopeIds: ["SCOPE-002"] },
      candidateHeadSha: INITIAL,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  );
  this.errors = validateReviewEvidenceAgainstSession(evidence, other, {
    independenceMode: "actor-independent",
    requireSessionHead: true,
  });
  this.errors.push(
    ...validateReviewEvidenceAgainstSession(evidence, null),
    ...validateReviewEvidenceAgainstSession(evidence, this.session, {
      requireSessionHead: true,
    }),
  );
});

Then(
  "session・finding・独立性モード・candidate HEADの不一致をすべて報告する",
  function () {
    for (const pattern of [
      /sessionIdが保存済みsessionと一致しません/u,
      /latestRoundDigest/u,
      /countedRounds/u,
      /findings/u,
      /独立性モードcontext-isolatedがtrusted policyのactor-independent/u,
      /永続review sessionがありません/u,
      /implementationHeadShaが保存済みsessionのcandidate HEAD/u,
    ])
      assert.ok(
        this.errors.some((error) => pattern.test(error)),
        `${pattern.source}: ${this.errors.join(" / ")}`,
      );
  },
);

When("比較基点と検証記録をそれぞれ変えた証跡を比較する", function () {
  const evidence = reviewEvidenceFromSession(this.session);
  const rebased = parseReviewEvidence(
    resealReviewEvidence(evidence, {
      baseSha: "4".repeat(40),
      implementationHeadSha: "5".repeat(40),
    }),
  );
  const verified = parseReviewEvidence(
    resealReviewEvidence(evidence, {
      verification: [
        { command: "npm test", result: "pass" },
        { command: "npm run lint", result: "pass" },
      ],
    }),
  );
  const reviewer = parseReviewEvidence(
    resealReviewEvidence(evidence, {
      independence: { ...evidence.independence, reviewer: "other-reviewer" },
    }),
  );
  const same = (
    left: ReviewEvidence,
    right: ReviewEvidence,
    kind: "rebase" | "supersession" | "exact",
  ) =>
    comparableReviewEvidence(left, kind) ===
    comparableReviewEvidence(right, kind);
  this.comparisons = {
    rebaseAcceptsHeadChange: same(evidence, rebased, "rebase"),
    rebaseRejectsVerificationChange: !same(evidence, verified, "rebase"),
    supersessionAcceptsVerification: same(evidence, verified, "supersession"),
    supersessionRejectsHeadChange: !same(evidence, rebased, "supersession"),
    exactRejectsVerification: !same(evidence, verified, "exact"),
    noKindAcceptsReviewerChange:
      !same(evidence, reviewer, "rebase") &&
      !same(evidence, reviewer, "supersession") &&
      !same(evidence, reviewer, "exact"),
  };
});

Then(
  "rebaseは比較基点とH_implだけを、前進修正は検証記録だけを許す",
  function () {
    assert.deepEqual(this.comparisons, {
      rebaseAcceptsHeadChange: true,
      rebaseRejectsVerificationChange: true,
      supersessionAcceptsVerification: true,
      supersessionRejectsHeadChange: true,
      exactRejectsVerification: true,
      noKindAcceptsReviewerChange: true,
    });
  },
);

When("countedRoundsが上限を超える証跡を読む", function () {
  const evidence = reviewEvidenceFromSession(this.session);
  const tooMany = {
    ...evidence,
    session: { ...evidence.session, countedRounds: REVIEW_RECOVERY_ROUND + 1 },
  };
  const sealed = { ...tooMany, evidenceDigest: reviewEvidenceDigest(tooMany) };
  this.errors = [
    rejectionOf(() => parseReviewEvidence(renderReviewEvidence(sealed))),
  ];
});

Then("round上限超過として拒否する", function () {
  assert.match(this.errors[0]!, /countedRounds.*上限/u);
});
