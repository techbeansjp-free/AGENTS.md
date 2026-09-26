import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseReviewRoundInput,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import { parseReviewEvidence } from "../../src/domain/review-evidence.js";
import {
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import {
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../../src/domain/workflow.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ReviewEvidenceCliWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  implementationHead: string;
  session: ReviewSessionState;
  exported?: CliResult;
  failures: CliResult[];
  validations: Record<string, CliResult>;
  rebasedBase?: string;
  rebasedHead?: string;
}

interface CliResult {
  output?: Record<string, unknown>;
  error?: Error;
  exitCode?: number;
}

const { Given, When, Then } = stepDefinitions<ReviewEvidenceCliWorld>();
const instant = new Date("2026-09-26T00:00:00.000Z");
const reviewedPath = "src/reviewed.ts";
const ISSUE = 1500;
const EVIDENCE = `docs/reviews/${ISSUE}_review.json`;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commitFile(root: string, relative: string, source: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  git(root, ["add", relative]);
  git(root, ["commit", "-q", "-m", `change ${relative}`]);
  return git(root, ["rev-parse", "HEAD"]);
}

function entry(step: number, implementationHeadSha: string): StepJournalEntry {
  const definition = WORKFLOW_STEPS.find((item) => item.step === step);
  if (!definition) throw new Error(`step ${step}がありません`);
  return {
    step,
    skillId: definition.skillId,
    mode: "quick",
    recordedAt: instant.toISOString(),
    artifacts: [`artifact-${step}`],
    evidence: `step ${step}の固定証拠`,
    ...(step === 9 ? { implementationHeadSha } : {}),
  };
}

async function captureCli(args: string[]): Promise<CliResult> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    const exitCode = await main(args);
    return {
      output: JSON.parse(stdout) as Record<string, unknown>,
      exitCode,
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function prepare(world: ReviewEvidenceCliWorld, blocking: boolean): void {
  world.root = world.initRepo();
  world.base = git(world.root, ["rev-parse", "HEAD"]);
  world.implementationHead = commitFile(
    world.root,
    reviewedPath,
    "export const reviewed = 1;\n",
  );
  world.staging = createIssueStaging(world.root, {
    title: "review-evidence",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: `${id}の固定証拠` } satisfies ModeAnswer,
      ]),
    ),
    now: instant,
    requestedMode: "quick",
  }).path;
  for (const step of [1, 4, 9])
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: entry(step, world.implementationHead),
    });
  world.session = recordReviewRound({
    staging: world.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-001"],
        acceptanceCriteriaIds: ["AC-001"],
        invariantIds: [],
        diffBaseSha: world.base,
        initialHeadSha: world.implementationHead,
        initialDiffDigest: observeReviewDiff(
          world.root,
          world.base,
          world.implementationHead,
        ).digest,
      },
      candidateHeadSha: world.implementationHead,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: blocking
        ? [
            {
              id: "F-001",
              severity: "High",
              status: "valid",
              source: "review",
              relation: "acceptance-violation",
              evidence: "AC-001を満たさない",
              path: reviewedPath,
              contractId: "AC-001",
              causedByFindingId: null,
            },
          ]
        : [
            {
              id: "F-001",
              severity: "Low",
              status: "valid",
              source: "review",
              relation: "improvement",
              evidence: "命名の改善提案",
              path: reviewedPath,
              contractId: null,
              causedByFindingId: null,
            },
          ],
    }),
  });
  world.failures = [];
  world.validations = {};
}

function exportArgs(
  world: ReviewEvidenceCliWorld,
  overrides: Record<string, string | undefined> = {},
): string[] {
  const values: Record<string, string | undefined> = {
    staging: world.staging,
    issue: String(ISSUE),
    reviewer: "reviewer-context",
    implementer: "implementer-context",
    root: world.root,
    ...overrides,
  };
  return [
    "review",
    "export",
    ...Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `--${key}=${value}`),
    ...(overrides.noVerified === "true"
      ? []
      : ["--verified=npm test", "--verified=npm run lint"]),
  ].filter((argument) => !argument.startsWith("--noVerified"));
}

Given("review証跡用に収束済みsessionを持つrepositoryがある", function () {
  prepare(this, false);
  assert.equal(this.session.status, "converged");
});

