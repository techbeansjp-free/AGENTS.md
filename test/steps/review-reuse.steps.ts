import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  advanceReviewSession,
  isLegacyReviewSession,
  parseReviewRoundInput,
  parseReviewSessionState,
  roundOneInspection,
  type ReviewInspection,
  type ReviewSessionAnchor,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  EMPTY_DIFF_DIGEST,
  assignInspectionForRound,
  formatReuseDiagnostic,
  judgeReviewReuse,
  type ReuseObserver,
  type ReuseVerdict,
  type TransitionObservation,
} from "../../src/domain/review-reuse.js";
import type { FollowObservation } from "../../src/domain/review-reuse-follow.js";
import {
  GIT_ENV,
  diffSectionDigests,
  observeReviewDiff,
  observeReviewDiffSections,
} from "../../src/adapters/review-diff.js";
import { isDefaultBranchFollowMerge } from "../../src/adapters/review-session-store.js";
import {
  judgeReviewReuseAtMerge,
  type ReuseObservationCounter,
} from "../../src/adapters/review-reuse.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";
import { reviewAdjacentScope } from "../../src/domain/impact-set.js";
import {
  buildReviewRoundDraft,
  previewReviewRound,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import { WORKFLOW_STEPS } from "../../src/domain/workflow.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import { stableJson } from "../../src/lib/security.js";

/**
 * review再利用判定（Issue #1544）のunit・integration検査。C2はGitを呼ばない純関数なので
 * 観測値を返す偽observerで条件の成立・不成立を両側から検査し、C3・C4・C5・C6は一時Git
 * repositoryで検査する。
 */
interface ReuseWorld extends WorkflowWorld {
  reuseChecked: boolean;
}

const { Given, When, Then } = stepDefinitions<ReuseWorld>();

const oid = (character: string): string => character.repeat(40);
const digest = (character: string): string => character.repeat(64);
const T = oid("a");
const H1 = oid("1");
const H2 = oid("2");
const H3 = oid("3");
const M = oid("b");
const HM = oid("c");
const F = oid("d");
const X = oid("e");
const EVIDENCE = digest("e");
const SECURITY = "src/merge-x.ts";

const ANCHOR: ReviewSessionAnchor = {
  scopeIds: ["SCOPE-1544"],
  acceptanceCriteriaIds: ["AC-01"],
  invariantIds: [],
  diffBaseSha: T,
  initialHeadSha: H1,
  initialDiffDigest: digest("1"),
};

function scope(paths: readonly string[]) {
  return paths.map((path) => ({ path, graphEvidence: EVIDENCE }));
}

function observation(
  character: string,
  input: { changed?: string[]; adjacent?: string[]; unbounded?: boolean } = {},
): TransitionObservation {
  return {
    digest: digest(character),
    changedPaths: input.changed ?? ["src/x.ts"],
    adjacentScope: scope(input.adjacent ?? []),
    unbounded: input.unbounded ?? false,
  };
}

interface RoundSpec {
  candidate: string;
  kind?: "counted" | "follow" | "record";
  inspection?: ReviewInspection;
  adjacent?: string[];
  unbounded?: boolean;
}

/** round 1（H1）に続くroundを記録したsessionをdomainだけで作る。 */
function sessionOf(
  rounds: readonly RoundSpec[] = [],
  anchor = ANCHOR,
): ReviewSessionState {
  let state = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor,
      candidateHeadSha: anchor.initialHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  );
  for (const spec of rounds)
    state = advanceReviewSession(
      state,
      parseReviewRoundInput({
        round: state.rounds.length + 1,
        previousRoundDigest: state.latestRoundDigest,
        anchor,
        candidateHeadSha: spec.candidate,
        focus: {
          previousBlocking: [],
          fixedDiff: ["src/x.ts"],
          adjacentScope: scope(spec.adjacent ?? []),
          ...(spec.unbounded ? { adjacentScopeUnbounded: true } : {}),
        },
        findings: [],
        ...(spec.kind === "follow" ? { followOnly: true } : {}),
        ...(spec.kind === "record" ? { recordLayerOnly: true } : {}),
        ...(spec.inspection ? { inspection: spec.inspection } : {}),
      }),
    );
  return state;
}

/** 呼び出しを記録する偽observer。未登録のtransitionは例外（観測失敗）にする。 */
class FakeObserver implements ReuseObserver {
  readonly calls: string[] = [];
  readonly links = new Map<string, "evidence-suffix" | "tree-equal">();
  readonly parents = new Map<string, string>();
  readonly transitions = new Map<string, TransitionObservation>();
  readonly follows = new Map<string, FollowObservation>();
  readonly wholes = new Map<string, string>();
  readonly changed = new Map<string, string[]>();
  sectionMap = new Map<string, string>();
  readonly failing = new Set<string>();

  private observe(method: string, key: string): void {
    this.calls.push(`${method}:${key}`);
    if (this.failing.has(method) || this.failing.has(`${method}:${key}`))
      throw new Error(`fake observation failure: ${method}`);
  }

  link(previousHeadSha: string, nextSha: string) {
    this.observe("link", `${previousHeadSha}..${nextSha}`);
    return this.links.get(`${previousHeadSha}..${nextSha}`) ?? "break";
  }

  followParent(previousHeadSha: string, mergeSha: string, baseSha: string) {
    this.observe("followParent", `${previousHeadSha}..${mergeSha}@${baseSha}`);
    return this.parents.get(`${previousHeadSha}..${mergeSha}`);
  }

  transition(fromSha: string, toSha: string) {
    this.observe("transition", `${fromSha}..${toSha}`);
    const observed = this.transitions.get(`${fromSha}..${toSha}`);
    if (!observed) throw new Error("未登録のtransitionです");
    return observed;
  }

  follow(baseSha: string, secondParent: string, mergeSha: string) {
    this.observe("follow", `${baseSha}..${secondParent}..${mergeSha}`);
    const observed = this.follows.get(`${secondParent}..${mergeSha}`);
    if (!observed) throw new Error("未登録の追随です");
    return observed;
  }

  wholeDigest(baseSha: string, toSha: string) {
    this.observe("wholeDigest", `${baseSha}..${toSha}`);
    return this.wholes.get(`${baseSha}..${toSha}`) ?? digest("0");
  }

