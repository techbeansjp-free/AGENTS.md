import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertWorkflowStaging } from "../../src/adapters/workflow-journal.js";
import {
  buildIssueSyncBody,
  createIssueStaging,
} from "../../src/domain/issue.js";
import { doctor } from "../../src/domain/lifecycle.js";
import type { ModeAnswer } from "../../src/domain/mode.js";
import {
  readStoredStagingRecord,
  refreshStoredStagingDigest,
} from "../../src/domain/staging.js";
import {
  assertIssueStagingLocation,
  isLegacyStagingLayout,
  LEGACY_STAGING_LAYOUT_NOTICE,
  readStagingLayout,
  resolveStagingLayout,
  validateStagingPolicy,
  type StagingLayout,
  type StagingLocation,
} from "../../src/domain/staging-layout.js";
import { assessWorktreeRemovalSafety } from "../../src/domain/worktree-removal-safety.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * **版管理下staging＋pointer本文の契約**（REQ-WF-037）。
 *
 * pointer本文は成果物の配置とdigestしか持たないため、参照先のstagingが版管理下で
 * なければmerge後に計画文書の永続的な複製が1つも残らない。
 */
interface TrackedPointerWorld extends WorkflowWorld {
  root: string;
  pointerCases: Record<string, string[]>;
  layoutError: string;
  layouts: Record<string, StagingLayout>;
  legacy: Record<string, boolean>;
  activeStaging: string;
  archivedStaging: string;
  inspected: string[];
  recordAssessments: ReturnType<typeof assessWorktreeRemovalSafety>[];
  staging: string;
  request: string;
  createResult: CommandResult;
  legacyCreateResult: CommandResult;
  ghDirectory: string;
  ghEnv: NodeJS.ProcessEnv;
  syncResult: CommandResult;
  startResult: CommandResult;
  location: StagingLocation;
  syncBody: string;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const { Given, When, Then } = stepDefinitions<TrackedPointerWorld>();
const repositoryRoot = process.cwd();
const cliSource = path.resolve("dist", "bin", "agent-skill-chain.js");
const TRACKED_POINTER_ROOT = "docs/issues";
const TRACKED_POINTER_STAGING = {
  root: TRACKED_POINTER_ROOT,
  tracked: true,
  issueBody: "pointer",
};
const STAGING_NAME = "20260926_120000_tracked-pointer";
const REPOSITORY = "example/repository";
const ISSUE = 1437;
const INITIAL_BODY = "起票時の本文\n";
const TRACKED_RECORD_HINT = "版管理下stagingの機械記録です";
const TRACKED_RECORD_ARTIFACTS = [
  "docs/issues/20260926_x/staging-record.json",
  "docs/issues/20260926_x/journal/steps.jsonl",
  "docs/issues/20260926_x/review-session.json",
  "docs/issues/20260926_x/00_モード判定.json",
];
const TRACKED_UNRELATED_ARTIFACTS = [
  "docs/issues/20260926_x/00_要求定義.md",
  "journal/steps.jsonl",
  "staging-record.json",
  "coverage/lcov.info",
];
const LEGACY_ARTIFACT =
  ".agent-skill-chain/tmp/issues/20260926_x/staging-record.json";
const RECORD_OBSERVATION_BASE = {
  repositoryRoot: "/repo",
  worktreePath: "/repo/.worktrees/20260926_120000-1-x",
  worktreeRoot: "/repo/.worktrees",
  trackedChanges: false,
  untracked: [],
  ignoredPathAllowlist: ["node_modules/", "dist/"],
  stashes: [],
  pushed: true,
  remoteBranch: true,
  merged: true,
  recoveryReachable: true,
  reachableFromDefaultBranch: true,
  unpushedCommits: 0,
};

function answers(value: boolean): Record<string, ModeAnswer> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: value, evidence: "fixture evidence" },
    ]),
  );
}

