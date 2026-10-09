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
import { parseReviewEvidence } from "../../src/domain/review-evidence.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { stableJson } from "../../src/lib/security.js";
import {
  resealObservedEvidence,
  reviewEvidenceContentFromStaging,
} from "../support/review-evidence-fixture.js";
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

/**
 * PR作成後の実運用どおり、証跡commitの上に是正内容だけを足す（証跡fileは残す）。
 * 前roundのH_implからのtransitionは証跡pathを含む（Issue #1544 INV-07）。
 */
function fixRetainingEvidence(
  prepared: PreparedDeliveryCli,
  files: Record<string, string>,
): string {
  const fixed = commit(prepared, files, "fix: round 1 finding");
  // 前提の自己確認: transitionが証跡pathと是正pathの両方を含む。
  assert.deepEqual(
    observeReviewDiff(prepared.root, prepared.implementationCommitSha, fixed)
      .changedPaths,
    [...new Set([EVIDENCE, ...Object.keys(files)])].sort(),
  );
  return fixed;
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
 * local Gitの既定branch tip（`refs/remotes/origin/main`）を一時的に`sha`へ戻して`run`を実行する。
 * 追随を取り込む前に`review round`を記録した状態（追随mergeを全体検分なしのtransitionとして
 * 記録したround）を作る。
 */
function withLocalTip<T>(
  prepared: PreparedDeliveryCli,
  sha: string,
  run: () => T,
): T {
  const current = fixtureGit(prepared.root, [
    "rev-parse",
    "refs/remotes/origin/main",
  ]);
  fixtureGit(prepared.root, ["update-ref", "refs/remotes/origin/main", sha]);
  try {
    return run();
  } finally {
    fixtureGit(prepared.root, [
      "update-ref",
      "refs/remotes/origin/main",
      current,
    ]);
  }
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

/**
 * SCN-REVIEW-REUSE-001: focused round 2（公開CLIの`review round --init`・`--apply`）。
 * `retainEvidence`は証跡fileを残した是正（transitionが証跡pathを含む）で、影響は前headの
 * review記録（証跡commit）の後から導出するため同じtargetedの割当になる。
 */
function focusedRoundTwo(
  world: WorkflowStepWorld,
  retainEvidence: boolean,
): void {
  const prepared = prepare(world, [ADJACENT_FILES]);
  const first = prepared.implementationCommitSha;
  const fixed = retainEvidence
    ? fixRetainingEvidence(prepared, FIXED_B)
    : fixOnTopOfEvidence(prepared, FIXED_B);
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
  assert.equal(written.focus.adjacentScopeUnbounded, undefined);
  assert.deepEqual(
    written.focus.fixedDiff,
    retainEvidence ? [EVIDENCE, "src/b.ts"] : ["src/b.ts"],
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

/**
 * SCN-REVIEW-REUSE-002: 追随後に既定branchのhunkだけを巻き戻す（REV-01）。巻き戻しを含む
 * transitionは追随前のlocal tipで記録し（全体検分の割当なし）、基点の移動を被覆しない。
 */
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
  const recorded = withLocalTip(prepared, prepared.baseSha, () =>
    recordDraft(prepared, candidate),
  );
  assert.deepEqual(recorded.rounds.at(-1)?.inspection, {
    fromSha: first,
    diffDigest: observeReviewDiff(prepared.root, first, candidate).digest,
  });
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

type EvidenceReaderShape =
  | "source"
  | "evidence-name"
  | "other-json"
  | "graph-unavailable"
  | "lib-import"
  | "script-read"
  | "oversized-reader"
  | "dynamic-read"
  | "evidence-rewrite"
  | "foreign-record"
  | "forged-digest";

/** 4 MiB（意味Graphのfile上限）を超える行コメント。本文は観測から落ちる。 */
const OVERSIZED_PADDING = `// ${"x".repeat(4 * 1024 * 1024)}\n`;

const EVIDENCE_IMPORT_GATE =
  'import data from "../docs/reviews/9_review.json" with { type: "json" };\n\nexport const gate = (n: number): boolean => n <= data.limit;\n';

/** 証跡形のfileを読む実装（`helper`以外の足場）。 */
function evidenceReaders(shape: EvidenceReaderShape): Record<string, string> {
  switch (shape) {
    case "source":
      return {
        "src/limit-gate.ts":
          'import { LIMIT } from "../docs/reviews/helper.js";\n\nexport const gate = (n: number): boolean => n <= LIMIT;\n',
      };
    case "other-json":
      return {
        "src/limit-gate.ts":
          "export const gate = (n: number): boolean => n <= 1;\n",
      };
    case "evidence-name":
      return { "src/limit-gate.ts": EVIDENCE_IMPORT_GATE };
    case "graph-unavailable":
      return {
        "src/limit-gate.ts": EVIDENCE_IMPORT_GATE,
        "test/support/broken.ts": "export const = ;\n",
      };
    // R1544-2-01 (a): src/外のsourceがimportし、src/はre-exportするだけ。
    case "lib-import":
      return {
        "lib/limit-gate.ts": EVIDENCE_IMPORT_GATE,
        "src/limit-gate.ts": 'export { gate } from "../lib/limit-gate.js";\n',
      };
    // R1544-2-01 (b): scriptがfile pathで読み、終了値を決める。
    case "script-read":
      return {
        "scripts/gate.ts":
          'import fs from "node:fs";\n\nconst data = JSON.parse(fs.readFileSync("docs/reviews/9_review.json", "utf8"));\nprocess.exit(data.limit > 1 ? 1 : 0);\n',
        "src/limit-gate.ts":
          "export const gate = (n: number): boolean => n <= 1;\n",
      };
    // R1544-2-01 (c): importするsrc/のfileが4 MiBを超え、本文が観測されない。
    case "oversized-reader":
      return { "src/limit-gate.ts": EVIDENCE_IMPORT_GATE + OVERSIZED_PADDING };
    // file名を組み立てて読む。全fileを字面で走査してもfile名は現れない。
    case "dynamic-read":
      return { "src/limit-gate.ts": dynamicEvidenceReader(9) };
    // 証跡file自身をfile名の組み立てで読む。
    case "evidence-rewrite":
    case "foreign-record":
    case "forged-digest":
      return { "src/limit-gate.ts": dynamicEvidenceReader(877) };
  }
}

function dynamicEvidenceReader(issue: number): string {
  return `import fs from "node:fs";\n\nconst issue = ${issue};\nconst data = JSON.parse(fs.readFileSync(\`docs/reviews/\${issue}_review.json\`, "utf8"));\n\nexport const gate = (n: number): boolean => n <= (data.limit ?? 1);\n`;
}

/**
 * SCN-REVIEW-REUSE-003（R1544-1-01・R1544-2-01）: 前headのreview記録（証跡commit）の上で
 * evidence allowlist配下のfileを変える。影響は証跡commitの後から導出し、path名・file名の字面や
 * 「誰も読まない」ことの走査では何も外さない。`source`はallowlist配下の実装sourceで依存先の
 * 検分を割り当てる。`other-json`は証跡形でないJSON、`evidence-name`・`graph-unavailable`・
 * `lib-import`・`script-read`・`oversized-reader`・`dynamic-read`は証跡形のfileを`src/`・
 * `lib/`・`scripts/`が読む形（字面import、上限超過で本文が観測されないimport、file名を組み立てる
 * 読み取り）と意味Graphを構築できない状態、`evidence-rewrite`は証跡file自身を前headの記録で
 * ない内容へ、`foreign-record`は別headを束縛した正規の証跡へ、`forged-digest`は前headを束縛した
 * 正準形だがround digestがreview sessionと一致しない証跡（R1544-3-01）へ書き換えたもので、
 * いずれも全体検分を割り当てる。testが証跡pathを字面で持つfileも足場に含む。割当を外して証跡pathを除いた形へ
 * 書き換えたroundは`pr merge`が拒否する。
 */
function evidencePrefixedImplementation(
  world: WorkflowStepWorld,
  shape: EvidenceReaderShape,
): void {
  const ownEvidence =
    shape === "evidence-rewrite" ||
    shape === "foreign-record" ||
    shape === "forged-digest";
  const helper =
    shape === "source"
      ? "docs/reviews/helper.ts"
      : shape === "other-json"
        ? "docs/reviews/limits.json"
        : ownEvidence
          ? EVIDENCE
          : "docs/reviews/9_review.json";
  const content = (limit: number): string =>
    shape === "source"
      ? `export const LIMIT = ${limit};\n`
      : `{ "limit": ${limit} }\n`;
  const prepared = prepare(world, [
    {
      ...(ownEvidence ? {} : { [helper]: content(1) }),
      ...evidenceReaders(shape),
      "test/support/evidence-path.ts": `export const EVIDENCE = "${EVIDENCE}";\n`,
      ...scaffold("src/limit-gate.ts", "import"),
    },
  ]);
  const first = prepared.implementationCommitSha;
  const recorded = (): ReturnType<typeof parseReviewEvidence> =>
    parseReviewEvidence(
      fs.readFileSync(path.join(prepared.root, EVIDENCE), "utf8"),
    );
  const fixed = fixRetainingEvidence(prepared, {
    [helper]:
      shape === "foreign-record"
        ? resealObservedEvidence(recorded(), {
            implementationHeadSha: prepared.baseSha,
          })
        : shape === "forged-digest"
          ? resealObservedEvidence(recorded(), {
              session: {
                ...recorded().observed.session,
                latestRoundDigest: flipLast(
                  recorded().observed.session.latestRoundDigest,
                ),
              },
            })
          : content(100),
  });
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
  const written = JSON.parse(fs.readFileSync(out, "utf8")) as ReviewRoundInput;
  assert.deepEqual(
    written.focus.fixedDiff,
    [...new Set([EVIDENCE, helper])].sort(),
  );
  const transition = {
    fromSha: first,
    diffDigest: observeReviewDiff(prepared.root, first, fixed).digest,
  };
  if (shape === "source") {
    assert.deepEqual(
      written.focus.adjacentScope.map(({ path: item }) => item),
      ["src/limit-gate.ts"],
    );
    assert.equal(written.focus.adjacentScopeUnbounded, undefined);
    assert.deepEqual(written.inspection, transition);
  } else {
    assert.equal(written.focus.adjacentScopeUnbounded, true);
    assert.deepEqual(written.inspection, {
      ...transition,
      cumulative: {
        baseSha: prepared.baseSha,
        scope: "all",
        diffDigest: observeReviewDiff(prepared.root, prepared.baseSha, fixed)
          .digest,
      },
    });
  }
  recordDraft(prepared, fixed);
  // 証跡pathを除いて変更pathが残らない扱いにした記録（是正前の導出）へ書き換える。
  rewriteRound(prepared, 2, (round) => {
    const focus: Record<string, unknown> = {
      ...round.focus,
      adjacentScope: [],
    };
    delete focus.adjacentScopeUnbounded;
    return {
      ...round,
      focus,
      inspection: { fromSha: first, diffDigest: round.inspection!.diffDigest },
    };
  });
  deliverAtBase(prepared, fixed);
  assertNamed(
    rejected(prepared),
    "review再利用条件が成立しません",
    `[依存先未検分] path=${shape === "source" ? "src/limit-gate.ts" : "なし"} transition=${first}..${fixed}`,
    "全体検分round",
  );
}

/**
 * SCN-REVIEW-REUSE-003（R1544-3-01）: 前head（round 2）の直後のevidence-only commitへ、実装が読む
 * fileとして正準形の証跡を置く。`foreign-path`は対象Issue自身の証跡pathでない
 * `docs/reviews/9_review.json`へ前headとreview sessionの該当roundを正しく束縛した証跡、
 * `other-round`は対象Issueの証跡pathへ前headを束縛するがround digestが前headのroundでない
 * （round 1の）証跡、`other-session`は同じくsession IDだけが異なる証跡である。前headの記録として
 * 外せるのは、対象Issue（staging tracker #877）の証跡pathで、sessionの前headのroundと照合できる
 * ものだけなので、そのfileを読む実装の変化を導出し全体検分を割り当てる。割当を外したroundは
 * `pr merge`が拒否する。
 */
function forgedPreviousHeadRecord(
  world: WorkflowStepWorld,
  shape: "foreign-path" | "other-round" | "other-session",
): void {
  const recordPath =
    shape === "foreign-path" ? "docs/reviews/9_review.json" : EVIDENCE;
  const prepared = prepare(world, [
    {
      ...(shape === "foreign-path" ? { [recordPath]: '{ "limit": 1 }\n' } : {}),
      "src/limit-gate.ts": dynamicEvidenceReader(
        shape === "foreign-path" ? 9 : 877,
      ),
      "src/other.ts": "export const other = (): number => 1;\n",
      "test/steps/app.steps.ts":
        'import { defineStep } from "@cucumber/cucumber";\nimport "../../src/limit-gate.js";\nimport "../../src/other.js";\n\ndefineStep("アプリを起動する", () => undefined);\n',
      "test/features/app.feature":
        "Feature: アプリ\n  Scenario: SCN-FX-1544 起動する\n    Given アプリを起動する\n",
    },
  ]);
  const roundTwo = fixOnTopOfEvidence(prepared, {
    "src/other.ts": "export const other = (): number => 2;\n",
  });
  recordDraft(prepared, roundTwo);
  const session = readStoredReviewSession(prepared.staging);
  assert.ok(session);
  const exported = reviewEvidenceContentFromStaging(prepared.staging, {
    issue: shape === "foreign-path" ? 9 : 877,
    baseSha: prepared.baseSha,
    implementationHeadSha: roundTwo,
  });
  const bound = parseReviewEvidence(exported);
  // 前提の自己確認: 改変前の証跡は正準形で、前headとsessionの該当roundを束縛する。
  assert.equal(bound.observed.implementationHeadSha, roundTwo);
  assert.equal(bound.observed.session.sessionId, session.sessionId);
  assert.equal(
    bound.observed.session.latestRoundDigest,
    session.rounds.find(({ candidateHeadSha }) => candidateHeadSha === roundTwo)
      ?.roundDigest,
  );
  const forged =
    shape === "foreign-path"
      ? exported
      : resealObservedEvidence(bound, {
          session: {
            ...bound.observed.session,
            ...(shape === "other-round"
              ? { latestRoundDigest: session.rounds[0]!.roundDigest }
              : { sessionId: flipLast(session.sessionId) }),
          },
        });
  assert.equal(
    parseReviewEvidence(forged).observed.implementationHeadSha,
    roundTwo,
  );
  commit(prepared, { [recordPath]: forged }, "review evidence");
  const fixed = commit(
    prepared,
    { "src/other.ts": "export const other = (): number => 3;\n" },
    "fix: round 2 finding",
  );
  const built = draft(prepared, fixed).round;
  assert.deepEqual(built.focus.fixedDiff, [recordPath, "src/other.ts"].sort());
  assert.equal(built.focus.adjacentScopeUnbounded, true);
  assert.deepEqual(built.inspection, {
    fromSha: roundTwo,
    diffDigest: observeReviewDiff(prepared.root, roundTwo, fixed).digest,
    cumulative: {
      baseSha: prepared.baseSha,
      scope: "all",
      diffDigest: observeReviewDiff(prepared.root, prepared.baseSha, fixed)
        .digest,
    },
  });
  recordReviewRound({ staging: prepared.staging, round: built });
  // 偽造した記録を外した導出（是正前の規則）の割当へ書き換える。
  rewriteRound(prepared, 3, (round) => {
    const focus: Record<string, unknown> = {
      ...round.focus,
      adjacentScope: [],
    };
    delete focus.adjacentScopeUnbounded;
    return {
      ...round,
      focus,
      inspection: {
        fromSha: roundTwo,
        diffDigest: round.inspection!.diffDigest,
      },
    };
  });
  deliverAtBase(prepared, fixed);
  assertNamed(
    rejected(prepared),
    "review再利用条件が成立しません",
    `[依存先未検分] path=なし transition=${roundTwo}..${fixed}`,
    "全体検分round",
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

/**
 * 既定branchだけが足場とnoteを追加し、PRはstep定義から字面で参照される`src/lib.ts`を足す。
 * `whole`は追随後のlocal tipで雛形を作り、actualAuditBaseからの全体検分roundを記録する。
 * そうでなければ追随前のlocal tipで記録し、追随前の基点からの割当だけを持つroundにする。
 */
function disjointFollowFixture(world: WorkflowStepWorld, whole: boolean) {
  const prepared = prepare(world, [
    { "src/lib.ts": "export const lib = (): number => 1;\n" },
  ]);
  const advanced = advanceMain(prepared, prepared.baseSha, {
    ...scaffold("src/lib.ts", "literal"),
    "docs/upstream-note.md": "default branch advance\n",
  });
  const followed = mergeMain(prepared, advanced);
  recordFollow(prepared, { advanced, followed, whole });
  return { prepared, advanced, followed };
}

/**
 * 追随mergeのroundを雛形どおりに記録する（AMD-001）。雛形は`followOnly`を立てず、比較基点が
 * 動いていれば`actualAuditBase`からの全体検分を割り当て、`--base`を案内する。
 */
function recordFollow(
  prepared: PreparedDeliveryCli,
  input: { advanced: string; followed: string; whole: boolean },
): void {
  const previous = readStoredReviewSession(prepared.staging);
  assert.ok(previous);
  const fromSha = previous.latestCandidateHeadSha;
  const built = input.whole
    ? draft(prepared, input.followed)
    : withLocalTip(prepared, prepared.baseSha, () =>
        draft(prepared, input.followed),
      );
  assert.equal(built.round.followOnly, undefined);
  const transition = {
    fromSha,
    diffDigest: observeReviewDiff(prepared.root, fromSha, input.followed)
      .digest,
  };
  if (input.whole) {
    assert.deepEqual(built.round.inspection, {
      ...transition,
      cumulative: {
        baseSha: input.advanced,
        scope: "all",
        diffDigest: observeReviewDiff(
          prepared.root,
          input.advanced,
          input.followed,
        ).digest,
      },
    });
    assert.ok(
      built.notes.some((note) => note.includes(`--base=${input.advanced}`)),
      built.notes.join("\n"),
    );
    recordReviewRound({ staging: prepared.staging, round: built.round });
  } else {
    // 追随前の基点からの割当（影響集合fullなら旧基点からの全体検分）は基点の移動を被覆しない。
    assert.equal(built.round.inspection?.fromSha, transition.fromSha);
    assert.equal(built.round.inspection?.diffDigest, transition.diffDigest);
    assert.notEqual(
      built.round.inspection?.cumulative?.baseSha,
      input.advanced,
    );
    withLocalTip(prepared, prepared.baseSha, () =>
      recordReviewRound({ staging: prepared.staging, round: built.round }),
    );
  }
}

/** SCN-REVIEW-REUSE-006: 追随後の証跡・検証を`--base`無し（旧基点）で取った。 */
function staleEvidenceBase(world: WorkflowStepWorld): void {
  const { prepared, advanced, followed } = disjointFollowFixture(world, true);
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

/**
 * SCN-REVIEW-REUSE-007（AMD-001）: PRの変更と交差しない既定branch追随でも、比較基点が動けば
 * 同じsessionの全体検分roundが要る。無ければ`基点不一致`で拒否し、あればmergeできる。
 */
function disjointFollow(world: WorkflowStepWorld, whole: boolean): void {
  const { prepared, advanced, followed } = disjointFollowFixture(world, whole);
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: followed,
    tip: advanced,
  });
  if (whole) return merged(prepared);
  assertNamed(
    rejected(prepared),
    `実際のmerge-base(${advanced})がreview sessionの比較基点(${prepared.baseSha})と一致しません`,
    "[基点不一致] path=docs/upstream-note.md,",
    `transition=${prepared.implementationCommitSha}..${followed}`,
    "actualAuditBaseからの全体検分round",
  );
}

/**
 * SCN-REVIEW-REUSE-009（AMD-001）: 既定branch側の変更がPRの依存先と交差する追随も、追随の
 * 交差を個別に判定せず、全体検分roundが無ければ`基点不一致`で拒否し、あればmergeできる。
 */
function intersectingFollow(world: WorkflowStepWorld, whole: boolean): void {
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
  recordFollow(prepared, { advanced, followed, whole });
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: followed,
    tip: advanced,
  });
  if (whole) return merged(prepared);
  assertNamed(
    rejected(prepared),
    "[基点不一致] path=src/a.ts,",
    `transition=${prepared.implementationCommitSha}..${followed}`,
  );
}

/**
 * SCN-REVIEW-REUSE-009（R1544-2-01・R1544-N1-01、AMD-001）: 証跡commit（`H_final`）、または前headの
 * 後に証跡allowlist配下のfileだけを変えたcommitの上へ既定branchを追随する。`reader`はPRが証跡形の
 * `docs/reviews/9_review.json`を実装として足しfile名を組み立てて読む形、`preexisting`はPRが
 * 証跡pathそのものを実装内容として持ち、証跡commitがそれを書き換えた形、`rewritten`は証跡commitの
 * 後に証跡fileを前headの記録でない内容へ書き換えた形、`helper`は実装`src/limit-gate.ts`がimportする
 * `docs/reviews/helper.ts`のLIMITを1から100へ変えたcommitを第1親にした形（R1544-N1-01の反例）。
 * 雛形は`followOnly`を立てずactualAuditBaseからの全体検分（suffixの変更を含む）を割り当てる。
 * 第1親が前headでないmergeは`followOnly`として記録できず（C4、0a6d111eの受理条件）、保存済み
 * sessionへ`followOnly`として書き込んでも`pr merge`が拒否する。
 */
function followOverEvidence(
  world: WorkflowStepWorld,
  shape: "reader" | "preexisting" | "rewritten" | "helper",
): void {
  const prepared = prepare(world, [
    shape === "reader"
      ? {
          ...evidenceReaders("dynamic-read"),
          "docs/reviews/9_review.json": '{ "limit": 1 }\n',
        }
      : shape === "helper"
        ? {
            "docs/reviews/helper.ts": "export const LIMIT = 1;\n",
            ...evidenceReaders("source"),
            ...scaffold("src/limit-gate.ts", "import"),
          }
        : {
            ...evidenceReaders("evidence-rewrite"),
            ...(shape === "preexisting"
              ? { [EVIDENCE]: '{ "limit": 1 }\n' }
              : {}),
          },
  ]);
  if (shape === "rewritten")
    commit(prepared, { [EVIDENCE]: '{ "limit": 100 }\n' }, "rewrite evidence");
  if (shape === "helper")
    commit(
      prepared,
      { "docs/reviews/helper.ts": "export const LIMIT = 100;\n" },
      "evidence-shaped suffix",
    );
  const finalHead = fixtureGit(prepared.root, ["rev-parse", "HEAD"]);
  // 前提の自己確認: PRのheadは証跡commitで、証跡pathを含む。
  assert.notEqual(finalHead, prepared.implementationCommitSha);
  const advanced = advanceMain(prepared, prepared.baseSha, {
    ...(shape === "helper" ? {} : scaffold("src/limit-gate.ts", "literal")),
    "docs/upstream-note.md": "default branch advance\n",
  });
  const followed = mergeMain(prepared, advanced);
  const audited = observeReviewDiff(prepared.root, advanced, followed);
  assert.ok(audited.changedPaths.includes(EVIDENCE));
  if (shape === "helper")
    assert.ok(audited.changedPaths.includes("docs/reviews/helper.ts"));
  const built = draft(prepared, followed).round;
  assert.equal(built.followOnly, undefined);
  assert.deepEqual(built.inspection?.cumulative, {
    baseSha: advanced,
    scope: "all",
    diffDigest: audited.digest,
  });
  const followOnly = (round: ReviewRoundInput) =>
    parseReviewRoundInput({
      ...withoutInspection(round),
      findings: [],
      followOnly: true,
    });
  assert.throws(
    () =>
      recordReviewRound({
        staging: prepared.staging,
        round: followOnly(built),
      }),
    /既定branch追随として記録できるのは/u,
  );
  recordReviewRound({ staging: prepared.staging, round: built });
  deliver(prepared, {
    evidenceBase: advanced,
    implementation: followed,
    tip: advanced,
  });
  // 保存済みsessionの追随roundを、記録時検査を経ずに`followOnly`へ書き換える。
  rewriteRound(prepared, 2, followOnly);
  assertNamed(
    rejected(prepared),
    "保存済みreview sessionのfollow-only round 2を実Gitで再検証できません",
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
  retainEvidence = false,
): void {
  const prepared = prepare(world, [
    {
      "src/merge-gate.ts": "export const gate = (): boolean => true;\n",
      ...scaffold("src/merge-gate.ts", "import"),
    },
  ]);
  const fix = {
    "src/merge-gate.ts": "export const gate = (): boolean => false;\n",
  };
  const fixed = retainEvidence
    ? fixRetainingEvidence(prepared, fix)
    : fixOnTopOfEvidence(prepared, fix);
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
        focusedRoundTwo(this, false);
        focusedRoundTwo(this, true);
        break;
      case "SCN-REVIEW-REUSE-002":
        revertedDefaultBranchHunk(this, false);
        revertedDefaultBranchHunk(this, true);
        break;
      case "SCN-REVIEW-REUSE-003":
        unreviewedAdjacent(this);
        evidencePrefixedImplementation(this, "source");
        evidencePrefixedImplementation(this, "evidence-name");
        evidencePrefixedImplementation(this, "other-json");
        evidencePrefixedImplementation(this, "graph-unavailable");
        evidencePrefixedImplementation(this, "lib-import");
        evidencePrefixedImplementation(this, "script-read");
        evidencePrefixedImplementation(this, "oversized-reader");
        evidencePrefixedImplementation(this, "dynamic-read");
        evidencePrefixedImplementation(this, "evidence-rewrite");
        evidencePrefixedImplementation(this, "foreign-record");
        evidencePrefixedImplementation(this, "forged-digest");
        forgedPreviousHeadRecord(this, "foreign-path");
        forgedPreviousHeadRecord(this, "other-round");
        forgedPreviousHeadRecord(this, "other-session");
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
        disjointFollow(this, false);
        disjointFollow(this, true);
        break;
      case "SCN-REVIEW-REUSE-009":
        intersectingFollow(this, false);
        intersectingFollow(this, true);
        followOverEvidence(this, "reader");
        followOverEvidence(this, "preexisting");
        followOverEvidence(this, "rewritten");
        followOverEvidence(this, "helper");
        followAfterImplementation(this);
        break;
      case "SCN-REVIEW-REUSE-010":
        singleRoundFastPath(this);
        break;
      case "SCN-REVIEW-REUSE-011":
        securityPathCumulative(this, false);
        securityPathCumulative(this, true);
        securityPathCumulative(this, false, true);
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