  changedPaths(fromSha: string, toSha: string) {
    this.observe("changedPaths", `${fromSha}..${toSha}`);
    return this.changed.get(`${fromSha}..${toSha}`) ?? [];
  }

  sections(baseSha: string, headSha: string) {
    this.observe("sections", `${baseSha}..${headSha}`);
    return this.sectionMap;
  }
}

function judge(
  session: ReviewSessionState,
  observer: FakeObserver,
  input: { actual?: string; effective?: string } = {},
): ReuseVerdict {
  return judgeReviewReuse({
    session,
    actualAuditBase: input.actual ?? T,
    effectiveHeadSha: input.effective ?? session.latestCandidateHeadSha,
    observer,
  });
}

function kinds(verdict: ReuseVerdict): string[] {
  return verdict.reviewRequired.map(
    ({ kind, paths, fromSha, toSha }) =>
      `${kind}|${paths.join(",")}|${fromSha.slice(0, 2)}..${toSha.slice(0, 2)}`,
  );
}

function assertReusable(verdict: ReuseVerdict): void {
  assert.equal(verdict.verdict, "reusable", JSON.stringify(verdict));
  assert.deepEqual(verdict.reviewRequired, []);
}

/** round 2がH1→H2を検分したsession（是正round）。 */
function fixedSession(extra: Partial<RoundSpec> = {}): ReviewSessionState {
  return sessionOf([
    {
      candidate: H2,
      inspection: { fromSha: H1, diffDigest: digest("2") },
      ...extra,
    },
  ]);
}

function fixedObserver(
  input: Parameters<typeof observation>[1] = {},
): FakeObserver {
  const observer = new FakeObserver();
  observer.transitions.set(`${H1}..${H2}`, observation("2", input));
  return observer;
}

/** SCN-UNIT-REVREUSE-002 */
function chainAssembly(): void {
  const session = sessionOf([
    { candidate: H2, inspection: { fromSha: H1, diffDigest: digest("2") } },
    { candidate: H3, kind: "record" },
  ]);
  assert.equal(session.latestCandidateHeadSha, H2);
  const observer = fixedObserver();
  assertReusable(judge(session, observer));
  assert.ok(
    !observer.calls.some((call) => call.includes(H3)),
    observer.calls.join(),
  );
  assert.ok(!observer.calls.includes(`transition:${T}..${H1}`));
}

/** SCN-UNIT-REVREUSE-003 */
function linkClassification(): void {
  const fromEvidence = sessionOf([
    { candidate: H2, inspection: { fromSha: F, diffDigest: digest("2") } },
  ]);
  for (const kind of ["evidence-suffix", "tree-equal"] as const) {
    const observer = new FakeObserver();
    observer.transitions.set(`${F}..${H2}`, observation("2"));
    observer.links.set(`${H1}..${F}`, kind);
    assertReusable(judge(fromEvidence, observer));
  }
  const broken = new FakeObserver();
  broken.transitions.set(`${F}..${H2}`, observation("2"));
  assert.deepEqual(kinds(judge(fromEvidence, broken)), ["断絶||11..dd"]);
  const same = fixedObserver();
  assertReusable(judge(fixedSession(), same));
  assert.ok(!same.calls.some((call) => call.startsWith("link:")));
  const followed = sessionOf([{ candidate: HM, kind: "follow" }]);
  const follow = new FakeObserver();
  follow.parents.set(`${H1}..${HM}`, M);
  follow.follows.set(`${M}..${HM}`, {
    mainChanged: ["docs/main.md"],
    impactPaths: ["src/x.ts"],
    unbounded: false,
  });
  const verdict = judge(followed, follow, { actual: M });
  assertReusable(verdict);
  assert.equal(verdict.derivedBaseSha, M);
  assert.ok(follow.calls.includes(`follow:${T}..${M}..${HM}`));
  assert.deepEqual(kinds(judge(followed, new FakeObserver())), [
    "断絶||11..cc",
  ]);
}

/** SCN-UNIT-REVREUSE-004 */
function derivedBase(): void {
  const followed = sessionOf([{ candidate: HM, kind: "follow" }]);
  const follow = new FakeObserver();
  follow.parents.set(`${H1}..${HM}`, M);
  follow.follows.set(`${M}..${HM}`, {
    mainChanged: [],
    impactPaths: [],
    unbounded: false,
  });
  follow.changed.set(`${M}..${T}`, ["docs/main.md"]);
  const mismatch = judge(followed, follow, { actual: T });
  assert.equal(mismatch.derivedBaseSha, M);
  assert.deepEqual(kinds(mismatch), ["基点不一致|docs/main.md|11..cc"]);
  assert.deepEqual(
    kinds(judge(fixedSession(), fixedObserver(), { effective: H3 })),
    ["断絶||22..33"],
  );
  // counted transitionが追随mergeならC4が真のときだけ基点を前進させ、追随Xを求めない（RC-01・RC-02）。
  const countedMerge = sessionOf([
    { candidate: HM, inspection: { fromSha: H1, diffDigest: digest("c") } },
  ]);
  const clean = new FakeObserver();
  clean.parents.set(`${H1}..${HM}`, M);
  clean.transitions.set(`${H1}..${HM}`, observation("c"));
  assertReusable(judge(countedMerge, clean, { actual: M }));
  assert.ok(!clean.calls.some((call) => call.startsWith("follow:")));
  const resolved = new FakeObserver();
  resolved.transitions.set(`${H1}..${HM}`, observation("c"));
  resolved.changed.set(`${T}..${M}`, ["f.txt"]);
  assert.deepEqual(kinds(judge(countedMerge, resolved, { actual: M })), [
    "基点不一致|f.txt|11..cc",
  ]);
}