function writeManifest(root: string, staging: unknown): void {
  // policy setの読み込みはproject inventory root（空でよい）を要求する
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "project"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, ".agent-skill-chain", "project-policy.json"),
    `${JSON.stringify(
      {
        schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
        policy: {
          schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
          delivery: { stopAt: "pull_request" },
          merge: {
            mode: "disabled",
            branches: [],
            methods: [],
            requiredChecks: [],
            requiredReviews: 1,
          },
          budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
          ...(staging === undefined ? {} : { staging }),
        },
        choiceFiles: [],
        ruleFiles: [],
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * **CLIが検証する完全なpolicy setを置く。** `issue create`はmanifestがあれば
 * policy set全体を読み込むため、本repositoryのpolicy setを複製し、`staging`節だけを
 * 差し替える。`undefined`なら`staging`節を持たないprojectになる。
 */
function writeCompletePolicySet(root: string, staging: unknown): void {
  const namespace = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(namespace, { recursive: true });
  fs.cpSync(
    path.join(repositoryRoot, ".agent-skill-chain", "project"),
    path.join(namespace, "project"),
    { recursive: true },
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, ".agent-skill-chain", "project-policy.json"),
      "utf8",
    ),
  ) as { policy: Record<string, unknown> };
  delete manifest.policy.staging;
  if (staging !== undefined) manifest.policy.staging = staging;
  fs.writeFileSync(
    path.join(namespace, "project-policy.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(process.execPath, [cliSource, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function describe(result: CommandResult): string {
  return `status=${String(result.status)}\n${result.stdout}\n${result.stderr}`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** 出荷templateのplaceholderを埋め、検証器が受理するfullの00を作る。 */
function materializedRequest(): string {
  const filled = fs
    .readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/00_要求定義_full.md",
      ),
      "utf8",
    )
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
  return `${filled}\n\nScenario: SCN-FIXTURE-TRACKPTR-001 記入済みIssueを同期する\n  Given 記入済みである\n  When 同期する\n  Then 合格する\n`;
}

function considerationDocument(title: string): string {
  const rows = ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI文書だけを変更するため対象外である | SCN-FIXTURE-TRACKPTR-001で確認済み |`,
    )
    .join("\n");
  return `# ${title}\n\n${rows}\n`;
}

/** fullの00〜03を検証可能な内容に置き換え、staging記録のdigestを更新する。 */
function materializeStaging(world: TrackedPointerWorld): void {
  const contents = [
    { name: "00_要求定義.md", text: materializedRequest() },
    { name: "01_要件定義.md", text: considerationDocument("01 要件定義") },
    { name: "02_設計.md", text: considerationDocument("02 設計") },
    { name: "03_実装計画.md", text: considerationDocument("03 実装計画") },
  ];
  for (const artifact of contents)
    fs.writeFileSync(path.join(world.staging, artifact.name), artifact.text);
  world.request = materializedRequest();
  refreshStoredStagingDigest(world.staging);
}

function ignored(root: string, relative: string): boolean {
  return (
    spawnSync("git", ["check-ignore", "-q", "--", relative], { cwd: root })
      .status === 0
  );
}

/**
 * **fake GitHub provider。** `gh issue edit --body-file`で受けた本文を保存し、
 * `gh issue view`でそのまま返す。repository観測はWRITE権限を返す。
 */
