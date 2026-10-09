import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { stepDefinitions } from "../support/world.js";
import {
  buildReviewRoundDraft,
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  REVIEW_SESSION_FILE,
  readStoredReviewSession,
} from "../../src/adapters/review-session-store.js";
import { REVIEW_SESSION_REPLACEMENTS_FILE } from "../../src/adapters/review-session-replacement-store.js";
import {
  advanceReviewSession,
  isLegacyReviewSession,
  parseReviewRoundInput,
  type ReviewRoundInput,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { stableJson } from "../../src/lib/security.js";
import {
  applyReviewReplace,
  commitReviewEvidence,
  createDeliveryPullRequest,
  deliveryProviderCalls,
  executeCli,
  executeDeliveryMerge,
  executeDeliveryMergePreview,
  executeReanchor,
  fixtureGit,
  isMergeCall,
  pointProviderAt,
  prepareDeliveryCli,
  recordPostPrIntake,
  stagingBytes,
  type PreparedDeliveryCli,
  type WorkflowStepWorld,
} from "./workflow-step-enforcement.steps.js";

/**
 * review再利用条件（Issue #1544）の受け入れE2E。実CLIの`pr merge`を一時Git repository・
 * file-based remote・偽providerで実行し、判定を直接呼ばず合成経路で検査する（NFR-05）。
 */
const { Given, When, Then } = stepDefinitions<WorkflowStepWorld>();

/** 診断へ環境値が混入しないことを確かめるための値（NFR-07）。 */
const SECRET = "ghp_asc1544fixturesecretvalue";
const FILE_LINES = Array.from({ length: 12 }, (_, index) => `line ${index}`);

function lines(edits: Record<number, string>): string {
  return `${FILE_LINES.map((line, index) => edits[index] ?? line).join("\n")}\n`;
}

/** `null`はfileの削除を表す。 */
function writeFiles(root: string, files: Record<string, string | null>): void {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    if (content === null) {
      fs.rmSync(file);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function commitIn(
  root: string,
  files: Record<string, string | null>,
  message: string,
): string {
  writeFiles(root, files);
  fixtureGit(root, ["add", "-A", "--", ...Object.keys(files)]);
  fixtureGit(root, ["commit", "-q", "-m", message]);
  return fixtureGit(root, ["rev-parse", "HEAD"]);
}

function commit(
  prepared: PreparedDeliveryCli,
  files: Record<string, string | null>,
  message: string,
): string {
  return commitIn(prepared.root, files, message);
}

const EVIDENCE = "docs/reviews/877_review.json";

/**
 * 影響集合がtargetedになる意味Graphの足場（step定義・feature）。`target`はstep定義が
 * importする（`import`）か、字面だけで参照する（`literal`）source。
 */
function scaffold(
  target: string,
  reference: "import" | "literal",
): Record<string, string> {
  const name = path.basename(target).replace(/\.ts$/u, ".js");
  return {
    "test/steps/app.steps.ts": `import { defineStep } from "@cucumber/cucumber";\n${reference === "import" ? `import "../../${target.replace(/\.ts$/u, ".js")}";\n` : `// exercises ${name}\n`}\ndefineStep("アプリを起動する", () => undefined);\n`,
    "test/features/app.feature":
      "Feature: アプリ\n  Scenario: SCN-FX-1544 起動する\n    Given アプリを起動する\n",
  };
}

/**
 * PRを作った状態まで進める。`commits`を渡すと比較基点Tの上の連続commitを実装にする。
 */
function prepare(
  world: WorkflowStepWorld,
  commits?: Record<string, string>[],
): PreparedDeliveryCli & { shared?: string } {
  let shared: string | undefined;
  const prepared = prepareDeliveryCli(
    world,
    {},
    "automatic",
    "merge",
    undefined,
    "quick",
    0,
    "valid",
    false,
    commits
      ? (root) => {
          commits.forEach((files, index) => {
            const sha = commitIn(root, files, `implementation ${index}`);
            if (index === 0) shared = sha;
          });
        }
      : undefined,
  );
  createDeliveryPullRequest(prepared);
  return Object.assign(prepared, shared ? { shared } : {});
}

/**
 * PR作成前の是正と同じく、前roundのH_implからの差分を是正内容だけにする（証跡commitの
 * 上で証跡fileを外し、`pr reanchor`の前進条件は保つ）。
 */
function fixOnTopOfEvidence(
  prepared: PreparedDeliveryCli,
  files: Record<string, string>,
): string {
  return commit(
    prepared,
    { ...files, [EVIDENCE]: null },
    "fix: round 1 finding",
  );
}

function draft(prepared: PreparedDeliveryCli, headSha: string) {
  return buildReviewRoundDraft({ staging: prepared.staging, headSha });
}

function recordDraft(
  prepared: PreparedDeliveryCli,
  headSha: string,
): ReviewSessionState {
  return recordReviewRound({
    staging: prepared.staging,
    round: draft(prepared, headSha).round,
  });
}

/** 証跡commit・post-PR intake・provider観測・`pr reanchor`で実効headを進める。 */
function deliver(
  prepared: PreparedDeliveryCli,
  input: { evidenceBase: string; implementation: string; tip: string },
): string {
  const session = readStoredReviewSession(prepared.staging);
  assert.ok(session);
  const finalHead = commitReviewEvidence(
    prepared,
    input.evidenceBase,
    input.implementation,
  );
  recordPostPrIntake(prepared, session.latestRoundDigest);
  pointProviderAt(prepared, input.tip, finalHead, input.implementation);
  const reanchored = executeReanchor(
    prepared,
    finalHead,
    input.evidenceBase,
    "--apply",
  );
  assert.equal(reanchored.status, 0, reanchored.stdout + reanchored.stderr);
  return finalHead;
}

function deliverAtBase(prepared: PreparedDeliveryCli, implementation: string) {
  return deliver(prepared, {
    evidenceBase: prepared.baseSha,
    implementation,
    tip: prepared.baseSha,
  });
}

/** 拒否は終了値1・staging不変・merge要求なし・環境値の非包含で観測する。 */
function rejected(prepared: PreparedDeliveryCli): string {
  prepared.env.GH_TOKEN = SECRET;
  const before = stagingBytes(prepared.staging);
  const result = executeDeliveryMergePreview(prepared);
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.equal(stagingBytes(prepared.staging), before);
  assert.doesNotMatch(output, new RegExp(SECRET, "u"));
  assert.equal(deliveryProviderCalls(prepared).filter(isMergeCall).length, 0);
  return output;
}

function merged(prepared: PreparedDeliveryCli): void {
  const result = executeDeliveryMerge(prepared);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(deliveryProviderCalls(prepared).filter(isMergeCall).length, 1);
}

/** 既定branchを`from`から前進させ、remote-tracking refを前進後のcommitへ向ける。 */
function advanceMain(
  prepared: PreparedDeliveryCli,
  from: string,
  files: Record<string, string>,
): string {
  const branch = fixtureGit(prepared.root, ["symbolic-ref", "--short", "HEAD"]);
  fixtureGit(prepared.root, ["checkout", "-q", "-b", "asc-1544-main", from]);
  const advanced = commit(prepared, files, "default branch advance");
  fixtureGit(prepared.root, [
    "update-ref",
    "refs/remotes/origin/main",
    advanced,
  ]);
  fixtureGit(prepared.root, ["checkout", "-q", branch]);
  fixtureGit(prepared.root, ["branch", "-D", "asc-1544-main"]);
  return advanced;
}

function mergeMain(
  prepared: PreparedDeliveryCli,
  advanced: string,
  resolve?: (root: string) => void,
): string {
  if (resolve === undefined)
    fixtureGit(prepared.root, [
      "merge",
      "-q",
      "--no-ff",
      advanced,
      "-m",
      "merge default branch advance",
    ]);
  else {
    fixtureGit(prepared.root, [
      "merge",
      "-q",
      "--no-ff",
      "--no-commit",
      advanced,
    ]);
    resolve(prepared.root);
    fixtureGit(prepared.root, ["commit", "-q", "-m", "merge with resolution"]);
  }
  return fixtureGit(prepared.root, ["rev-parse", "HEAD"]);
}

/**
 * 保存済みsessionのroundを直接書き換え、round digestを再計算して保存する
 * （THR-1544-02の攻撃形。digest chainは整合し、Gitとの照合だけが改変を検出する）。
 */
function rewriteRound(
  prepared: PreparedDeliveryCli,
  roundNumber: number,
  edit: (round: ReviewRoundInput) => unknown,
): void {
  const stored = readStoredReviewSession(prepared.staging);
  assert.ok(stored);
  let rebuilt: ReviewSessionState | null = null;
  for (const record of stored.rounds) {
    const input = parseReviewRoundInput({
      round: record.round,
      previousRoundDigest: rebuilt?.latestRoundDigest ?? null,
      anchor: stored.anchor,
      candidateHeadSha: record.candidateHeadSha,
      focus: record.focus,
      findings: record.findings.map((finding) => {
        const copy: Record<string, unknown> = { ...finding };
        delete copy.admission;
        delete copy.admissionReason;
        return copy;
      }),
      ...(record.followOnly ? { followOnly: true } : {}),
      ...(record.inspection ? { inspection: record.inspection } : {}),
    });
    rebuilt = advanceReviewSession(
      rebuilt,
      record.round === roundNumber ? parseReviewRoundInput(edit(input)) : input,
    );
  }
  fs.writeFileSync(
    path.join(prepared.staging, REVIEW_SESSION_FILE),
    `${stableJson(rebuilt)}\n`,
  );
  refreshStoredStagingDigest(prepared.staging);
}

function withoutInspection(round: ReviewRoundInput): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...round };
  delete copy.inspection;
  return copy;
}

/** 実装を通さない独立oracle: `git diff ... -- <path>`単独出力のsha256（無ければ空差分）。 */
function pathDigest(
  prepared: PreparedDeliveryCli,
  baseSha: string,
  headSha: string,
  target: string,
): string {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseSha,
      headSha,
      "--",
      target,
    ],
    {
      cwd: prepared.root,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      encoding: "utf8",
    },
  );
  return crypto.createHash("sha256").update(output).digest("hex");
}