/** SCN-UNIT-REVREUSE-005 */
function wholeInspection(): void {
  const whole = (baseSha: string) => ({
    fromSha: H1,
    diffDigest: digest("2"),
    cumulative: { baseSha, scope: "all" as const, diffDigest: digest("9") },
  });
  const later = {
    candidate: H3,
    inspection: { fromSha: H2, diffDigest: digest("3") },
  };
  const covered = sessionOf([{ candidate: H2, inspection: whole(T) }, later]);
  const observer = new FakeObserver();
  observer.wholes.set(`${T}..${H2}`, digest("9"));
  observer.transitions.set(`${H2}..${H3}`, observation("3"));
  assertReusable(judge(covered, observer));
  assert.ok(!observer.calls.includes(`transition:${H1}..${H2}`));
  // 全体検分が2つあれば最も後ろを起点にし、それより前のdigestを再計算しない。
  const twice = sessionOf([
    { candidate: H2, inspection: whole(T) },
    {
      candidate: H3,
      inspection: {
        fromSha: H2,
        diffDigest: digest("3"),
        cumulative: { baseSha: T, scope: "all", diffDigest: digest("8") },
      },
    },
  ]);
  const last = new FakeObserver();
  last.wholes.set(`${T}..${H3}`, digest("8"));
  assertReusable(judge(twice, last));
  assert.deepEqual(last.calls, [
    `followParent:${H1}..${H2}@${T}`,
    `followParent:${H2}..${H3}@${T}`,
    `wholeDigest:${T}..${H3}`,
  ]);
  const wrongBase = sessionOf([{ candidate: H2, inspection: whole(X) }]);
  const rebased = fixedObserver();
  // 記録digestが別基点からの差分として正しくても、導出基点と異なれば全体検分にしない。
  rebased.wholes.set(`${X}..${H2}`, digest("9"));
  assert.deepEqual(kinds(judge(wrongBase, rebased)), ["digest不一致||ee..22"]);
  assert.ok(rebased.calls.includes(`transition:${H1}..${H2}`));
  const tampered = sessionOf([{ candidate: H2, inspection: whole(T) }]);
  const recomputed = fixedObserver();
  recomputed.wholes.set(`${T}..${H2}`, digest("7"));
  const verdict = judge(tampered, recomputed);
  assert.deepEqual(kinds(verdict), ["digest不一致||aa..22"]);
  assert.equal(verdict.reviewRequired[0]?.recomputedDigest, digest("7"));
}

/** SCN-UNIT-REVREUSE-006 */
function transitionVerification(): void {
  const changedDigest = fixedObserver();
  changedDigest.transitions.set(`${H1}..${H2}`, observation("9"));
  const verdict = judge(fixedSession(), changedDigest);
  assert.deepEqual(kinds(verdict), ["digest不一致||11..22"]);
  assert.equal(verdict.reviewRequired[0]?.recomputedDigest, digest("9"));
  assert.deepEqual(
    kinds(judge(fixedSession(), fixedObserver({ adjacent: ["src/c.ts"] }))),
    ["依存先未検分|src/c.ts|11..22"],
  );
  assert.deepEqual(
    kinds(
      judge(
        fixedSession({ adjacent: ["src/b.ts"] }),
        fixedObserver({ adjacent: ["src/b.ts", "src/c.ts"] }),
      ),
    ),
    ["依存先未検分|src/c.ts|11..22"],
  );
  assert.deepEqual(
    kinds(
      judge(
        fixedSession({ adjacent: ["src/b.ts", "src/c.ts"] }),
        fixedObserver({ adjacent: ["src/c.ts"] }),
      ),
    ),
    ["依存先未検分|src/c.ts|11..22"],
  );
  assert.deepEqual(
    kinds(judge(fixedSession(), fixedObserver({ unbounded: true }))),
    ["依存先未検分||11..22"],
  );
  assert.deepEqual(
    kinds(judge(fixedSession({ unbounded: true }), fixedObserver())),
    ["依存先未検分||11..22"],
  );
  assertReusable(
    judge(
      fixedSession({ adjacent: ["src/c.ts"] }),
      fixedObserver({ adjacent: ["src/c.ts"] }),
    ),
  );
}

function followObserver(observed: FollowObservation): FakeObserver {
  const observer = new FakeObserver();
  observer.parents.set(`${H1}..${HM}`, M);
  observer.follows.set(`${M}..${HM}`, observed);
  return observer;
}

/** SCN-UNIT-REVREUSE-007 */
function followCrossingCheck(): void {
  const followed = sessionOf([{ candidate: HM, kind: "follow" }]);
  const crossing = judge(
    followed,
    followObserver({
      mainChanged: ["docs/z.md", "src/a.ts"],
      impactPaths: ["src/a.ts", "src/b.ts"],
      unbounded: false,
    }),
    { actual: M },
  );
  assert.deepEqual(kinds(crossing), ["追随交差|src/a.ts|11..cc"]);
  assert.deepEqual(crossing.reviewRequired[0]?.mainPaths, [
    "docs/z.md",
    "src/a.ts",
  ]);
  const unbounded = judge(
    followed,
    followObserver({ mainChanged: [], impactPaths: [], unbounded: true }),
    { actual: M },
  );
  assert.equal(unbounded.verdict, "undecidable");
  assert.deepEqual(kinds(unbounded), ["判定不能||11..cc"]);
  assertReusable(
    judge(
      followed,
      followObserver({
        mainChanged: ["docs/z.md"],
        impactPaths: ["src/a.ts"],
        unbounded: false,
      }),
      { actual: M },
    ),
  );
}

function pathsInspection(
  fromSha: string,
  character: string,
  baseSha: string,
  entries: Array<[string, string]>,
): ReviewInspection {
  return {
    fromSha,
    diffDigest: digest(character),
    cumulative: {
      baseSha,
      scope: "paths",
      paths: entries.map(([path, value]) => ({ path, diffDigest: value })),
    },
  };
}