function installFakeGh(world: TrackedPointerWorld): void {
  world.ghDirectory = world.temp("asc-trackptr-gh-");
  const bodyFile = path.join(world.ghDirectory, "issue-body.md");
  fs.writeFileSync(bodyFile, INITIAL_BODY);
  const stub = path.join(world.ghDirectory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const bodyFile = ${JSON.stringify(bodyFile)};
if (args[0] === "auth") process.exit(0);
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ nameWithOwner: ${JSON.stringify(REPOSITORY)}, viewerPermission: "WRITE" }));
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ body: fs.readFileSync(bodyFile, "utf8") }) + "\\n");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "edit") {
  const source = args[args.indexOf("--body-file") + 1];
  fs.writeFileSync(bodyFile, fs.readFileSync(source, "utf8"));
  process.exit(0);
}
process.stderr.write("unexpected gh call: " + args.join(" "));
process.exit(1);
`,
  );
  fs.chmodSync(stub, 0o755);
  world.ghEnv = {
    ...process.env,
    PATH: `${world.ghDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function issueBody(world: TrackedPointerWorld): string {
  return fs.readFileSync(path.join(world.ghDirectory, "issue-body.md"), "utf8");
}

// ---- unit: 不変条件 ----

Given("pointer本文とtrackedの組み合わせの候補がある", function () {
  this.pointerCases = {};
});

When("runtimeで各組み合わせを検証する", function () {
  const candidates: Record<string, unknown> = {
    pointerOnly: { issueBody: "pointer" },
    pointerWithRoot: { root: TRACKED_POINTER_ROOT, issueBody: "pointer" },
    pointerUntracked: {
      root: TRACKED_POINTER_ROOT,
      tracked: false,
      issueBody: "pointer",
    },
    trackedPointer: TRACKED_POINTER_STAGING,
    untrackedFull: { root: TRACKED_POINTER_ROOT, issueBody: "full" },
    trackedFull: {
      root: TRACKED_POINTER_ROOT,
      tracked: true,
      issueBody: "full",
    },
  };
  for (const [key, value] of Object.entries(candidates)) {
    const errors: string[] = [];
    validateStagingPolicy(value, "staging", errors);
    this.pointerCases[key] = errors;
  }
});

Then("trackedが真でないpointerはtrackedを名指しして拒否される", function () {
  for (const key of ["pointerOnly", "pointerWithRoot", "pointerUntracked"]) {
    const errors = this.pointerCases[key] ?? [];
    assert.ok(
      errors.some((error) =>
        error.startsWith(
          "staging.issueBody=pointerにはstaging.tracked=true（版管理下のroot）が必要です",
        ),
      ),
      `${key}: ${errors.join("; ")}`,
    );
  }
});

Then("版管理下のpointerと版管理外のfullは受理される", function () {
  for (const key of ["trackedPointer", "untrackedFull", "trackedFull"])
    assert.deepEqual(this.pointerCases[key], [], key);
});

Then("2つのpolicy schemaはpointerにrootとtracked=trueを要求する", function () {
  interface StagingSchema {
    if?: {
      required?: string[];
      properties?: { issueBody?: { const?: string } };
    };
    then?: {
      required?: string[];
      properties?: { tracked?: { const?: boolean } };
    };
  }
  const read = (file: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, file), "utf8"));
  const assembled = read(
    ".agent-skill-chain/schemas/project-policy.schema.json",
  ) as { properties: { staging: StagingSchema } };
  const manifest = read(
    ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
  ) as {
    properties: { policy: { properties: { staging: StagingSchema } } };
  };
  for (const staging of [
    assembled.properties.staging,
    manifest.properties.policy.properties.staging,
  ]) {
    assert.deepEqual(staging.if?.required, ["issueBody"]);
    assert.equal(staging.if?.properties?.issueBody?.const, "pointer");
    assert.deepEqual([...(staging.then?.required ?? [])].sort(), [
      "root",
      "tracked",
    ]);
    assert.equal(staging.then?.properties?.tracked?.const, true);
  }
});

Given("版管理外のpointerを宣言したrepositoryがある", function () {
  this.root = this.initRepo();
  writeManifest(this.root, {
    root: TRACKED_POINTER_ROOT,
    issueBody: "pointer",
  });
});

When("staging配置契約の読み取りを試みる", function () {
  try {
    readStagingLayout(this.root);
    this.layoutError = "";
  } catch (error) {
    this.layoutError = (error as Error).message;
  }
});

Then("配置契約の読み取りはtrackedを名指しして拒否される", function () {
  assert.match(this.layoutError, /staging節が不正です/u);
  assert.match(
    this.layoutError,
    /staging\.issueBody=pointerにはstaging\.tracked=true/u,
  );
  assert.throws(
    () => resolveStagingLayout({ issueBody: "pointer" }),
    /tracked=true/u,
  );
});

Given(
  "既定配置と版管理下のpointer配置と版管理外の独自root配置がある",
  function () {
    this.layouts = {
      defaultLayout: resolveStagingLayout(undefined),
      trackedPointer: resolveStagingLayout(TRACKED_POINTER_STAGING),
      trackedFull: resolveStagingLayout({
        root: TRACKED_POINTER_ROOT,
        tracked: true,
      }),
      untrackedCustom: resolveStagingLayout({ root: "work/issues" }),
    };
  },
);

When("旧配置の通知対象かを判定する", function () {
  this.legacy = Object.fromEntries(
    Object.entries(this.layouts).map(([key, layout]) => [
      key,
      isLegacyStagingLayout(layout),
    ]),
  );
});

Then("版管理外かつ全文同期の配置だけが通知対象である", function () {
  assert.deepEqual(this.legacy, {
    defaultLayout: true,
    trackedPointer: false,
    trackedFull: false,
    untrackedCustom: true,
  });
});

Then("通知は版管理下のpointer配置のstaging節を示す", function () {
  const declared =
    '"staging": {"root": "docs/issues", "tracked": true, "issueBody": "pointer"}';
  assert.ok(LEGACY_STAGING_LAYOUT_NOTICE.includes(declared));
  assert.ok(!LEGACY_STAGING_LAYOUT_NOTICE.includes("\n"), "1行である");
  // 通知に書いた節は、そのまま受理される版管理下のpointer配置である
  const section = JSON.parse(`{${declared}}`) as { staging: unknown };
  const layout = resolveStagingLayout(section.staging);
  assert.equal(layout.tracked, true);
  assert.equal(layout.issueBody, "pointer");
});

