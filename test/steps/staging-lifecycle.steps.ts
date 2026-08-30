import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  applyStagingCleanup,
  inspectStaging,
  planStagingCleanup,
  readStoredStagingRecord,
  type StagingCleanupPlan,
  type StagingRecord,
} from "../../src/domain/staging.js";
import {
  assertStagingSyncTarget,
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import { stableJson } from "../../src/lib/security.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  signal?: NodeJS.Signals | null;
}

interface StagingWorld extends WorkflowWorld {
  root?: string;
  plan?: StagingCleanupPlan;
  records?: StagingRecord[];
  applyResults?: Array<ReturnType<typeof applyStagingCleanup>>;
  target?: string;
  other?: string;
  before?: string;
  cliResult?: CommandResult;
  syncErrors?: Error[];
  storedState?: string;
  sideEffectCount?: number;
  ghMarker?: string;
  cliEnv?: NodeJS.ProcessEnv;
  bodyFile?: string;
}

const { Given, When, Then } = stepDefinitions<StagingWorld>();
const createdAt = "2026-06-01T00:00:00.000Z";
const now = "2026-08-25T00:00:00.000Z";
const cliSource = path.resolve("dist", "bin", "agent-skill-chain.js");

function rootOf(world: StagingWorld): string {
  assert.ok(world.root, "隔離repositoryが未設定です");
  return world.root;
}

function planOf(world: StagingWorld): StagingCleanupPlan {
  assert.ok(world.plan, "staging previewが未設定です");
  return world.plan;
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function artifactDigest(directory: string, artifacts: string[]): string {
  return sha256(
    stableJson(
      artifacts.map((relative) => ({
        relative,
        digest: sha256(fs.readFileSync(path.join(directory, relative))),
      })),
    ),
  );
}

function createRecordedStaging(
  root: string,
  name: string,
  options: {
    mode?: "quick" | "full";
    synced?: boolean;
    promotionActive?: boolean;
  } = {},
): string {
  const directory = path.join(
    root,
    ".agent-skill-chain",
    "tmp",
    "issues",
    name,
  );
  fs.mkdirSync(directory, { recursive: true });
  const mode = options.mode ?? "quick";
  const artifacts =
    mode === "full"
      ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
      : ["00_要求定義.md"];
  for (const artifact of artifacts)
    fs.writeFileSync(path.join(directory, artifact), `${artifact}\n`);
  const digest = artifactDigest(directory, artifacts);
  if (options.promotionActive && mode !== "full")
    throw new Error("promotion-active fixtureにはmode=fullが必要です");
  const synced = options.synced === true || options.promotionActive === true;
  const syncDigest = synced ? sha256("issue body\n") : null;
  fs.writeFileSync(
    path.join(directory, "staging-record.json"),
    `${JSON.stringify(
      {
        schemaVersion: "agent-skill-chain/staging-record/v1",
        mode,
        artifacts,
        digest,
        owner: "runtime・project owner",
        createdAt,
        state: options.promotionActive
          ? "promotion-active"
          : synced
            ? "sync-verified"
            : "local-active",
        tracker: synced
          ? "https://github.com/example/repository/issues/860"
          : null,
        checkpoint: synced
          ? options.promotionActive
            ? 4
            : mode === "full"
              ? 8
              : 4
          : null,
        syncedAt: synced ? "2026-06-02T00:00:00.000Z" : null,
        syncDigest,
        readBackDigest: syncDigest,
      },
      null,
      2,
    )}\n`,
  );
  return directory;
}

function removeFixture(target: { path: string; relative: string }): void {
  assert.ok(target.relative.startsWith(".agent-skill-chain/tmp/issues/"));
  fs.rmSync(target.path, { recursive: true });
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(process.execPath, [cliSource, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
    signal: result.signal,
  };
}

Given("保持期限を超えた未同期stagingがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "old-unsynced");
});

When("staging cleanupをpreviewする", function () {
  this.plan = planStagingCleanup({
    root: rootOf(this),
    now,
    retentionDays: 30,
  });
});

Then("未同期stagingは削除候補にならず理由付きで保持される", function () {
  assert.equal(planOf(this).candidates.length, 0);
  assert.ok(
    planOf(this).excluded.some((item) => item.reason.includes("同期証拠")),
  );
  assert.equal(fs.existsSync(this.target ?? ""), true);
});

Given("同期確認済みと未同期のstagingがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "verified", { synced: true });
  this.other = createRecordedStaging(this.root, "unsynced");
});