/** SCN-UNIT-REVREUSE-008 */
function cumulativeCoverage(): void {
  const securityObserver = (sections: Array<[string, string]>) => {
    const observer = fixedObserver({ changed: [SECURITY] });
    observer.transitions.set(
      `${H2}..${H3}`,
      observation("3", { changed: [SECURITY] }),
    );
    observer.sectionMap = new Map(sections);
    return observer;
  };
  assert.deepEqual(kinds(judge(fixedSession(), securityObserver([]))), [
    `累積差分未検分|${SECURITY}|11..22`,
  ]);
  const covered = (inspection: ReviewInspection) =>
    sessionOf([{ candidate: H2, inspection }]);
  assertReusable(
    judge(
      covered(pathsInspection(H1, "2", T, [[SECURITY, digest("5")]])),
      securityObserver([[SECURITY, digest("5")]]),
    ),
  );
  for (const inspection of [
    pathsInspection(H1, "2", T, [[SECURITY, digest("6")]]),
    pathsInspection(H1, "2", X, [[SECURITY, digest("5")]]),
    pathsInspection(H1, "2", T, [["src/other-x.ts", digest("5")]]),
  ])
    assert.deepEqual(
      kinds(
        judge(covered(inspection), securityObserver([[SECURITY, digest("5")]])),
      ),
      [`累積差分未検分|${SECURITY}|11..22`],
    );
  // 手順4を満たさないscope=allは累積検分要求pathの被覆に数えない（RC-03）。
  assert.deepEqual(
    kinds(
      judge(
        covered({
          fromSha: H1,
          diffDigest: digest("2"),
          cumulative: { baseSha: X, scope: "all", diffDigest: digest("9") },
        }),
        securityObserver([[SECURITY, digest("5")]]),
      ),
    ),
    ["digest不一致||ee..22", `累積差分未検分|${SECURITY}|11..22`],
  );
  // sectionが無いpathは空差分のsha256と照合する（照合を省略しない）。
  assert.deepEqual(
    kinds(
      judge(
        covered(pathsInspection(H1, "2", T, [[SECURITY, digest("5")]])),
        securityObserver([]),
      ),
    ),
    [`累積差分未検分|${SECURITY}|11..22`],
  );
  assertReusable(
    judge(
      covered(pathsInspection(H1, "2", T, [[SECURITY, EMPTY_DIFF_DIGEST]])),
      securityObserver([]),
    ),
  );
  // 後続transitionが同じpathを変えたら最後のtag以降の累積検分だけが被覆する。
  const retagged = (third?: ReviewInspection) =>
    sessionOf([
      {
        candidate: H2,
        inspection: pathsInspection(H1, "2", T, [[SECURITY, digest("5")]]),
      },
      {
        candidate: H3,
        inspection: third ?? { fromSha: H2, diffDigest: digest("3") },
      },
    ]);
  assert.deepEqual(
    kinds(
      judge(retagged(), securityObserver([[SECURITY, digest("5")]]), {
        effective: H3,
      }),
    ),
    [`累積差分未検分|${SECURITY}|22..33`],
  );
  assertReusable(
    judge(
      retagged(pathsInspection(H2, "3", T, [[SECURITY, digest("5")]])),
      securityObserver([[SECURITY, digest("5")]]),
      { effective: H3 },
    ),
  );
  // 追随で交差したpathは追随より後ろの同head累積検分roundが被覆する。
  const followed = (inspection?: ReviewInspection) =>
    sessionOf([
      { candidate: HM, kind: "follow" },
      ...(inspection ? [{ candidate: HM, inspection }] : []),
    ]);
  const crossing = () => {
    const observer = followObserver({
      mainChanged: ["src/a.ts"],
      impactPaths: ["src/a.ts"],
      unbounded: false,
    });
    observer.transitions.set(`${HM}..${HM}`, observation("0", { changed: [] }));
    return observer;
  };
  assertReusable(
    judge(
      followed(pathsInspection(HM, "0", M, [["src/a.ts", EMPTY_DIFF_DIGEST]])),
      crossing(),
      { actual: M },
    ),
  );
  // 追随で交差したpathを後続transitionが変えたら、そのtransition以降の累積検分が要る。
  const changedAfter = sessionOf([
    { candidate: HM, kind: "follow" },
    {
      candidate: HM,
      inspection: pathsInspection(HM, "0", M, [["src/a.ts", digest("5")]]),
    },
    { candidate: H3, inspection: { fromSha: HM, diffDigest: digest("3") } },
  ]);
  const later = crossing();
  later.transitions.set(
    `${HM}..${H3}`,
    observation("3", { changed: ["src/a.ts"] }),
  );
  later.sectionMap = new Map([["src/a.ts", digest("5")]]);
  assert.deepEqual(
    kinds(judge(changedAfter, later, { actual: M, effective: H3 })),
    ["追随交差|src/a.ts|cc..33"],
  );
  assert.deepEqual(
    kinds(
      judge(
        followed(
          pathsInspection(HM, "0", T, [["src/a.ts", EMPTY_DIFF_DIGEST]]),
        ),
        crossing(),
        { actual: M },
      ),
    ),
    ["追随交差|src/a.ts|11..cc"],
  );
}

/** SCN-UNIT-REVREUSE-009 */
function verdictAndDiagnostic(): void {
  const failed = fixedObserver();
  failed.failing.add("transition");
  const undecidable = judge(fixedSession(), failed);
  assert.equal(undecidable.verdict, "undecidable");
  assert.deepEqual(kinds(undecidable), ["判定不能||11..22"]);
  const mixed = judge(fixedSession(), failed, { effective: H3 });
  assert.equal(mixed.verdict, "undecidable");
  const required = judge(fixedSession(), fixedObserver(), { effective: H3 });
  assert.equal(required.verdict, "review-required");
  const many = Array.from({ length: 25 }, (_, index) => `src/p${index}.ts`);
  const text = formatReuseDiagnostic(
    {
      verdict: "review-required",
      derivedBaseSha: T,
      reviewRequired: [
        {
          kind: "基点不一致",
          paths: many,
          fromSha: H1,
          toSha: H2,
          recomputedDigest: null,
          nextAction: "次の操作の案内",
        },
        {
          kind: "追随交差",
          paths: ["src/a.ts"],
          mainPaths: ["src/a.ts", "docs/z.md"],
          fromSha: H1,
          toSha: HM,
          recomputedDigest: digest("4"),
          nextAction: "累積検分",
        },
      ],
    },
    { sessionId: digest("f"), actualAuditBase: M, effectiveHeadSha: H2 },
  );
  assert.deepEqual(text.split("\n"), [
    `実際のmerge-base(${M})がreview sessionの比較基点(${T})と一致しません。`,
    `review再利用条件が成立しません: verdict=review-required 該当=2件 session=${"f".repeat(12)} 導出基点=${T} actualAuditBase=${M} 実効H_impl=${H2}`,
    `[基点不一致] path=${many.slice(0, 20).join(",")} ほか5件 transition=${H1}..${H2} 再計算digest=なし 次の操作: 次の操作の案内`,
    `[追随交差] path=src/a.ts 既定branch側path=src/a.ts,docs/z.md transition=${H1}..${HM} 再計算digest=${digest("4")} 次の操作: 累積検分`,
  ]);
  assert.doesNotMatch(text, /counted round数|初回H_impl/u);
}