Given(
  "review証跡用に未解決blockerを持つsessionのrepositoryがある",
  function () {
    prepare(this, true);
    assert.equal(this.session.status, "active");
  },
);

When("H_implでreview exportを実行する", async function () {
  this.exported = await captureCli(exportArgs(this));
});

Then(
  "docs\\/reviewsへIssue番号の証跡が生成されsessionとGitに照合できる",
  async function () {
    assert.equal(this.exported?.error, undefined, String(this.exported?.error));
    assert.equal(this.exported?.output?.path, EVIDENCE);
    const file = path.join(this.root, EVIDENCE);
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
    const evidence = parseReviewEvidence(fs.readFileSync(file, "utf8"));
    assert.equal(evidence.issue, ISSUE);
    assert.equal(evidence.baseSha, this.base);
    assert.equal(evidence.implementationHeadSha, this.implementationHead);
    assert.equal(evidence.session.sessionId, this.session.sessionId);
    assert.equal(evidence.independence.mode, "context-isolated");
    assert.deepEqual(
      evidence.verification.map(({ command }) => command),
      ["npm test", "npm run lint"],
    );
    const validation = await captureCli([
      "review",
      "validate",
      `--artifact=${EVIDENCE}`,
      `--staging=${this.staging}`,
      `--root=${this.root}`,
    ]);
    assert.equal(validation.error, undefined, String(validation.error));
    assert.equal(validation.output?.valid, true);
    assert.equal(validation.output?.kind, "review-evidence");
    assert.equal(validation.output?.sessionChecked, true);
    assert.equal(validation.exitCode, 0);
  },
);

When("不正な条件でreview exportを実行する", async function () {
  this.failures.push(
    await captureCli(exportArgs(this, { implementer: "reviewer-context" })),
  );
  this.failures.push(
    await captureCli(exportArgs(this, { noVerified: "true" })),
  );
  this.failures.push(
    await captureCli(exportArgs(this, { out: "docs/other/1500_review.json" })),
  );
  this.failures.push(
    await captureCli(
      exportArgs(this, { out: "docs/reviews/1501_review.json" }),
    ),
  );
  /** 祖先`docs`がsymlinkでも、拒否より前にsymlink先へdirectoryを作らない */
  assert.equal(fs.existsSync(path.join(this.root, "docs")), false);
  fs.mkdirSync(path.join(this.root, "outside-docs"), { recursive: true });
  fs.symlinkSync(
    path.join(this.root, "outside-docs"),
    path.join(this.root, "docs"),
  );
  this.failures.push(await captureCli(exportArgs(this)));
  fs.unlinkSync(path.join(this.root, "docs"));
  fs.mkdirSync(path.join(this.root, "outside"), { recursive: true });
  fs.mkdirSync(path.join(this.root, "docs"), { recursive: true });
  fs.symlinkSync(
    path.join(this.root, "outside"),
    path.join(this.root, "docs", "reviews"),
  );
  this.failures.push(await captureCli(exportArgs(this)));
  fs.unlinkSync(path.join(this.root, "docs", "reviews"));
  commitFile(this.root, "docs/reviews/1500_review.json", "{}\n");
  this.failures.push(await captureCli(exportArgs(this)));
});

Then("各条件を理由つきで拒否し証跡を書かない", function () {
  const expected = [
    /reviewerと--implementerは異なるidentity/u,
    /--verified=/u,
    /docs\/reviews\/または\.agent-skill-chain\/reviews\/配下/u,
    /1500_review\.json/u,
    /symlinkを含まない親directory/u,
    /symlinkを含まない親directory/u,
    /review済みcandidate HEAD.*H_final/u,
  ];
  assert.equal(this.failures.length, expected.length);
  for (const [index, pattern] of expected.entries()) {
    assert.ok(this.failures[index]?.error instanceof Error, `case ${index}`);
    assert.match(this.failures[index]!.error!.message, pattern);
  }
  assert.equal(
    fs.readFileSync(path.join(this.root, EVIDENCE), "utf8"),
    "{}\n",
    "既存の証跡pathを拒否時に書き換えない",
  );
  assert.equal(
    fs.readdirSync(path.join(this.root, "outside")).length,
    0,
    "symlink先へ書かない",
  );
  assert.deepEqual(
    fs.readdirSync(path.join(this.root, "outside-docs")),
    [],
    "symlink祖先の先へdirectoryを作らない",
  );
});