function flipLast(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
}

function assertNamed(output: string, ...needles: string[]): void {
  for (const needle of needles) assert.ok(output.includes(needle), output);
}

const ADJACENT_FILES = {
  "src/b.ts": "export const b = (): number => 1;\n",
  "src/c.ts":
    'import { b } from "./b.js";\n\nexport const c = (): number => b() + 1;\n',
  "src/d.ts":
    'import { b } from "./b.js";\nimport "./c.js";\n\nexport const d = (): number => b() + 2;\n',
  ...scaffold("src/d.ts", "import"),
};
const FIXED_B = { "src/b.ts": "export const b = (): number => 2;\n" };

/** SCN-REVIEW-REUSE-001: focused round 2（公開CLIの`review round --init`・`--apply`）。 */
function focusedRoundTwo(world: WorkflowStepWorld): void {
  const prepared = prepare(world, [ADJACENT_FILES]);
  const first = prepared.implementationCommitSha;
  const fixed = fixOnTopOfEvidence(prepared, FIXED_B);
  const out = path.join(world.temp("asc-1544-round-"), "round.json");
  const init = executeCli(
    [
      "review",
      "round",
      `--staging=${prepared.staging}`,
      `--head=${fixed}`,
      "--init",
      `--out=${out}`,
    ],
    prepared.root,
    prepared.env,
  );
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const expected = {
    fromSha: first,
    diffDigest: observeReviewDiff(prepared.root, first, fixed).digest,
  };
  const written = JSON.parse(fs.readFileSync(out, "utf8")) as ReviewRoundInput;
  assert.deepEqual(written.inspection, expected);
  assert.deepEqual(
    written.focus.adjacentScope.map(({ path: item }) => item),
    ["src/c.ts", "src/d.ts"],
  );
  const applied = executeCli(
    [
      "review",
      "round",
      `--staging=${prepared.staging}`,
      `--file=${out}`,
      "--apply",
    ],
    prepared.root,
    prepared.env,
  );
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const session = readStoredReviewSession(prepared.staging);
  assert.equal(session?.rounds.length, 2);
  assert.deepEqual(session?.rounds[1]?.inspection, expected);
  deliverAtBase(prepared, fixed);
  merged(prepared);
  assert.equal(
    fs.existsSync(
      path.join(prepared.staging, REVIEW_SESSION_REPLACEMENTS_FILE),
    ),
    false,
  );
}