/** SCN-UNIT-REVREUSE-010 */
function assignment(): void {
  const previous = sessionOf();
  const focus = {
    previousBlocking: [],
    fixedDiff: ["src/x.ts"],
    adjacentScope: [],
  };
  const assign = (
    observer: FakeObserver,
    input: {
      to?: string;
      allowFollowOnly?: boolean;
      session?: ReviewSessionState;
    } = {},
  ) =>
    assignInspectionForRound({
      session: input.session ?? previous,
      fromSha: H1,
      toSha: input.to ?? HM,
      focus,
      observer,
      allowFollowOnly: input.allowFollowOnly ?? true,
    });
  const disjoint = followObserver({
    mainChanged: ["docs/z.md"],
    impactPaths: ["src/x.ts"],
    unbounded: false,
  });
  disjoint.transitions.set(`${H1}..${HM}`, observation("c"));
  assert.deepEqual(assign(disjoint), { followOnly: true, derivedBaseSha: M });
  const notAllowed = assign(disjoint, { allowFollowOnly: false });
  assert.ok("inspection" in notAllowed);
  assert.deepEqual(notAllowed.inspection, {
    fromSha: H1,
    diffDigest: digest("c"),
  });
  const intersecting = followObserver({
    mainChanged: ["src/a.ts"],
    impactPaths: ["src/a.ts"],
    unbounded: false,
  });
  intersecting.transitions.set(`${H1}..${HM}`, observation("c"));
  const counted = assign(intersecting);
  assert.ok("inspection" in counted);
  assert.deepEqual(counted.inspection, {
    fromSha: H1,
    diffDigest: digest("c"),
  });
  const unbounded = new FakeObserver();
  unbounded.transitions.set(
    `${H1}..${H2}`,
    observation("2", { unbounded: true }),
  );
  unbounded.wholes.set(`${T}..${H2}`, digest("9"));
  const whole = assign(unbounded, { to: H2 });
  assert.ok("inspection" in whole);
  assert.deepEqual(whole.inspection.cumulative, {
    baseSha: T,
    scope: "all",
    diffDigest: digest("9"),
  });
  const security = new FakeObserver();
  security.transitions.set(
    `${H1}..${H2}`,
    observation("2", { changed: [SECURITY, "src/x.ts"] }),
  );
  security.sectionMap = new Map([[SECURITY, digest("5")]]);
  const paths = assign(security, { to: H2 });
  assert.ok("inspection" in paths);
  assert.deepEqual(paths.inspection.cumulative, {
    baseSha: T,
    scope: "paths",
    paths: [{ path: SECURITY, diffDigest: digest("5") }],
  });
  const plain = fixedObserver();
  const none = assign(plain, { to: H2 });
  assert.ok("inspection" in none);
  assert.equal(none.inspection.cumulative, undefined);
  // 鎖の断絶が残っていれば全体検分を割り当てる。
  const broken = sessionOf([
    { candidate: H2, inspection: { fromSha: F, diffDigest: digest("2") } },
  ]);
  const breakObserver = new FakeObserver();
  breakObserver.transitions.set(`${F}..${H2}`, observation("2"));
  breakObserver.transitions.set(`${H2}..${H3}`, observation("3"));
  breakObserver.wholes.set(`${T}..${H3}`, digest("8"));
  const repaired = assignInspectionForRound({
    session: broken,
    fromSha: H2,
    toSha: H3,
    focus,
    observer: breakObserver,
    allowFollowOnly: true,
  });
  assert.ok("inspection" in repaired);
  assert.equal(repaired.inspection.cumulative?.scope, "all");
  // 未被覆の追随交差は同headの累積検分pathとして割り当てる。
  const followed = sessionOf([{ candidate: HM, kind: "follow" }]);
  const crossing = followObserver({
    mainChanged: ["src/a.ts"],
    impactPaths: ["src/a.ts"],
    unbounded: false,
  });
  crossing.transitions.set(`${HM}..${HM}`, {
    digest: EMPTY_DIFF_DIGEST,
    changedPaths: [],
    adjacentScope: [],
    unbounded: false,
  });
  const sameHead = assignInspectionForRound({
    session: followed,
    fromSha: HM,
    toSha: HM,
    focus,
    observer: crossing,
    allowFollowOnly: true,
  });
  assert.ok("inspection" in sameHead);
  assert.deepEqual(sameHead.inspection, {
    fromSha: HM,
    diffDigest: EMPTY_DIFF_DIGEST,
    cumulative: {
      baseSha: M,
      scope: "paths",
      paths: [{ path: "src/a.ts", diffDigest: EMPTY_DIFF_DIGEST }],
    },
  });
}

/** 固定Git環境の`git`（利用者のglobal configに左右されない）。 */
function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
  }).trim();
}