Then("review exportは未収束として拒否する", function () {
  assert.ok(this.exported?.error instanceof Error);
  assert.match(this.exported!.error!.message, /status=active/u);
  assert.equal(fs.existsSync(path.join(this.root, EVIDENCE)), false);
});

When(
  "改竄した証跡と安全でないpathにreview validateを実行する",
  async function () {
    const file = path.join(this.root, EVIDENCE);
    const canonical = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      path.join(this.root, "docs", "reviews", "tampered.json"),
      canonical.replace('"npm run lint"', '"npm run typecheck"'),
    );
    fs.symlinkSync(file, path.join(this.root, "docs", "reviews", "link.json"));
    fs.writeFileSync(path.join(this.root, "review.json"), '{"round":1}\n');
    const validate = (args: string[]) =>
      captureCli(["review", "validate", ...args]);
    this.validations = {
      tampered: await validate([
        "--artifact=docs/reviews/tampered.json",
        `--root=${this.root}`,
      ]),
      escape: await validate([
        "--artifact=../outside.json",
        `--root=${this.root}`,
      ]),
      symlink: await validate([
        "--artifact=docs/reviews/link.json",
        `--root=${this.root}`,
      ]),
      stagingWithoutArtifact: await validate([
        `--staging=${this.staging}`,
        path.join(this.root, "review.json"),
      ]),
      json: await validate([path.join(this.root, "review.json")]),
    };
    const other = git(this.root, ["rev-parse", "HEAD"]);
    commitFile(this.root, "src/other.ts", "export const other = 1;\n");
    void other;
    this.validations.movedHead = await validate([
      `--artifact=${EVIDENCE}`,
      `--root=${this.root}`,
    ]);
  },
);

Then("改竄と安全でないpathを拒否しreview入力JSONは従来結果を返す", function () {
  const { tampered, escape, symlink, stagingWithoutArtifact, json } =
    this.validations;
  assert.equal(tampered?.output?.valid, false);
  assert.equal(tampered?.exitCode, 1);
  assert.match(
    String((tampered?.output?.errors as string[])[0]),
    /evidenceDigest/u,
  );
  assert.match(String(escape?.error?.message), /パストラバーサル/u);
  assert.match(String(symlink?.error?.message), /通常file/u);
  assert.match(
    String(stagingWithoutArtifact?.error?.message),
    /--stagingは--artifactと併用/u,
  );
  assert.equal(json?.output?.approved, false);
  assert.equal(json?.output?.kind, undefined);
  assert.equal(this.validations.movedHead?.output?.valid, true);
});

When(
  "既定branchを進めて実装を内容等価にrebaseしreview exportを実行する",
  async function () {
    git(this.root, ["checkout", "-q", "-b", "rebased", this.base]);
    this.rebasedBase = commitFile(this.root, "docs/other.md", "# other\n");
    git(this.root, ["cherry-pick", this.implementationHead]);
    this.rebasedHead = git(this.root, ["rev-parse", "HEAD"]);
    this.failures.push(await captureCli(exportArgs(this)));
    this.exported = await captureCli(
      exportArgs(this, { base: this.rebasedBase }),
    );
  },
);

Then(
  "rebase後の比較基点とH_implを持つ証跡が生成されsessionに照合できる",
  async function () {
    assert.match(
      String(this.failures[0]?.error?.message),
      /内容等価ではありません/u,
      "比較基点を指定しないrebase後の生成は拒否する",
    );
    assert.equal(this.exported?.error, undefined, String(this.exported?.error));
    const evidence = parseReviewEvidence(
      fs.readFileSync(path.join(this.root, EVIDENCE), "utf8"),
    );
    assert.equal(evidence.baseSha, this.rebasedBase);
    assert.equal(evidence.implementationHeadSha, this.rebasedHead);
    const validation = await captureCli([
      "review",
      "validate",
      `--artifact=${EVIDENCE}`,
      `--staging=${this.staging}`,
      `--root=${this.root}`,
    ]);
    assert.equal(validation.output?.valid, true, JSON.stringify(validation));
  },
);