/** SCN-REVIEW-REUSE-002: 追随後に既定branchのhunkだけを巻き戻す（REV-01）。 */
function revertedDefaultBranchHunk(
  world: WorkflowStepWorld,
  conflictResolution: boolean,
): void {
  const prepared = prepare(world, [
    { "f.txt": lines({}) },
    { "f.txt": lines({ 2: "pull request change" }) },
  ]);
  const first = prepared.implementationCommitSha;
  const advanced = advanceMain(prepared, prepared.shared!, {
    "f.txt": lines({ 9: "default branch change" }),
  });
  let candidate: string;
  if (conflictResolution)
    candidate = mergeMain(prepared, advanced, (root) => {
      fixtureGit(root, ["checkout", first, "--", "f.txt"]);
    });
  else {
    mergeMain(prepared, advanced);
    candidate = commit(
      prepared,
      { "f.txt": lines({ 2: "pull request change" }) },
      "revert default branch hunk only",
    );
  }
  recordDraft(prepared, candidate);
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: candidate,
    tip: advanced,
  });
  const output = rejected(prepared);
  assertNamed(
    output,
    `実際のmerge-base(${advanced})がreview sessionの比較基点(${prepared.baseSha})と一致しません`,
    "[基点不一致] path=f.txt",
    `transition=${first}..${candidate}`,
  );
}