function commitFiles(
  root: string,
  files: Record<string, string | null>,
  message: string,
): string {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    if (content === null) fs.rmSync(file);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  git(root, ["add", "-A", "--", ...Object.keys(files)]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** SCN-UNIT-REVREUSE-001 */
function sectionDigests(world: ReuseWorld): void {
  const root = world.initRepo();
  fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 255, 0]));
  git(root, ["add", "bin.dat"]);
  const base = commitFiles(
    root,
    {
      "a.txt": "one\ntwo\nthree\n",
      "mode.sh": "#!/bin/sh\n",
      "gone.txt": "deleted later\n",
    },
    "base",
  );
  const start = base;
  fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([9, 0, 8, 7]));
  fs.chmodSync(path.join(root, "mode.sh"), 0o755);
  git(root, ["add", "bin.dat", "mode.sh"]);
  const head = commitFiles(
    root,
    {
      "a.txt": "one\n2\nthree\n",
      "gone.txt": null,
      "new.txt": "added\n",
      'q"uote\tname.txt': "quoted path\n",
    },
    "head",
  );
  const sections = observeReviewDiffSections(root, start, head);
  const names = execFileSync(
    "git",
    ["diff", "--name-only", "-z", "--no-renames", start, head, "--"],
    { cwd: root, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  assert.equal(names.length, 6);
  assert.deepEqual([...sections.keys()], names);
  for (const name of names)
    assert.equal(
      sections.get(name),
      sha256(
        execFileSync(
          "git",
          [
            "diff",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            start,
            head,
            "--",
            name,
          ],
          { cwd: root, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" },
        ),
      ),
      name,
    );
  assert.throws(
    () => diffSectionDigests("diff --git a/x b/x\n+1\n", ["x", "y"]),
    /review diffのsection数\(1\)とpath数\(2\)が一致しません/u,
  );
  assert.throws(
    () => diffSectionDigests("diff --git a/x b/x\ndiff --git a/y b/y\n", ["x"]),
    /section数\(2\)とpath数\(1\)/u,
  );
}

/** 一時repositoryで既定branchを`from`から前進させremote-tracking refを向ける。 */
function advanceDefault(
  root: string,
  from: string,
  files: Record<string, string>,
): string {
  const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
  git(root, ["checkout", "-q", "-b", "asc-1544-main", from]);
  const advanced = commitFiles(root, files, "default branch advance");
  git(root, ["update-ref", "refs/remotes/origin/main", advanced]);
  git(root, ["checkout", "-q", branch]);
  git(root, ["branch", "-D", "asc-1544-main"]);
  return advanced;
}

function mergeDefault(root: string, advanced: string): string {
  git(root, ["merge", "-q", "--no-ff", advanced, "-m", "merge default"]);
  return git(root, ["rev-parse", "HEAD"]);
}

/** SCN-UNIT-REVIEWCONV-015 */
function followMergeExtension(world: ReuseWorld): void {
  const root = world.initRepo();
  const base = git(root, ["rev-parse", "HEAD"]);
  const reviewed = commitFiles(root, { "p.txt": "reviewed\n" }, "reviewed");
  commitFiles(
    root,
    { "docs/reviews/1544_review.json": "{}\n" },
    "review evidence",
  );
  const advanced = advanceDefault(root, base, { "m.txt": "main\n" });
  const followed = mergeDefault(root, advanced);
  assert.equal(isDefaultBranchFollowMerge(root, reviewed, followed), true);
  assert.equal(
    isDefaultBranchFollowMerge(root, reviewed, followed, advanced),
    true,
  );
  assert.equal(
    isDefaultBranchFollowMerge(root, reviewed, followed, base),
    false,
  );
  commitFiles(root, { "p.txt": "implementation change\n" }, "implementation");
  const advancedAgain = advanceDefault(root, advanced, { "n.txt": "main\n" });
  const throughImplementation = mergeDefault(root, advancedAgain);
  assert.equal(
    isDefaultBranchFollowMerge(root, followed, throughImplementation),
    false,
  );
  assert.equal(
    isDefaultBranchFollowMerge(root, reviewed, throughImplementation),
    false,
  );
}

function realInspection(
  root: string,
  fromSha: string,
  toSha: string,
): { inspection: ReviewInspection; adjacent: string[]; unbounded: boolean } {
  const impact = computeImpactSet({ root, baseSha: fromSha, headSha: toSha });
  return {
    inspection: { fromSha, diffDigest: impact.changeDigest },
    adjacent: reviewAdjacentScope(impact).map(({ path: item }) => item),
    unbounded: impact.mode === "full",
  };
}

/** SCN-UNIT-REVREUSE-011 */
function adapterObservation(world: ReuseWorld): void {
  const root = world.initRepo();
  const base = git(root, ["rev-parse", "HEAD"]);
  const first = commitFiles(root, { "p.txt": "first\n" }, "first");
  const firstMain = advanceDefault(root, base, { "m1.txt": "main 1\n" });
  const firstFollow = mergeDefault(root, firstMain);
  const fixed = commitFiles(root, { "q.txt": "fixed\n" }, "fix");
  const secondMain = advanceDefault(root, firstMain, { "m2.txt": "main 2\n" });
  const secondFollow = mergeDefault(root, secondMain);
  const anchor: ReviewSessionAnchor = {
    ...ANCHOR,
    diffBaseSha: base,
    initialHeadSha: first,
    initialDiffDigest: observeReviewDiff(root, base, first).digest,
  };
  const counted = (from: string, to: string): RoundSpec => {
    const observed = realInspection(root, from, to);
    return {
      candidate: to,
      inspection: observed.inspection,
      adjacent: observed.unbounded ? [] : observed.adjacent,
      unbounded: observed.unbounded,
    };
  };
  const session = sessionOf(
    [
      { candidate: firstFollow, kind: "follow" },
      counted(firstFollow, fixed),
      counted(fixed, secondFollow),
    ],
    anchor,
  );
  const counter: ReuseObservationCounter = {
    contentDiffs: 0,
    impactDerivations: 0,
  };
  const verdict = judgeReviewReuseAtMerge({
    root,
    session,
    tipSha: secondMain,
    actualAuditBase: secondMain,
    effectiveHeadSha: secondFollow,
    counter,
  });
  assert.equal(verdict.derivedBaseSha, secondMain, JSON.stringify(verdict));
  const rounds = session.rounds.length;
  assert.ok(counter.contentDiffs <= rounds + 1, JSON.stringify(counter));
  assert.ok(counter.impactDerivations <= rounds, JSON.stringify(counter));
  assert.equal(counter.impactDerivations, 3);
  const unobservable = sessionOf(
    [
      {
        candidate: fixed,
        inspection: { fromSha: oid("f"), diffDigest: digest("2") },
      },
    ],
    anchor,
  );
  const failed = judgeReviewReuseAtMerge({
    root,
    session: unobservable,
    tipSha: base,
    actualAuditBase: base,
    effectiveHeadSha: fixed,
  });
  assert.equal(failed.verdict, "undecidable");
  assert.ok(
    failed.reviewRequired.some(({ kind }) => kind === "判定不能"),
    JSON.stringify(failed),
  );
}

/** SCN-UNIT-REVIEWCONV-012 */
function inspectionShape(): void {
  const round = (extra: Record<string, unknown>) => ({
    round: 2,
    previousRoundDigest: digest("3"),
    anchor: ANCHOR,
    candidateHeadSha: H2,
    focus: { previousBlocking: [], fixedDiff: ["src/x.ts"], adjacentScope: [] },
    findings: [],
    ...extra,
  });
  const withPaths = (paths: unknown) =>
    round({
      inspection: {
        fromSha: H1,
        diffDigest: digest("2"),
        cumulative: { baseSha: T, scope: "paths", paths },
      },
    });
  const entry = (item: string) => ({ path: item, diffDigest: digest("5") });
  const sorted = Array.from({ length: 257 }, (_, index) =>
    entry(`src/p${String(index).padStart(3, "0")}.ts`),
  );
  assert.ok(parseReviewRoundInput(withPaths(sorted.slice(0, 256))).inspection);
  for (const [paths, pattern] of [
    [sorted, /1〜256件のpaths/u],
    [[], /1〜256件のpaths/u],
    [[entry("../x.ts")], /repository相対path/u],
    [[entry("/abs.ts")], /repository相対path/u],
    [[entry("a\0b.ts")], /paths\[0\]が不正です/u],
    [[entry("src/b.ts"), entry("src/a.ts")], /byte昇順・重複なし/u],
    [[entry("src/a.ts"), entry("src/a.ts")], /byte昇順・重複なし/u],
  ] as const)
    assert.throws(() => parseReviewRoundInput(withPaths(paths)), pattern);
  for (const [inspection, pattern] of [
    [{ fromSha: "short", diffDigest: digest("2") }, /inspection.fromSha/u],
    [{ fromSha: H1, diffDigest: "x" }, /inspection.diffDigest/u],
    [{ fromSha: H1, diffDigest: digest("2"), extra: 1 }, /未知/u],
    [
      {
        fromSha: H1,
        diffDigest: digest("2"),
        cumulative: {
          baseSha: T,
          scope: "all",
          diffDigest: digest("9"),
          paths: [entry("a")],
        },
      },
      /scope=allのときdiffDigestだけ/u,
    ],
    [
      {
        fromSha: H1,
        diffDigest: digest("2"),
        cumulative: { baseSha: T, scope: "paths", diffDigest: digest("9") },
      },
      /scope=pathsのとき/u,
    ],
  ] as const)
    assert.throws(() => parseReviewRoundInput(round({ inspection })), pattern);
  const inspection = { fromSha: H1, diffDigest: digest("2") };
  for (const flag of ["followOnly", "recordLayerOnly"])
    assert.throws(
      () => parseReviewRoundInput(round({ inspection, [flag]: true })),
      /inspectionを持てません/u,
    );
  const first = (extra: Record<string, unknown>) =>
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: ANCHOR,
      candidateHeadSha: H1,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
      ...extra,
    });
  assert.deepEqual(
    advanceReviewSession(null, first({})).rounds[0]?.inspection,
    roundOneInspection(ANCHOR),
  );
  for (const mismatch of [
    { fromSha: H1, diffDigest: digest("1") },
    { fromSha: T, diffDigest: digest("2") },
    {
      ...roundOneInspection(ANCHOR),
      cumulative: { baseSha: T, scope: "all", diffDigest: digest("1") },
    },
  ])
    assert.throws(
      () => advanceReviewSession(null, first({ inspection: mismatch })),
      /round 1のinspectionはanchor/u,
    );
  const bound = fixedSession();
  const other = sessionOf([
    { candidate: H2, inspection: { fromSha: H1, diffDigest: digest("9") } },
  ]);
  assert.notEqual(bound.latestRoundDigest, other.latestRoundDigest);
  const stored = JSON.parse(stableJson(bound)) as {
    rounds: Array<{ inspection: { diffDigest: string } }>;
  };
  assert.deepEqual(parseReviewSessionState(stored), bound);
  stored.rounds[1]!.inspection.diffDigest = digest("9");
  assert.throws(
    () => parseReviewSessionState(stored),
    /admissionまたはdigestが不正です/u,
  );
}