When("保持期限経過後のstagingを検査する", function () {
  this.records = inspectStaging({
    root: rootOf(this),
    now,
    retentionDays: 30,
  });
});

Then("同期確認済みstagingだけがdeletion-readyになる", function () {
  assert.deepEqual(
    this.records
      ?.filter((record) => record.state === "deletion-ready")
      .map((record) => record.relative),
    [".agent-skill-chain/tmp/issues/verified"],
  );
  assert.equal(
    this.records?.find((record) => record.relative.endsWith("/unsynced"))
      ?.state,
    "retained",
  );
});

Given("必須成果物が欠けたfull stagingがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "incomplete", {
    mode: "full",
    synced: true,
  });
  fs.rmSync(path.join(this.target, "03_実装計画.md"));
});

Then("必須成果物不足のstagingは理由付きで保持される", function () {
  assert.equal(planOf(this).candidates.length, 0);
  assert.ok(
    planOf(this).excluded.some((item) => item.reason.includes("必要成果物")),
  );
});

Given("空と内容ありのlegacy stagingがある", function () {
  this.root = this.initRepo();
  this.target = path.join(
    this.root,
    ".agent-skill-chain/tmp/issues/legacy-empty",
  );
  this.other = path.join(
    this.root,
    ".agent-skill-chain/tmp/issues/legacy-content",
  );
  fs.mkdirSync(this.target, { recursive: true });
  fs.mkdirSync(this.other, { recursive: true });
  fs.writeFileSync(path.join(this.other, "unknown.md"), "legacy\n");
});

Then("空のlegacyだけがdeletion-readyになる", function () {
  assert.deepEqual(
    planOf(this).candidates.map((record) => record.relative),
    [".agent-skill-chain/tmp/issues/legacy-empty"],
  );
  assert.ok(
    planOf(this).excluded.some(
      (item) =>
        item.relative.endsWith("legacy-content") &&
        item.reason.includes("legacy"),
    ),
  );
});

Given("cleanup可能なstagingのpreview planがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "ready", { synced: true });
  this.plan = planStagingCleanup({
    root: this.root,
    now,
    retentionDays: 30,
  });
});

When("hash不一致とstaging変更後のapplyを試みる", function () {
  const input = {
    plan: planOf(this),
    root: rootOf(this),
    now,
    retentionDays: 30,
  };
  const first = applyStagingCleanup(
    { ...input, approvedHash: "0".repeat(64) },
    (target) => this.calls.push(target.relative),
  );
  fs.writeFileSync(path.join(this.target ?? "", "changed.md"), "changed\n");
  const second = applyStagingCleanup(
    { ...input, approvedHash: planOf(this).hash },
    (target) => this.calls.push(target.relative),
  );
  this.applyResults = [first, second];
});

Then("staging applyはいずれもremoveを呼ばず拒否される", function () {
  assert.deepEqual(
    this.applyResults?.map((result) => result.state),
    ["rejected", "rejected"],
  );
  assert.deepEqual(this.calls, []);
  assert.equal(fs.existsSync(this.target ?? ""), true);
});

Given("staging境界を逸脱する候補がある", function () {
  this.root = this.initRepo();
  const issues = path.join(this.root, ".agent-skill-chain/tmp/issues");
  fs.mkdirSync(issues, { recursive: true });
  const outside = this.temp("asc-staging-outside-");
  fs.symlinkSync(outside, path.join(issues, "escape"));
  fs.mkdirSync(path.join(issues, "role-log"));
  fs.mkdirSync(path.join(issues, "metrics"));
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain/tmp/not-issues"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(this.root, ".agent-skill-chain/tmp/not-issues/file"),
    "outside scope\n",
  );
});