/** SCN-REVIEW-REUSE-003 */
function unreviewedAdjacent(world: WorkflowStepWorld): void {
  const prepared = prepare(world, [ADJACENT_FILES]);
  const first = prepared.implementationCommitSha;
  const fixed = fixOnTopOfEvidence(prepared, FIXED_B);
  recordDraft(prepared, fixed);
  rewriteRound(prepared, 2, (round) => {
    assert.deepEqual(
      round.focus.adjacentScope.map(({ path: item }) => item),
      ["src/c.ts", "src/d.ts"],
    );
    return {
      ...round,
      focus: {
        ...round.focus,
        adjacentScope: round.focus.adjacentScope.slice(0, 1),
      },
    };
  });
  deliverAtBase(prepared, fixed);
  assertNamed(
    rejected(prepared),
    `[依存先未検分] path=src/d.ts transition=${first}..${fixed}`,
    "次の操作:",
  );
}

/** SCN-REVIEW-REUSE-004: 改変の種類ごとに独立したfixtureで観測する。 */
function tamperedInspection(
  world: WorkflowStepWorld,
  tamper:
    | "digest"
    | "break"
    | "unobservable"
    | "whole-review"
    | "tampered-whole-review",
): void {
  const prepared = prepare(world, [ADJACENT_FILES]);
  const first = prepared.implementationCommitSha;
  const fixed = fixOnTopOfEvidence(prepared, FIXED_B);
  recordDraft(prepared, fixed);
  const recomputed = observeReviewDiff(prepared.root, first, fixed).digest;
  rewriteRound(prepared, 2, (round) => ({
    ...round,
    inspection:
      tamper === "break"
        ? {
            fromSha: prepared.baseSha,
            diffDigest: observeReviewDiff(
              prepared.root,
              prepared.baseSha,
              fixed,
            ).digest,
          }
        : tamper === "unobservable"
          ? { fromSha: "f".repeat(40), diffDigest: recomputed }
          : { fromSha: first, diffDigest: flipLast(recomputed) },
  }));
  if (tamper === "whole-review" || tamper === "tampered-whole-review") {
    // 改変より後ろに全体検分roundがあれば、全体検分が鎖を被覆する（FR-04）。
    const whole = recordDraft(prepared, fixed).rounds.at(-1)?.inspection
      ?.cumulative;
    assert.equal(whole?.scope, "all");
    assert.equal(whole?.baseSha, prepared.baseSha);
    const wholeDigest = observeReviewDiff(
      prepared.root,
      prepared.baseSha,
      fixed,
    ).digest;
    assert.equal(whole?.scope === "all" && whole.diffDigest, wholeDigest);
    if (tamper === "whole-review") {
      deliverAtBase(prepared, fixed);
      return merged(prepared);
    }
    rewriteRound(prepared, 3, (round) => ({
      ...round,
      inspection: {
        ...round.inspection!,
        cumulative: {
          baseSha: prepared.baseSha,
          scope: "all",
          diffDigest: flipLast(wholeDigest),
        },
      },
    }));
    deliverAtBase(prepared, fixed);
    return assertNamed(
      rejected(prepared),
      `[digest不一致] path=なし transition=${prepared.baseSha}..${fixed} 再計算digest=${wholeDigest}`,
    );
  }
  deliverAtBase(prepared, fixed);
  const output = rejected(prepared);
  if (tamper === "digest")
    assertNamed(
      output,
      `[digest不一致] path=なし transition=${first}..${fixed} 再計算digest=${recomputed}`,
      "全体検分round",
      "review replace",
    );
  else if (tamper === "break")
    assertNamed(
      output,
      `[断絶] path=なし transition=${first}..${prepared.baseSha}`,
      "review replace",
    );
  else
    assertNamed(
      output,
      "verdict=undecidable",
      `[判定不能] path=なし transition=${"f".repeat(40)}..${fixed}`,
      "全体検分round",
    );
}

