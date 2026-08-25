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
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import { stableJson } from "../../src/lib/security.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
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
  options: { mode?: "quick" | "full"; synced?: boolean } = {},
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
  const syncDigest = options.synced ? sha256("issue body\n") : null;
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
        state: options.synced ? "sync-verified" : "local-active",
        tracker: options.synced
          ? "https://github.com/example/repository/issues/860"
          : null,
        checkpoint: options.synced ? (mode === "full" ? 8 : 4) : null,
        syncedAt: options.synced ? "2026-06-02T00:00:00.000Z" : null,
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

function runCli(args: string[]): CommandResult {
  const result = spawnSync(process.execPath, [cliSource, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
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