Then("staging境界外とsymlinkと予約領域は候補にならない", function () {
  assert.equal(planOf(this).candidates.length, 0);
  const excluded = planOf(this).excluded.map(
    (item) => `${item.relative}:${item.reason}`,
  );
  assert.ok(
    excluded.some(
      (item) => item.includes("escape") && item.includes("symlink"),
    ),
  );
  assert.ok(excluded.some((item) => item.includes("role-log")));
  assert.ok(excluded.some((item) => item.includes("metrics")));
  assert.equal(
    fs.existsSync(
      path.join(rootOf(this), ".agent-skill-chain/tmp/not-issues/file"),
    ),
    true,
  );
});

Given("cleanup可能なstagingを持つ隔離repositoryがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "ready", { synced: true });
  this.other = createRecordedStaging(this.root, "retained");
});

When("stagingをpreviewして同じhashでapplyする", function () {
  this.before = fs.readFileSync(
    path.join(this.target ?? "", "staging-record.json"),
    "utf8",
  );
  this.plan = planStagingCleanup({
    root: rootOf(this),
    now,
    retentionDays: 30,
  });
  assert.equal(fs.existsSync(this.target ?? ""), true);
  this.applyResults = [
    applyStagingCleanup(
      {
        plan: this.plan,
        approvedHash: this.plan.hash,
        root: rootOf(this),
        now,
        retentionDays: 30,
      },
      removeFixture,
    ),
  ];
});

Then("previewでは残りapply後に対象だけが削除される", function () {
  assert.equal(this.before?.includes("sync-verified"), true);
  assert.equal(this.applyResults?.[0]?.state, "completed");
  assert.equal(fs.existsSync(this.target ?? ""), false);
  assert.equal(fs.existsSync(this.other ?? ""), true);
});

Given("cleanup可能なstagingが2件ある", function () {
  this.root = this.initRepo();
  createRecordedStaging(this.root, "a-ready", { synced: true });
  createRecordedStaging(this.root, "b-ready", { synced: true });
  this.plan = planStagingCleanup({ root: this.root, now, retentionDays: 30 });
});

When("2件目のstaging削除で失敗させる", function () {
  let count = 0;
  this.applyResults = [
    applyStagingCleanup(
      {
        plan: planOf(this),
        approvedHash: planOf(this).hash,
        root: rootOf(this),
        now,
        retentionDays: 30,
      },
      (target) => {
        count += 1;
        if (count === 2) throw new Error("fixture failure");
        removeFixture(target);
      },
    ),
  ];
});

Then("staging cleanupは部分失敗と未処理対象と復旧方法を返す", function () {
  const result = this.applyResults?.[0];
  assert.equal(result?.state, "partially-completed");
  assert.equal(result?.removed.length, 1);
  assert.ok((result?.retained.length ?? 0) >= 1);
  assert.ok((result?.recovery.length ?? 0) >= 1);
});

Given("未同期のquick stagingがある", function () {
  this.root = this.temp("asc-staging-sync-");
  const answers = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true, evidence: "fixture" },
    ]),
  );
  this.target = createIssueStaging(this.root, {
    title: "sync-record",
    answers,
    now: new Date(createdAt),
  }).path;
});

When("不一致と一致の読み取りdigestで同期記録を順に試みる", function () {
  const expected = sha256("body\n");
  const errors: Error[] = [];
  try {
    recordStagingSync(this.target ?? "", {
      tracker: "https://github.com/example/repository/issues/860",
      checkpoint: 4,
      syncedAt: "2026-06-02T00:00:00.000Z",
      bodyDigest: expected,
      readBackDigest: sha256("different\n"),
    });
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }
  recordStagingSync(this.target ?? "", {
    tracker: "https://github.com/example/repository/issues/860",
    checkpoint: 4,
    syncedAt: "2026-06-02T00:00:00.000Z",
    bodyDigest: expected,
    readBackDigest: expected,
  });
  this.syncErrors = errors;
  this.storedState = readStoredStagingRecord(this.target ?? "").state;
});

Then("一致した同期記録だけがsync-verifiedになる", function () {
  assert.equal(this.syncErrors?.length, 1);
  assert.equal(this.storedState, "sync-verified");
});