/** SCN-REVIEW-REUSE-005 */
function legacySession(world: WorkflowStepWorld): void {
  const prepared = prepare(world);
  const fixture = {
    prepared,
    branch: fixtureGit(prepared.root, ["symbolic-ref", "--short", "HEAD"]),
    baseSha: prepared.baseSha,
    implementationSha: prepared.implementationCommitSha,
    pullRequestHeadSha: prepared.headSha,
  };
  applyReviewReplace(fixture);
  const head = fixture.implementationSha;
  const anchor = {
    scopeIds: ["SCOPE-WORKFLOW"],
    acceptanceCriteriaIds: ["AC-WF-005"],
    invariantIds: [],
    diffBaseSha: prepared.baseSha,
    initialHeadSha: head,
    initialDiffDigest: observeReviewDiff(prepared.root, prepared.baseSha, head)
      .digest,
  };
  const finding = (status: "valid" | "resolved") => ({
    id: "H-1544",
    severity: "High",
    status,
    source: "review",
    relation: "acceptance-violation",
    evidence: "旧形式sessionのfixture",
    path: "implementation.txt",
    contractId: "AC-WF-005",
    causedByFindingId: null,
    decisionRef: null,
  });
  const roundOne = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor,
      candidateHeadSha: head,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [finding("valid")],
    }),
  );
  const legacy = advanceReviewSession(
    roundOne,
    parseReviewRoundInput({
      round: 2,
      previousRoundDigest: roundOne.latestRoundDigest,
      anchor,
      candidateHeadSha: head,
      focus: {
        previousBlocking: ["H-1544"],
        fixedDiff: [],
        adjacentScope: [],
      },
      findings: [finding("resolved")],
    }),
  );
  assert.equal(isLegacyReviewSession(legacy), true);
  fs.writeFileSync(
    path.join(prepared.staging, REVIEW_SESSION_FILE),
    `${stableJson(legacy)}\n`,
  );
  refreshStoredStagingDigest(prepared.staging);
  deliverAtBase(prepared, head);
  const output = rejected(prepared);
  assertNamed(
    output,
    "review sessionのcounted round数(2)が1ではありません。暫定guardは単一のfull-scope round（round 1）だけで収束したsessionだけを受理します（Issue #1495暫定guard、Issue #1544解決まで）。current H_implで収束済みなら`review replace --staging=<staging> --apply`でreview sessionを置換し、round 1からやり直してください",
  );
  assert.doesNotMatch(output, /review再利用条件/u);
}