/** SCN-UNIT-REVIEWCONV-013 */
function legacyDetection(): void {
  assert.equal(isLegacyReviewSession(fixedSession()), false);
  assert.equal(
    isLegacyReviewSession(sessionOf([{ candidate: HM, kind: "follow" }])),
    false,
  );
  assert.equal(isLegacyReviewSession(sessionOf([{ candidate: H2 }])), true);
  assert.equal(
    isLegacyReviewSession(
      sessionOf([
        { candidate: H2 },
        { candidate: H3, inspection: { fromSha: H2, diffDigest: digest("3") } },
      ]),
    ),
    true,
  );
}

/** SCN-UNIT-REVIEWCONV-014 */
function sameHeadAfterConvergence(): void {
  const converged = fixedSession();
  const again = (inspection: ReviewInspection) =>
    advanceReviewSession(
      converged,
      parseReviewRoundInput({
        round: 3,
        previousRoundDigest: converged.latestRoundDigest,
        anchor: ANCHOR,
        candidateHeadSha: H2,
        focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
        findings: [],
        inspection,
      }),
    );
  assert.throws(
    () => again({ fromSha: H2, diffDigest: EMPTY_DIFF_DIGEST }),
    /収束後の追加reviewは前roundと異なるcandidate HEAD/u,
  );
  assert.equal(
    again(pathsInspection(H2, "0", T, [["src/a.ts", EMPTY_DIFF_DIGEST]])).rounds
      .length,
    3,
  );
  assert.equal(
    again({
      fromSha: H2,
      diffDigest: EMPTY_DIFF_DIGEST,
      cumulative: { baseSha: T, scope: "all", diffDigest: digest("9") },
    }).status,
    "converged",
  );
}

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