// ---- unit: doctor ----

Given(
  "版管理下rootに作業中のstagingと文書だけのmerge済みstagingがある",
  function () {
    this.root = this.initRepo();
    writeManifest(this.root, TRACKED_POINTER_STAGING);
    this.activeStaging = createIssueStaging(this.root, {
      title: "作業中",
      answers: answers(true),
      requestedMode: "quick",
      now: new Date("2026-09-26T00:00:00.000Z"),
      name: "20260926_active",
    }).path;
    this.archivedStaging = path.join(
      this.root,
      ...TRACKED_POINTER_ROOT.split("/"),
      "20260901_archived",
    );
    fs.mkdirSync(this.archivedStaging, { recursive: true });
    fs.writeFileSync(
      path.join(this.archivedStaging, "00_要求定義.md"),
      "# merge済み\n",
    );
  },
);

When("doctorで作業中のstagingを走査する", function () {
  const result = doctor(this.root) as unknown as {
    workflow: { stagings: Array<{ staging: string }> };
  };
  this.inspected = result.workflow.stagings.map((entry) => entry.staging);
});

Then("作業中のstagingは検査対象に含まれる", function () {
  assert.ok(
    this.inspected.includes(this.activeStaging),
    this.inspected.join(", "),
  );
});

Then("文書だけのmerge済みstagingは検査対象に含まれない", function () {
  assert.ok(!this.inspected.includes(this.archivedStaging));
  assert.equal(this.inspected.length, 1);
});

// ---- unit: worktree削除の案内 ----

Given(
  "版管理下stagingの機械記録と文書と無関係な無視対象資産がある",
  function () {
    this.recordAssessments = [];
  },
);

When("機械記録を含む観測の削除安全性を判定する", function () {
  this.recordAssessments = [
    [
      ...TRACKED_RECORD_ARTIFACTS,
      ...TRACKED_UNRELATED_ARTIFACTS,
      LEGACY_ARTIFACT,
    ],
    [...TRACKED_UNRELATED_ARTIFACTS, LEGACY_ARTIFACT],
  ].map((ignoredArtifacts) =>
    assessWorktreeRemovalSafety({
      ...RECORD_OBSERVATION_BASE,
      ignoredArtifacts,
    }),
  );
});

Then("機械記録の理由にだけ版管理下stagingの案内が含まれる", function () {
  const [withRecords] = this.recordAssessments;
  const hinted = (withRecords?.reasons ?? []).filter((reason) =>
    reason.includes(TRACKED_RECORD_HINT),
  );
  assert.equal(hinted.length, TRACKED_RECORD_ARTIFACTS.length);
  for (const artifact of TRACKED_RECORD_ARTIFACTS)
    assert.ok(
      hinted.some((reason) =>
        reason.startsWith(`allowlist外の無視対象資産です: ${artifact}。`),
      ),
      artifact,
    );
  for (const artifact of TRACKED_UNRELATED_ARTIFACTS)
    assert.ok(
      withRecords?.reasons.includes(
        `allowlist外の無視対象資産です: ${artifact}`,
      ),
      `案内なし: ${artifact}`,
    );
});

Then("既定rootの資産には従来のissue stagingの案内が付く", function () {
  const [withRecords] = this.recordAssessments;
  const legacy = (withRecords?.reasons ?? []).filter((reason) =>
    reason.includes(LEGACY_ARTIFACT),
  );
  assert.equal(legacy.length, 1);
  assert.ok(legacy[0]?.includes("issue staging --root=<worktree>"));
  assert.ok(!legacy[0]?.includes(TRACKED_RECORD_HINT));
});

Then("案内の有無は安全判定と資産分類を変えない", function () {
  const [withRecords, withoutRecords] = this.recordAssessments;
  assert.equal(withRecords?.safe, false);
  assert.equal(withoutRecords?.safe, false);
  assert.deepEqual(withRecords?.allowedIgnoredArtifacts, []);
  assert.deepEqual(withRecords?.blockingIgnoredArtifacts, [
    ...TRACKED_RECORD_ARTIFACTS,
    ...TRACKED_UNRELATED_ARTIFACTS,
    LEGACY_ARTIFACT,
  ]);
  // 機械記録を除いた残りの理由は、案内の有無によらず一致する
  const withoutHint = (reasons: readonly string[]) =>
    reasons.filter(
      (reason) =>
        !TRACKED_RECORD_ARTIFACTS.some((artifact) => reason.includes(artifact)),
    );
  assert.deepEqual(
    withoutHint(withRecords?.reasons ?? []),
    withoutRecords?.reasons,
  );
});