/** 既定branchだけが足場とnoteを追加し、PRはstep定義から字面で参照される`src/lib.ts`を足す。 */
function disjointFollowFixture(world: WorkflowStepWorld) {
  const prepared = prepare(world, [
    { "src/lib.ts": "export const lib = (): number => 1;\n" },
  ]);
  const advanced = advanceMain(prepared, prepared.baseSha, {
    ...scaffold("src/lib.ts", "literal"),
    "docs/upstream-note.md": "default branch advance\n",
  });
  const followed = mergeMain(prepared, advanced);
  const built = draft(prepared, followed);
  assert.equal(built.round.followOnly, true);
  assert.equal(built.round.inspection, undefined);
  assert.ok(
    built.notes.some((note) => note.includes(`--base=${advanced}`)),
    built.notes.join("\n"),
  );
  recordReviewRound({ staging: prepared.staging, round: built.round });
  return { prepared, advanced, followed };
}

/** SCN-REVIEW-REUSE-006: 追随後の証跡・検証を`--base`無し（旧基点）で取った。 */
function staleEvidenceBase(world: WorkflowStepWorld): void {
  const { prepared, advanced, followed } = disjointFollowFixture(world);
  deliver(prepared, {
    evidenceBase: prepared.baseSha,
    implementation: followed,
    tip: advanced,
  });
  assertNamed(
    rejected(prepared),
    `review証跡の比較基点(${prepared.baseSha})がactualAuditBase(${advanced})と一致しません`,
    `実効H_impl ${followed}`,
    `verify run --base=${advanced}`,
    `review export --base=${advanced}`,
  );
}

/** SCN-REVIEW-REUSE-007 */
function disjointFollow(world: WorkflowStepWorld): void {
  const { prepared, advanced, followed } = disjointFollowFixture(world);
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: followed,
    tip: advanced,
  });
  merged(prepared);
}

/** SCN-REVIEW-REUSE-009 */
function intersectingFollow(world: WorkflowStepWorld, reviewed: boolean): void {
  const prepared = prepare(world, [
    {
      "src/b.ts":
        'import { a } from "./a.js";\n\nexport const b = (): number => a() + 1;\n',
    },
  ]);
  const advanced = advanceMain(prepared, prepared.baseSha, {
    "src/a.ts": "export const a = (): number => 2;\n",
    ...scaffold("src/b.ts", "literal"),
  });
  const followed = mergeMain(prepared, advanced);
  const built = draft(prepared, followed).round;
  assert.equal(built.followOnly, undefined);
  assert.equal(built.inspection?.cumulative?.scope, "all");
  recordReviewRound({
    staging: prepared.staging,
    round: parseReviewRoundInput({
      ...withoutInspection(built),
      findings: [],
      followOnly: true,
    }),
  });
  if (reviewed) {
    const remedy = recordDraft(prepared, followed).rounds.at(-1)?.inspection
      ?.cumulative;
    assert.deepEqual(remedy, {
      baseSha: advanced,
      scope: "paths",
      paths: [
        {
          path: "src/a.ts",
          diffDigest: pathDigest(prepared, advanced, followed, "src/a.ts"),
        },
      ],
    });
  }
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: followed,
    tip: advanced,
  });
  if (reviewed) return merged(prepared);
  assertNamed(
    rejected(prepared),
    "[追随交差] path=src/a.ts 既定branch側path=src/a.ts,",
    `transition=${prepared.implementationCommitSha}..${followed}`,
  );
}

/** SCN-REVIEW-REUSE-009: 実装commitを挟んだmergeは追随として記録できない（C4）。 */
function followAfterImplementation(world: WorkflowStepWorld): void {
  const prepared = prepare(world);
  commit(prepared, { "implementation.txt": "unreviewed change\n" }, "impl");
  const advanced = advanceMain(prepared, prepared.baseSha, {
    "docs/upstream-note.md": "default branch advance\n",
  });
  const merged = mergeMain(prepared, advanced);
  const built = draft(prepared, merged).round;
  assert.equal(built.followOnly, undefined);
  assert.throws(
    () =>
      recordReviewRound({
        staging: prepared.staging,
        round: parseReviewRoundInput({
          ...withoutInspection(built),
          findings: [],
          followOnly: true,
        }),
      }),
    /既定branch追随として記録できるのは/u,
  );
}