When("短縮Issue番号で同期記録を試みる", function () {
  this.syncErrors = [];
  try {
    recordStagingSync(this.target ?? "", {
      tracker: "#860",
      checkpoint: 4,
      syncedAt: "2026-06-02T00:00:00.000Z",
      bodyDigest: "a".repeat(64),
      readBackDigest: "a".repeat(64),
    });
  } catch (error) {
    this.syncErrors.push(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
});

Then("absolute GitHub Issue URLでないtrackerは拒否される", function () {
  assert.equal(this.syncErrors?.length, 1);
  assert.match(
    this.syncErrors?.[0]?.message ?? "",
    /absolute GitHub Issue URL/u,
  );
  assert.equal(
    readStoredStagingRecord(this.target ?? "").state,
    "local-active",
  );
});

When("保存済みstaging recordのtrackerを短縮番号へ改ざんする", function () {
  const recordFile = path.join(this.target ?? "", "staging-record.json");
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as Record<
    string,
    unknown
  >;
  fs.writeFileSync(
    recordFile,
    `${JSON.stringify({ ...record, tracker: "#860" }, null, 2)}\n`,
  );
  this.syncErrors = [];
  try {
    readStoredStagingRecord(this.target ?? "");
  } catch (error) {
    this.syncErrors.push(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
});

Then("改ざんされた短縮trackerの読み取りは拒否される", function () {
  assert.equal(this.syncErrors?.length, 1);
  assert.match(
    this.syncErrors?.[0]?.message ?? "",
    /absolute GitHub Issue URL/u,
  );
});

Given("promotion-activeの元Issue同期stagingがある", function () {
  this.root = this.temp("asc-promotion-sync-");
  this.target = createRecordedStaging(this.root, "promotion-active", {
    mode: "full",
    promotionActive: true,
  });
  this.bodyFile = path.join(this.root, "issue-body.md");
  this.before = fs.readFileSync(
    path.join(this.target, "staging-record.json"),
    "utf8",
  );
  fs.writeFileSync(this.bodyFile, "promotion body\n");
  const stubDirectory = this.temp("asc-promotion-gh-");
  this.ghMarker = path.join(stubDirectory, "called");
  const stub = path.join(stubDirectory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(this.ghMarker)}, args.join(" ") + "\\n");
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ nameWithOwner: "example/repository", viewerPermission: "WRITE" }));
} else if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write("promotion body\\n");
}
process.exit(0);
`,
  );
  fs.chmodSync(stub, 0o755);
  this.cliEnv = {
    ...process.env,
    PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  };
});

When("別Issueへの再同期を適用する", function () {
  this.sideEffectCount = 0;
  this.syncErrors = [];
  this.cliResult = runCli(
    [
      "issue",
      "sync",
      "--repo=example/repository",
      "--issue=861",
      `--body-file=${this.bodyFile ?? ""}`,
      `--staging-path=${this.target ?? ""}`,
      "--checkpoint=4",
      "--synced-at=2026-06-03T00:00:00.000Z",
      "--apply",
      "--authorize=approved",
    ],
    this.cliEnv,
  );
  if (fs.existsSync(this.ghMarker ?? "")) this.sideEffectCount += 1;
  try {
    recordStagingSync(this.target ?? "", {
      tracker: "https://github.com/example/repository/issues/861",
      checkpoint: 8,
      syncedAt: "2026-06-03T00:00:00.000Z",
      bodyDigest: sha256("promotion body\n"),
      readBackDigest: sha256("promotion body\n"),
    });
  } catch (error) {
    this.syncErrors.push(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  this.storedState = readStoredStagingRecord(this.target ?? "").state;
});

Then("外部副作用前と直接記録の両方で拒否される", function () {
  assert.notEqual(this.cliResult?.status, 0);
  assert.equal(this.sideEffectCount, 0);
  assert.equal(fs.existsSync(this.ghMarker ?? ""), false);
  assert.equal(this.syncErrors?.length, 1);
  assert.match(this.syncErrors?.[0]?.message ?? "", /元Issue/u);
  assert.equal(this.storedState, "promotion-active");
});

When("元Issueへの再同期を適用する", function () {
  assert.doesNotThrow(() =>
    assertStagingSyncTarget(this.target ?? "", 8, {
      repository: "example/repository",
      issue: 860,
    }),
  );
  this.sideEffectCount = 1;
  recordStagingSync(this.target ?? "", {
    tracker: "https://github.com/example/repository/issues/860",
    checkpoint: 8,
    syncedAt: "2026-06-03T00:00:00.000Z",
    bodyDigest: sha256("promotion body\n"),
    readBackDigest: sha256("promotion body\n"),
  });
  this.storedState = readStoredStagingRecord(this.target ?? "").state;
});

Then("元Issueだけが同期されsync-verifiedになる", function () {
  assert.equal(this.sideEffectCount, 1);
  const stored = readStoredStagingRecord(this.target ?? "");
  assert.equal(stored.state, "sync-verified");
  assert.equal(
    stored.tracker,
    "https://github.com/example/repository/issues/860",
  );
});

When("full補完中のStep 4を元Issueへ同期する", function () {
  this.cliResult = runCli(
    [
      "issue",
      "sync",
      "--repo=example/repository",
      "--issue=860",
      `--body-file=${this.bodyFile ?? ""}`,
      `--staging-path=${this.target ?? ""}`,
      "--checkpoint=4",
      "--synced-at=2026-06-03T00:00:00.000Z",
      "--apply",
      "--authorize=approved",
    ],
    this.cliEnv,
  );
  this.storedState = readStoredStagingRecord(this.target ?? "").state;
});

Then("元Issueだけを更新しstaging記録はpromotion-activeを維持する", function () {
  assert.equal(
    this.cliResult?.status,
    0,
    `${this.cliResult?.stdout ?? ""}\n${this.cliResult?.stderr ?? ""}\n${this.cliResult?.error ?? ""}\n${this.cliResult?.signal ?? ""}`,
  );
  assert.equal(fs.existsSync(this.ghMarker ?? ""), true);
  assert.equal(this.storedState, "promotion-active");
  assert.equal(
    fs.readFileSync(
      path.join(this.target ?? "", "staging-record.json"),
      "utf8",
    ),
    this.before,
  );
  assert.match(this.cliResult?.stdout ?? "", /"stagingRecordUpdated": false/u);
});

Given("CLI staging preview対象の隔離repositoryがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "cli-ready", { synced: true });
  this.other = createRecordedStaging(this.root, "cli-retained");
  this.before = fs.readFileSync(
    path.join(this.target, "staging-record.json"),
    "utf8",
  );
});

When("issue staging CLIをapplyなしで実行する", function () {
  this.cliResult = runCli([
    "issue",
    "staging",
    `--root=${rootOf(this)}`,
    `--now=${now}`,
    "--retention-days=30",
  ]);
});

Then("staging CLI previewは終了code 0で候補と理由をJSON出力する", function () {
  assert.equal(this.cliResult?.status, 0, this.cliResult?.stderr);
  const output: unknown = JSON.parse(this.cliResult?.stdout ?? "null");
  assert.ok(output && typeof output === "object");
  const report = output as StagingCleanupPlan;
  assert.equal(report.candidates.length, 1);
  assert.ok(report.excluded.some((item) => item.reason.includes("同期証拠")));
});

Then("staging CLI previewは対象を書き換えない", function () {
  assert.equal(
    fs.readFileSync(
      path.join(this.target ?? "", "staging-record.json"),
      "utf8",
    ),
    this.before,
  );
});

Given("CLI staging apply対象の隔離repositoryがある", function () {
  this.root = this.initRepo();
  this.target = createRecordedStaging(this.root, "cli-apply", { synced: true });
});

When("異なるapproved hashでissue staging CLIをapplyする", function () {
  this.cliResult = runCli([
    "issue",
    "staging",
    `--root=${rootOf(this)}`,
    `--now=${now}`,
    "--retention-days=30",
    "--apply",
    `--approved-hash=${"0".repeat(64)}`,
  ]);
});

Then("staging CLI applyは構造化診断を返して非0になる", function () {
  assert.notEqual(this.cliResult?.status, 0);
  const output: unknown = JSON.parse(this.cliResult?.stdout ?? "null");
  assert.ok(output && typeof output === "object");
  const value = output as { state?: string; diagnostic?: { ruleId?: string } };
  assert.equal(value.state, "rejected");
  assert.equal(value.diagnostic?.ruleId, "ASC-STAGING-CLEANUP-001");
});

Then("staging CLI applyは対象を一件も削除しない", function () {
  assert.equal(fs.existsSync(this.target ?? ""), true);
});