// ---- integration: issue createからpointer本文の同期まで ----

Given(
  "版管理下のdocs issuesへpointer本文で同期するproject policyを持つrepositoryがある",
  function () {
    this.root = this.initRepo();
    writeCompletePolicySet(this.root, TRACKED_POINTER_STAGING);
    execFileSync("git", ["add", "-A"], { cwd: this.root });
    execFileSync("git", ["commit", "-q", "-m", "policy"], { cwd: this.root });
    installFakeGh(this);
  },
);

When("CLIでfullのissue createを実行する", function () {
  const input = this.temp("asc-trackptr-input-");
  const assessment = path.join(input, "assessment.json");
  fs.writeFileSync(assessment, JSON.stringify(answers(false)));
  this.createResult = runCli([
    "issue",
    "create",
    `--root=${this.root}`,
    "--title=版管理下pointerの検証",
    "--mode=full",
    `--assessment=${assessment}`,
    `--name=${STAGING_NAME}`,
  ]);
  assert.equal(this.createResult.status, 0, describe(this.createResult));
  this.staging = path.join(
    this.root,
    ...TRACKED_POINTER_ROOT.split("/"),
    STAGING_NAME,
  );
});

Then("stagingはdocs issues直下に作られ旧配置の通知を出さない", function () {
  assert.ok(fs.existsSync(path.join(this.staging, "00_要求定義.md")));
  assert.ok(
    !fs.existsSync(path.join(this.root, ".agent-skill-chain", "tmp")),
    "既定の一時領域は使わない",
  );
  assert.ok(!this.createResult.stderr.includes("通知:"));
});

Then("stagingの文書は版管理対象で機械記録は除外される", function () {
  const relative = `${TRACKED_POINTER_ROOT}/${STAGING_NAME}`;
  for (const name of [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
    ".gitignore",
  ])
    assert.equal(ignored(this.root, `${relative}/${name}`), false, name);
  for (const name of [
    "staging-record.json",
    "00_モード判定.json",
    "journal/steps.jsonl",
  ])
    assert.equal(ignored(this.root, `${relative}/${name}`), true, name);
  assert.ok(fs.existsSync(path.join(this.staging, "staging-record.json")));
});

When("成果物を記入してStep 8の同期本文を生成しIssueへ同期する", function () {
  materializeStaging(this);
  const common = [
    "issue",
    "sync",
    `--repo=${REPOSITORY}`,
    `--issue=${ISSUE}`,
    "--generate-body",
    `--staging-path=${this.staging}`,
    "--checkpoint=8",
  ];
  const preview = runCli([...common, "--dry-run"], this.ghEnv);
  assert.equal(preview.status, 0, describe(preview));
  const observed = JSON.parse(preview.stdout) as {
    bodySha256: string;
    currentBodySha256: string;
  };
  assert.equal(observed.currentBodySha256, sha256(INITIAL_BODY));
  this.syncResult = runCli(
    [
      ...common,
      "--synced-at=2026-09-26T00:00:00.000Z",
      `--expected-body-sha256=${observed.bodySha256}`,
      `--expected-current-body-sha256=${observed.currentBodySha256}`,
      "--apply",
      "--authorize=approved",
    ],
    this.ghEnv,
  );
});