/** Step 9をrecordしたstagingとround 1を持つ一時repository（SCN-INT-REVREUSE-001）。 */
function stagedRepository(
  world: ReuseWorld,
  files: Record<string, string>,
): { root: string; staging: string; base: string; first: string } {
  const root = fs.realpathSync(world.initRepo());
  const base = git(root, ["rev-parse", "HEAD"]);
  const first = commitFiles(root, files, "implementation");
  const staging = createIssueStaging(root, {
    title: "review-reuse",
    answers: answers(),
    now: new Date("2026-10-09T00:00:00.000Z"),
    requestedMode: "quick",
  }).path;
  for (const step of [1, 4, 9]) {
    const definition = WORKFLOW_STEPS.find((item) => item.step === step)!;
    appendWorkflowJournalEntry({
      staging,
      entry: {
        step,
        skillId: definition.skillId,
        mode: "quick",
        recordedAt: "2026-10-09T00:00:00.000Z",
        artifacts: [`artifact-${step}`],
        evidence: `step ${step}の固定証拠`,
        ...(step === 9 ? { implementationHeadSha: first } : {}),
      },
    });
  }
  const draft = buildReviewRoundDraft({
    staging,
    headSha: first,
    baseSha: base,
    scopeIds: ["SCOPE-1544"],
    acceptanceCriteriaIds: ["AC-01"],
  });
  assert.deepEqual(draft.round.inspection, {
    fromSha: base,
    diffDigest: observeReviewDiff(root, base, first).digest,
  });
  recordReviewRound({ staging, round: draft.round });
  return { root, staging, base, first };
}

/** SCN-INT-REVREUSE-001 */
function draftAndApply(world: ReuseWorld): void {
  const scaffold = {
    "test/steps/app.steps.ts":
      'import { defineStep } from "@cucumber/cucumber";\nimport "../../src/c.js";\n\ndefineStep("起動する", () => undefined);\n',
    "test/features/app.feature":
      "Feature: アプリ\n  Scenario: SCN-FX-1544 起動\n    Given 起動する\n",
  };
  const { root, staging, first } = stagedRepository(world, {
    "src/b.ts": "export const b = (): number => 1;\n",
    "src/c.ts":
      'import { b } from "./b.js";\n\nexport const c = (): number => b();\n',
    ...scaffold,
  });
  const fixed = commitFiles(
    root,
    { "src/b.ts": "export const b = (): number => 2;\n" },
    "fix",
  );
  const built = buildReviewRoundDraft({ staging, headSha: fixed });
  const expected = {
    fromSha: first,
    diffDigest: observeReviewDiff(root, first, fixed).digest,
  };
  assert.deepEqual(built.round.inspection, expected);
  assert.ok(
    built.notes.some((note) =>
      note.includes(`検分割当: git diff ${first}..${fixed}`),
    ),
    built.notes.join("\n"),
  );
  assert.deepEqual(
    previewReviewRound({ staging, round: built.round }).rounds.at(-1)
      ?.inspection,
    expected,
  );
  const tampered = parseReviewRoundInput({
    ...built.round,
    inspection: {
      ...expected,
      diffDigest: `${expected.diffDigest.slice(0, 63)}${expected.diffDigest.endsWith("0") ? "1" : "0"}`,
    },
  });
  assert.throws(
    () => recordReviewRound({ staging, round: tampered }),
    /review roundのinspectionが実Gitから導出した検分identityと一致しません/u,
  );
  const missing = { ...built.round } as Record<string, unknown>;
  delete missing.inspection;
  assert.deepEqual(
    recordReviewRound({
      staging,
      round: parseReviewRoundInput(missing),
    }).rounds.at(-1)?.inspection,
    expected,
  );
  // clean追随で交差が無ければ雛形はfollowOnlyを立てる。
  const lib = stagedRepository(world, {
    "src/lib.ts": "export const lib = (): number => 1;\n",
  });
  const advanced = advanceDefault(lib.root, lib.base, {
    "test/steps/app.steps.ts":
      'import { defineStep } from "@cucumber/cucumber";\n// exercises lib.js\ndefineStep("起動する", () => undefined);\n',
    "test/features/app.feature":
      "Feature: アプリ\n  Scenario: SCN-FX-1544 起動\n    Given 起動する\n",
  });
  const followed = mergeDefault(lib.root, advanced);
  const follow = buildReviewRoundDraft({
    staging: lib.staging,
    headSha: followed,
  });
  assert.equal(follow.round.followOnly, true, follow.notes.join("\n"));
  assert.equal(follow.round.inspection, undefined);
  assert.equal(
    recordReviewRound({ staging: lib.staging, round: follow.round }).rounds.at(
      -1,
    )?.followOnly,
    true,
  );
}

Given("review再利用unit検査の準備がある", function () {
  this.reuseChecked = false;
});

When(
  "{string}のreview再利用unit検査を実行する",
  function (this: ReuseWorld, scenarioId: string) {
    const checks: Record<string, () => void> = {
      "SCN-UNIT-REVREUSE-001": () => sectionDigests(this),
      "SCN-UNIT-REVREUSE-002": chainAssembly,
      "SCN-UNIT-REVREUSE-003": linkClassification,
      "SCN-UNIT-REVREUSE-004": derivedBase,
      "SCN-UNIT-REVREUSE-005": wholeInspection,
      "SCN-UNIT-REVREUSE-006": transitionVerification,
      "SCN-UNIT-REVREUSE-007": followCrossingCheck,
      "SCN-UNIT-REVREUSE-008": cumulativeCoverage,
      "SCN-UNIT-REVREUSE-009": verdictAndDiagnostic,
      "SCN-UNIT-REVREUSE-010": assignment,
      "SCN-UNIT-REVREUSE-011": () => adapterObservation(this),
      "SCN-UNIT-REVIEWCONV-012": inspectionShape,
      "SCN-UNIT-REVIEWCONV-013": legacyDetection,
      "SCN-UNIT-REVIEWCONV-014": sameHeadAfterConvergence,
      "SCN-UNIT-REVIEWCONV-015": () => followMergeExtension(this),
      "SCN-INT-REVREUSE-001": () => draftAndApply(this),
    };
    const check = checks[scenarioId];
    if (check === undefined)
      throw new Error(`未対応のreview再利用検査です: ${scenarioId}`);
    check();
    this.reuseChecked = true;
  },
);

Then("review再利用unit検査は期待結果になる", function () {
  assert.equal(this.reuseChecked, true);
});