/** SCN-REVIEW-REUSE-010 */
function singleRoundFastPath(world: WorkflowStepWorld): void {
  const prepared = prepare(world);
  const session = readStoredReviewSession(prepared.staging);
  assert.ok(session);
  assert.equal(isLegacyReviewSession(session), false);
  merged(prepared);
}

/** SCN-REVIEW-REUSE-011 */
function securityPathCumulative(
  world: WorkflowStepWorld,
  dropCumulative: boolean,
): void {
  const prepared = prepare(world, [
    {
      "src/merge-gate.ts": "export const gate = (): boolean => true;\n",
      ...scaffold("src/merge-gate.ts", "import"),
    },
  ]);
  const fixed = fixOnTopOfEvidence(prepared, {
    "src/merge-gate.ts": "export const gate = (): boolean => false;\n",
  });
  const built = draft(prepared, fixed).round;
  assert.deepEqual(built.inspection?.cumulative, {
    baseSha: prepared.baseSha,
    scope: "paths",
    paths: [
      {
        path: "src/merge-gate.ts",
        diffDigest: pathDigest(
          prepared,
          prepared.baseSha,
          fixed,
          "src/merge-gate.ts",
        ),
      },
    ],
  });
  recordReviewRound({ staging: prepared.staging, round: built });
  if (dropCumulative)
    rewriteRound(prepared, 2, (round) => ({
      ...round,
      inspection: {
        fromSha: round.inspection!.fromSha,
        diffDigest: round.inspection!.diffDigest,
      },
    }));
  deliverAtBase(prepared, fixed);
  if (!dropCumulative) return merged(prepared);
  assertNamed(
    rejected(prepared),
    `[累積差分未検分] path=src/merge-gate.ts transition=${prepared.implementationCommitSha}..${fixed}`,
  );
}

Given("review再利用E2Eの隔離環境がある", function () {
  this.workflowCheckPassed = false;
});

When(
  "{string}のreview再利用E2E検査を実行する",
  function (this: WorkflowStepWorld, scenarioId: string) {
    switch (scenarioId) {
      case "SCN-REVIEW-REUSE-001":
        focusedRoundTwo(this);
        break;
      case "SCN-REVIEW-REUSE-002":
        revertedDefaultBranchHunk(this, false);
        revertedDefaultBranchHunk(this, true);
        break;
      case "SCN-REVIEW-REUSE-003":
        unreviewedAdjacent(this);
        break;
      case "SCN-REVIEW-REUSE-004":
        for (const tamper of [
          "digest",
          "break",
          "unobservable",
          "whole-review",
          "tampered-whole-review",
        ] as const)
          tamperedInspection(this, tamper);
        break;
      case "SCN-REVIEW-REUSE-005":
        legacySession(this);
        break;
      case "SCN-REVIEW-REUSE-006":
        staleEvidenceBase(this);
        break;
      case "SCN-REVIEW-REUSE-007":
        disjointFollow(this);
        break;
      case "SCN-REVIEW-REUSE-009":
        intersectingFollow(this, false);
        intersectingFollow(this, true);
        followAfterImplementation(this);
        break;
      case "SCN-REVIEW-REUSE-010":
        singleRoundFastPath(this);
        break;
      case "SCN-REVIEW-REUSE-011":
        securityPathCumulative(this, false);
        securityPathCumulative(this, true);
        break;
      default:
        throw new Error(`未対応のreview再利用E2E scenarioです: ${scenarioId}`);
    }
    this.workflowCheckPassed = true;
  },
);

Then("review再利用E2E検査は期待結果になる", function () {
  assert.equal(this.workflowCheckPassed, true);
});