Then("Issue本文は成果物の配置とdigestを示すpointer形である", function () {
  assert.equal(this.syncResult.status, 0, describe(this.syncResult));
  const body = issueBody(this);
  const relative = `${TRACKED_POINTER_ROOT}/${STAGING_NAME}`;
  for (const name of [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]) {
    assert.ok(body.includes(`\`${relative}/${name}\``), name);
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(this.staging, name)))
      .digest("hex");
    assert.ok(body.includes(`\`${digest}\``), `${name}のdigest`);
  }
  assert.match(body, /^## 1\. 目的と背景/mu);
  assert.match(body, /^## 7\. 受け入れ条件と成功基準/mu);
  assert.doesNotMatch(body, /^## 2\. 対象範囲/mu);
  assert.ok(!body.includes("<details>"), "全文の折り畳みを含まない");
  assert.ok(body.length < this.request.length / 2, "全文より十分短い");
});

Then("staging記録は同期確認済みになる", function () {
  const record = readStoredStagingRecord(this.staging);
  assert.equal(record.state, "sync-verified");
  assert.equal(
    record.tracker,
    `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
  );
});

When("issue startで版管理下のstagingを指定する", function () {
  this.startResult = runCli(
    [
      "issue",
      "start",
      `--root=${this.root}`,
      `--repo=${REPOSITORY}`,
      `--issue=${ISSUE}`,
      `--staging-path=${this.staging}`,
      "--dry-run",
    ],
    this.ghEnv,
  );
});

Then("stagingの配置は受理され次の既定branch解決へ進む", function () {
  const output = `${this.startResult.stdout}${this.startResult.stderr}`;
  assert.ok(!output.includes("Issue staging直下"), describe(this.startResult));
  assert.ok(!output.includes("sync-verified"), describe(this.startResult));
  // 配置とidentityの検査を通過し、fixtureにoriginが無いため既定branchの解決で止まる
  assert.match(output, /既定ブランチが不明です/u);
});

Given("staging節を持たないproject policyのrepositoryがある", function () {
  this.root = this.initRepo();
  writeCompletePolicySet(this.root, undefined);
});

When("CLIで既定配置のissue createを実行する", function () {
  const input = this.temp("asc-trackptr-legacy-input-");
  const assessment = path.join(input, "assessment.json");
  fs.writeFileSync(assessment, JSON.stringify(answers(true)));
  this.legacyCreateResult = runCli([
    "issue",
    "create",
    `--root=${this.root}`,
    "--title=既定配置の通知",
    "--mode=quick",
    `--assessment=${assessment}`,
  ]);
});

Then("stagingは既定の一時領域に作られ1行の通知をstderrへ出す", function () {
  assert.equal(
    this.legacyCreateResult.status,
    0,
    describe(this.legacyCreateResult),
  );
  const created = JSON.parse(this.legacyCreateResult.stdout) as {
    path: string;
  };
  assert.equal(
    path.dirname(created.path),
    path.join(this.root, ".agent-skill-chain", "tmp", "issues"),
  );
  const notices = this.legacyCreateResult.stderr
    .split("\n")
    .filter((line) => line.startsWith("通知: "));
  assert.deepEqual(notices, [`通知: ${LEGACY_STAGING_LAYOUT_NOTICE}`]);
  assert.ok(
    !this.legacyCreateResult.stdout.includes(LEGACY_STAGING_LAYOUT_NOTICE),
    "JSON出力へ通知を混ぜない",
  );
});

// ---- unit: 移行前stagingの扱い ----

Given(
  "既定rootにstagingを作った後で版管理下のpointer配置へ移行したrepositoryがある",
  function () {
    this.root = this.initRepo();
    this.staging = createIssueStaging(this.root, {
      title: "移行前",
      answers: answers(false),
      requestedMode: "full",
      now: new Date("2026-09-26T00:00:00.000Z"),
      name: "20260920_legacy",
    }).path;
    writeManifest(this.root, TRACKED_POINTER_STAGING);
  },
);

When("移行前のstagingの配置を検査して同期本文を生成する", function () {
  materializeStaging(this);
  this.location = assertIssueStagingLocation(this.staging);
  this.syncBody = buildIssueSyncBody(this.staging, 8).body;
});

Then("移行前のstagingは既定配置として受理される", function () {
  assert.equal(
    path.dirname(this.staging),
    path.join(this.root, ".agent-skill-chain", "tmp", "issues"),
  );
  assert.equal(assertWorkflowStaging(this.staging), this.staging);
  assert.equal(this.location.repositoryRoot, this.root);
  assert.equal(this.location.layout.tracked, false);
  assert.equal(this.location.layout.issueBody, "full");
  // 宣言そのものはpointerのまま
  assert.equal(readStagingLayout(this.root).issueBody, "pointer");
});

Then("移行前のstagingの同期本文は00の全文である", function () {
  assert.ok(this.syncBody.startsWith(this.request.trimEnd()));
  assert.ok(this.syncBody.includes("<details>"));
});

Then("宣言rootにも既定rootにも無いstagingは拒否される", function () {
  const outside = path.join(this.root, "docs", "elsewhere", "20260926_x");
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(
    () => assertIssueStagingLocation(outside, this.root),
    /docs\/issues\/直下/u,
  );
});
