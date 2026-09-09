import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  doctor,
  init,
  uninstall,
  upgrade,
} from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface IsolationWorld extends WorkflowWorld {
  applyResult: ReturnType<typeof uninstall>;
  cliResults: Array<ReturnType<typeof runCli>>;
  consumerFiles: Record<string, string>;
  doctorHealthy: boolean;
  externalFile: string;
  installedAssets: string[];
  invalidRecordRejected: boolean;
  /** install直後のhost入口の存在（Issue #1219）。 */
  rootEntriesAfterInstall: boolean[];
  root: string;
  secondDeleteRejected: boolean;
  statusBefore: string;
  /** hookの登録の有無で`healthy`が変わらないことの観測（Issue #1105）。 */
  hookDoctorStates?: Array<ReturnType<typeof doctor>>;
  /** record喪失からの復旧の観測（Issue #1305）。 */
  recoveryResult?: ReturnType<typeof upgrade>;
  /** 適用前のpreview出力（Issue #1305）。照会とコマンドを別に観測する。 */
  recoveryPreview?: ReturnType<typeof upgrade>;
  /** record不在時のinstall・deleteの拒否理由（Issue #1305）。 */
  recoveryRejections?: string[];
  /** 復旧前に測った資産のdigest（Issue #1305）。 */
  digestsBeforeRecovery?: Record<string, string>;
  /** 境界外symlinkの参照先とその内容（Issue #1305）。 */
  outsideTarget?: { file: string; contents: string };
}

/** repository直下へ展開されるhostごとの常時入口（Issue #1219）。 */
const ROOT_HOST_ENTRIES = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * 強制点hookの正本と展開先（Issue #1105）。
 *
 * **期待pathを製品の定数から導出しない。** 導出すると、配布対象を消す変異で
 * 期待値も同時に縮み、変異が検出できなくなる。ここへ書き写した値が正本と
 * 食い違えば、この検査が落ちる。
 */
const HOOK_CANONICAL = ".agent-skill-chain/hooks/asc-contract-citation.mjs";
const HOOK_HOST_COPIES = [
  ".claude/hooks/asc-contract-citation.mjs",
  ".codex/hooks/asc-contract-citation.mjs",
] as const;
/** hookを登録済みのhost設定。**installはこれを1 byteも変えてはならない。** */
const HOST_HOOK_SETTINGS = ".claude/settings.local.json";

const { Given, When, Then } = stepDefinitions<IsolationWorld>();

function sha256(contents: string | Buffer): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function write(root: string, relative: string, contents: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function readObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`JSON objectではありません: ${file}`);
  return parsed as Record<string, unknown>;
}

function recordFiles(record: Record<string, unknown>): Record<string, unknown> {
  const files = record.files;
  if (files === null || typeof files !== "object" || Array.isArray(files))
    throw new TypeError("managed asset recordのfilesがobjectではありません");
  return files as Record<string, unknown>;
}

function recordPath(root: string): string {
  return path.join(root, ".agent-skill-chain", "managed-assets.json");
}

function writeRecord(root: string, record: Record<string, unknown>): void {
  fs.writeFileSync(recordPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

function gitStatus(root: string): string {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  );
}

function runCli(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.resolve("dist/bin/agent-skill-chain.js"), ...args, `--root=${root}`],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function captureFiles(
  root: string,
  relatives: string[],
): Record<string, string> {
  return Object.fromEntries(
    relatives.map((relative) => [
      relative,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function assertCapturedFiles(
  root: string,
  expected: Record<string, string>,
): void {
  for (const [relative, contents] of Object.entries(expected))
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), contents);
}

Given("lifecycle検証用の隔離directoryがある", function () {
  this.root = this.temp("asc-lifecycle-sequence-");
  write(this.root, "README.md", "# fixture\n");
  this.consumerFiles = { "README.md": "# fixture\n" };
});

When("隔離先でsetupとupdateとdeleteを順に適用する", function () {
  const preview = init(this.root, { apply: false });
  assert.equal(preview.applied, false);
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
  const installed = init(this.root, { apply: true });
  this.installedAssets = installed.assets;
  const updated = upgrade(this.root, { apply: true });
  assert.equal(updated.applied, true);
  this.doctorHealthy = doctor(this.root).healthy;
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("package管理資産だけが追加更新削除される", function () {
  assert.equal(this.applyResult.applied, true);
  assert.equal(this.doctorHealthy, true);
  assert.equal(fs.existsSync(recordPath(this.root)), false);
  for (const relative of this.installedAssets)
    assert.equal(fs.existsSync(path.join(this.root, relative)), false);
  assertCapturedFiles(this.root, this.consumerFiles);
});

Given(
  "hook登録済みのhost設定を持つ隔離directoryがある",
  function (this: IsolationWorld) {
    this.root = this.temp("asc-lifecycle-hooksettings-");
    write(this.root, "README.md", "# fixture\n");
    const settings = `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: `"$CLAUDE_PROJECT_DIR/${HOOK_HOST_COPIES[0]}"`,
                  timeout: 15,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`;
    write(this.root, HOST_HOOK_SETTINGS, settings);
    this.consumerFiles = { [HOST_HOOK_SETTINGS]: settings };
  },
);

When("setupを適用する", function (this: IsolationWorld) {
  init(this.root, { apply: true });
});

/**
 * **消えた展開先の復元を測る**（Issue #1105）。
 *
 * 展開先を**書き換えて**updateを流すのは別の契約の検査になる。書き換えは
 * 利用者の変更であり、`update`はそれを保持するのが正しい。**2つを同じ
 * scenarioで測ると、どちらの契約も検査できない。** 保持の側は
 * `SCN-INT-LIFECYCLE-013`が`delete`で測る。
 */
When(
  "setupを適用してからhook展開先を消してupdateを適用する",
  function (this: IsolationWorld) {
    init(this.root, { apply: true });
    fs.rmSync(path.join(this.root, HOOK_HOST_COPIES[0]));
    this.applyResult = upgrade(this.root, { apply: true }) as never;
  },
);

When(
  "setupを適用してからhook展開先を書き換えてdeleteを適用する",
  function (this: IsolationWorld) {
    init(this.root, { apply: true });
    write(
      this.root,
      HOOK_HOST_COPIES[0],
      "#!/usr/bin/env bash\n# 利用者の変更\n",
    );
    this.applyResult = uninstall(this.root, { apply: true });
  },
);

Then(
  "hook正本と2つのhost展開先が同じ内容で存在する",
  function (this: IsolationWorld) {
    const canonical = path.join(this.root, HOOK_CANONICAL);
    assert.equal(
      fs.existsSync(canonical),
      true,
      `${HOOK_CANONICAL}がありません`,
    );
    const expected = sha256(fs.readFileSync(canonical));
    for (const relative of HOOK_HOST_COPIES) {
      const file = path.join(this.root, relative);
      assert.equal(fs.existsSync(file), true, `${relative}がありません`);
      assert.equal(
        sha256(fs.readFileSync(file)),
        expected,
        `${relative}が正本と一致しません`,
      );
    }
  },
);

Then("展開したhookに実行bitが立っている", function (this: IsolationWorld) {
  for (const relative of [HOOK_CANONICAL, ...HOOK_HOST_COPIES]) {
    const mode = fs.statSync(path.join(this.root, relative)).mode & 0o111;
    assert.notEqual(mode, 0, `${relative}に実行bitがありません`);
  }
});

Then("展開先のhookは正本と同じ内容へ戻る", function (this: IsolationWorld) {
  const canonical = sha256(
    fs.readFileSync(path.join(this.root, HOOK_CANONICAL)),
  );
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, HOOK_HOST_COPIES[0]))),
    canonical,
    "updateが正本の内容を展開先へ反映していません",
  );
});

Then("書き換えたhookは残る", function (this: IsolationWorld) {
  const file = path.join(this.root, HOOK_HOST_COPIES[0]);
  assert.equal(fs.existsSync(file), true, "利用者が変更したhookを消しています");
  assert.match(fs.readFileSync(file, "utf8"), /利用者の変更/u);
});

Then("host設定fileは1 byteも変わらない", function (this: IsolationWorld) {
  assertCapturedFiles(this.root, this.consumerFiles);
});

Given("lifecycle隔離先に他skillと利用者文書と他ツール設定がある", function () {
  this.root = this.temp("asc-lifecycle-assets-");
  const external = this.temp("asc-lifecycle-link-target-");
  this.externalFile = write(external, "外部.txt", "外部の利用者資産\n");
  const relatives = [
    ".other-tool/skills/foo.md",
    "docs/specs/利用者仕様.md",
    "README.md",
    ".editorconfig",
    ".vscode/settings.json",
  ];
  relatives.forEach((relative) =>
    write(this.root, relative, `keep:${relative}\n`),
  );
  fs.mkdirSync(path.join(this.root, "links"), { recursive: true });
  fs.symlinkSync(
    path.join(this.root, ".agent-skill-chain", "docs", "00_運用ポリシー.md"),
    path.join(this.root, "links", "package-owned"),
  );
  fs.symlinkSync(this.externalFile, path.join(this.root, "links", "external"));
  this.consumerFiles = captureFiles(this.root, relatives);
});

When("lifecycle隔離先で導入後にdeleteを適用する", function () {
  init(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("他skillと利用者文書と他ツール設定は同一内容で残る", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(
    fs
      .lstatSync(path.join(this.root, "links", "package-owned"))
      .isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.lstatSync(path.join(this.root, "links", "external")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.readFileSync(this.externalFile, "utf8"),
    "外部の利用者資産\n",
  );
});

Given("dirtyな隔離Git repositoryにconsumer所有資産がある", function () {
  this.root = this.initRepo();
  const tracked = [
    "docs/specs/利用者仕様.md",
    ".agent-skill-chain/project-policy.json",
    ".agent-skill-chain/project/rules/consumer.json",
  ];
  tracked.forEach((relative) =>
    write(this.root, relative, `tracked:${relative}\n`),
  );
  execFileSync("git", ["add", ...tracked], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "consumer assets"], {
    cwd: this.root,
  });
  write(this.root, "docs/specs/利用者仕様.md", "dirty spec\n");
  write(this.root, ".agent-skill-chain/tmp/issues/draft.md", "staging\n");
  write(this.root, "未追跡.txt", "untracked\n");
  this.consumerFiles = captureFiles(this.root, [
    ...tracked,
    ".agent-skill-chain/tmp/issues/draft.md",
    "未追跡.txt",
  ]);
  this.statusBefore = gitStatus(this.root);
});

When("dirty状態のままsetupとupdateとdeleteを適用する", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("consumer所有資産とdirty状態は保持される", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(gitStatus(this.root), this.statusBefore);
});

Given("導入済み隔離先と改ざんrecordの反例がある", function () {
  this.root = this.temp("asc-lifecycle-tampered-");
  init(this.root, { apply: true });
  this.invalidRecordRejected = false;
});

When("hash不一致と不正recordでdeleteを試みる", function () {
  write(this.root, "AGENTS.md", "consumer modified\n");
  this.applyResult = uninstall(this.root, { apply: true });

  const corruptions: Array<(root: string) => void> = [
    (root) => fs.writeFileSync(recordPath(root), "{broken"),
    (root) => {
      const record = readObject(recordPath(root));
      record.files = [];
      writeRecord(root, record);
    },
    (root) => {
      const record = readObject(recordPath(root));
      recordFiles(record)["AGENTS.md"] = "not-a-sha256";
      writeRecord(root, record);
    },
  ];
  this.invalidRecordRejected = corruptions.every((corrupt) => {
    const root = this.temp("asc-lifecycle-invalid-record-");
    init(root, { apply: true });
    corrupt(root);
    try {
      uninstall(root, { apply: true });
      return false;
    } catch {
      return fs.existsSync(path.join(root, "AGENTS.md"));
    }
  });
});

Then("hash不一致資産を保持し不正recordは削除前に拒否する", function () {
  assert.ok(this.applyResult.retained.includes("AGENTS.md"));
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    "consumer modified\n",
  );
  assert.equal(this.invalidRecordRejected, true);
});

Given("導入済み隔離先と境界外の一時資産がある", function () {
  this.root = this.temp("asc-lifecycle-boundary-");
  const outside = this.temp("asc-lifecycle-outside-");
  this.externalFile = write(outside, "重要.txt", "境界外\n");
  init(this.root, { apply: true });
  this.invalidRecordRejected = false;
});

When("traversal recordとsymlink脱出でdeleteを試みる", function () {
  const traversalKeys = [
    "../outside.txt",
    this.externalFile,
    ".agent-skill-chain/docs/e\u0301/../00_運用ポリシー.md",
  ];
  const traversalRejected = traversalKeys.every((key) => {
    const root = this.temp("asc-lifecycle-traversal-");
    init(root, { apply: true });
    const record = readObject(recordPath(root));
    recordFiles(record)[key] = sha256("境界外\n");
    writeRecord(root, record);
    try {
      uninstall(root, { apply: true });
      return false;
    } catch {
      return fs.existsSync(path.join(root, "AGENTS.md"));
    }
  });

  const agents = path.join(this.root, "AGENTS.md");
  const original = fs.readFileSync(agents);
  fs.writeFileSync(this.externalFile, original);
  fs.rmSync(agents);
  fs.symlinkSync(this.externalFile, agents);
  let symlinkRejected = false;
  try {
    uninstall(this.root, { apply: true });
  } catch {
    symlinkRejected = true;
  }
  this.invalidRecordRejected = traversalRejected && symlinkRejected;
});

Then("境界内外の資産を削除せず拒否する", function () {
  assert.equal(this.invalidRecordRejected, true);
  assert.equal(
    fs.lstatSync(path.join(this.root, "AGENTS.md")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(this.root, ".agent-skill-chain", "00_利用案内.md")),
    true,
  );
  assert.equal(fs.existsSync(this.externalFile), true);
});

Given("delete preview済みの隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-toctou-");
  init(this.root, { apply: true });
  const preview = uninstall(this.root, { apply: false });
  assert.ok(preview.removable.includes(path.join(this.root, "AGENTS.md")));
});

When("preview後に削除対象の内容を変更してapplyする", function () {
  write(this.root, "AGENTS.md", "preview後の変更\n");
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("変更された削除対象はretainedとして残る", function () {
  assert.ok(this.applyResult.retained.includes("AGENTS.md"));
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    "preview後の変更\n",
  );
});

Given("削除の一部だけが失敗する導入済み隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-partial-");
  init(this.root, { apply: true });
});

When("部分失敗を起こすdeleteを適用する", function () {
  fs.chmodSync(this.root, 0o555);
  try {
    this.applyResult = uninstall(this.root, { apply: true });
  } finally {
    fs.chmodSync(this.root, 0o755);
  }
});

Then("削除済みと未処理と復旧方法を報告してrecordを保持する", function () {
  assert.equal(this.applyResult.applied, false);
  assert.ok(this.applyResult.removed.length > 0);
  assert.ok(this.applyResult.pending.includes("AGENTS.md"));
  assert.match(this.applyResult.recovery, /再実行/u);
  assert.equal(fs.existsSync(recordPath(this.root)), true);
});

Given("旧version recordとconsumer資産を持つ隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-legacy-");
  init(this.root, { apply: true });
  write(this.root, "consumer-owned.txt", "consumer\n");
  const legacyRelative = ".agent-skill-chain/docs/旧配置.md";
  write(this.root, legacyRelative, "legacy package asset\n");
  const record = readObject(recordPath(this.root));
  record.version = "0.2.0";
  recordFiles(record)[legacyRelative] = sha256("legacy package asset\n");
  writeRecord(this.root, record);
  this.consumerFiles = captureFiles(this.root, ["consumer-owned.txt"]);
  this.secondDeleteRejected = false;
});

When("updateを2回適用してdeleteも再実行する", function () {
  upgrade(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
  try {
    uninstall(this.root, { apply: true });
  } catch {
    this.secondDeleteRejected = true;
  }
});

Then("consumer資産を保持して2回目のdeleteは安全に停止する", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(this.secondDeleteRejected, true);
});

Given("Unicode pathと読み取り専用資産が共存する隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-unicode-");
  const relatives = [
    "利用者/全角/文書.txt",
    "利用者/café/文書.txt",
    "利用者/cafe\u0301/文書.txt",
    "利用者/読取専用.txt",
  ];
  relatives.forEach((relative) =>
    write(this.root, relative, `keep:${relative}\n`),
  );
  fs.chmodSync(path.join(this.root, "利用者", "読取専用.txt"), 0o444);
  this.consumerFiles = captureFiles(this.root, relatives);
});

When("setupとupdateとdeleteを適用する", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("Unicode pathと読み取り専用資産は同一内容で残る", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(
    fs.statSync(path.join(this.root, "利用者", "読取専用.txt")).mode & 0o777,
    0o444,
  );
});

Given("CLI lifecycle用の隔離consumerがある", function () {
  this.root = this.temp("asc-lifecycle-cli-");
  write(this.root, "README.md", "CLI consumer\n");
  this.consumerFiles = captureFiles(this.root, ["README.md"]);
  this.cliResults = [];
});

When("CLIのinstallとupdateとdeleteをapplyする", function () {
  const installed = runCli(this.root, ["install", "--apply"]);
  /**
   * **hostごとに常時読まれるfile名が違う。** Codexは`AGENTS.md`、Claude Codeは
   * `CLAUDE.md`を読む。片方だけを配ると、もう片方のhostでは規範文書へ到達する
   * 常時の入口が存在しない（Issue #1219）。**installの直後に両方を観測する。**
   */
  this.rootEntriesAfterInstall = ROOT_HOST_ENTRIES.map((relative) =>
    fs.existsSync(path.join(this.root, relative)),
  );
  this.cliResults = [
    installed,
    runCli(this.root, ["update", "--apply"]),
    runCli(this.root, ["delete", "--apply"]),
  ];
});

Then("CLI lifecycleは成功してconsumer資産だけが残る", function () {
  for (const result of this.cliResults)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(fs.existsSync(recordPath(this.root)), false);
  /** installは両hostの入口を作り、deleteは両方を取り除く。 */
  assert.deepEqual(
    this.rootEntriesAfterInstall,
    ROOT_HOST_ENTRIES.map(() => true),
    `installがhost入口を作っていません: ${ROOT_HOST_ENTRIES.join("、")}`,
  );
  for (const relative of ROOT_HOST_ENTRIES)
    assert.equal(fs.existsSync(path.join(this.root, relative)), false);
});

Given("CLIで導入済みの隔離consumerと外部一時資産がある", function () {
  this.root = this.temp("asc-lifecycle-cli-preview-");
  const outside = this.temp("asc-lifecycle-cli-outside-");
  this.externalFile = write(outside, "保持.txt", "outside\n");
  const installResult = runCli(this.root, ["install", "--apply"]);
  assert.equal(installResult.status, 0, installResult.stderr);
  fs.symlinkSync(this.externalFile, path.join(this.root, "external-link"));
  this.consumerFiles = {
    "AGENTS.md": sha256(fs.readFileSync(path.join(this.root, "AGENTS.md"))),
    ".agent-skill-chain/managed-assets.json": sha256(
      fs.readFileSync(recordPath(this.root)),
    ),
  };
  this.cliResults = [];
});

When("applyなしでCLIのdeleteを実行する", function () {
  this.cliResults = [runCli(this.root, ["delete"])];
});

Then("deleteはpreviewだけを返して隔離先と外部資産を変更しない", function () {
  const result = this.cliResults[0];
  assert.equal(result?.status, 0, result?.stderr);
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, "AGENTS.md"))),
    this.consumerFiles["AGENTS.md"],
  );
  assert.equal(
    sha256(fs.readFileSync(recordPath(this.root))),
    this.consumerFiles[".agent-skill-chain/managed-assets.json"],
  );
  assert.equal(fs.readFileSync(this.externalFile, "utf8"), "outside\n");
  assert.equal(
    fs.lstatSync(path.join(this.root, "external-link")).isSymbolicLink(),
    true,
  );
});

/**
 * **合成経路で`healthy`の不変を測る**（Issue #1105）。
 *
 * 純関数`inspectHookRegistration`の単体だけでは、**その結果を`doctor`が
 * root `healthy`へ混ぜる変異を1件も捕まえない**（変異試験で実測）。同じ
 * projectを未登録と登録済みの2状態にして`healthy`を突き合わせる。
 */
When(
  "setupを適用してhook未登録と登録済みの両方でdoctorを実行する",
  function (this: IsolationWorld) {
    init(this.root, { apply: true });
    const unregistered = doctor(this.root);
    write(
      this.root,
      HOST_HOOK_SETTINGS,
      `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: `"$CLAUDE_PROJECT_DIR/${HOOK_HOST_COPIES[0]}"`,
                },
              ],
            },
          ],
        },
      })}\n`,
    );
    this.hookDoctorStates = [unregistered, doctor(this.root)];
  },
);

Then("2つのhealthyは等しく登録状態だけが違う", function (this: IsolationWorld) {
  const [unregistered, registered] = this.hookDoctorStates ?? [];
  assert.ok(unregistered !== undefined && registered !== undefined);
  assert.equal(
    unregistered.healthy,
    registered.healthy,
    "hookの登録の有無がdoctorのhealthyを変えています",
  );
  assert.equal(unregistered.hooks.registered, false);
  assert.equal(registered.hooks.registered, true);
  assert.equal(unregistered.hooks.diagnostics.length > 0, true);
  assert.equal(registered.hooks.diagnostics.length, 0);
});

/**
 * **境界外への解決失敗で`doctor`が止まらないことを測る**（Issue #1105）。
 *
 * `.claude`がroot外を指すsymlinkだと`resolveContained`が例外を投げる。
 * **登録状態の観測は任意であり、失敗しても他の診断を返す価値がある。**
 */
/**
 * **installの後にsymlinkへ差し替える。** 先に差し替えると`mappings()`の
 * `resolveContained`が`install`自体を止め、`doctor`の観測に到達しない。
 */
When(
  "setupを適用してからhost設定pathを境界外のsymlinkへ差し替えてdoctorを実行する",
  function (this: IsolationWorld) {
    init(this.root, { apply: true });
    const hostDirectory = path.join(this.root, ".claude");
    fs.rmSync(hostDirectory, { recursive: true, force: true });
    fs.symlinkSync(this.temp("asc-lifecycle-outside-"), hostDirectory);
    this.hookDoctorStates = [doctor(this.root)];
  },
);

Then("doctorは中断せず未登録として報告する", function (this: IsolationWorld) {
  const [state] = this.hookDoctorStates ?? [];
  assert.ok(state !== undefined, "doctorが結果を返していません");
  assert.equal(state.hooks.registered, false);
  assert.equal(state.hooks.diagnostics.length > 0, true);
  assert.equal(
    Array.isArray(state.adapters.diagnostics),
    true,
    "他の診断欄が返っていません",
  );
});

/**
 * record喪失からの復旧（Issue #1305）。
 *
 * **recordの不在は失敗ではなく「全件未管理」である。** 展開済み資産が
 * 正本と異なる場合に上書きへ倒すと、利用者の変更が無音で失われる。
 */
const DIVERGENT_ASSET = ".claude/skills/asc-step/SKILL.md";

/** 復旧の観測に使う展開先。**製品の定数から導出しない。** */
const NON_REGULAR_TARGETS = [
  ".claude/hooks/asc-contract-citation.mjs",
  ".codex/hooks/asc-contract-citation.mjs",
] as const;

function installedIsolation(world: IsolationWorld, prefix: string): void {
  world.root = world.temp(prefix);
  write(world.root, "README.md", "# fixture\n");
  world.consumerFiles = { "README.md": "# fixture\n" };
  const installed = init(world.root, { apply: true });
  world.installedAssets = installed.assets;
}

function dropRecord(root: string): void {
  fs.rmSync(recordPath(root));
  assert.equal(fs.existsSync(recordPath(root)), false);
}

Given("導入後にmanaged asset recordだけを失った隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-record-lost-");
  dropRecord(this.root);
});

Given(
  "導入後にrecordを失い展開済み資産が正本と異なる隔離先がある",
  function () {
    installedIsolation(this, "asc-lifecycle-record-divergent-");
    const file = path.join(this.root, DIVERGENT_ASSET);
    fs.appendFileSync(file, "\n利用者による追記\n");
    this.digestsBeforeRecovery = {
      [DIVERGENT_ASSET]: sha256(fs.readFileSync(file)),
    };
    dropRecord(this.root);
  },
);

Given(
  "導入後にrecordを失いhook登録済みhost設定を持つ隔離先がある",
  function () {
    this.root = this.temp("asc-lifecycle-record-settings-");
    write(this.root, "README.md", "# fixture\n");
    this.consumerFiles = { "README.md": "# fixture\n" };
    const settings = JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: `"$CLAUDE_PROJECT_DIR/${HOOK_HOST_COPIES[0]}"`,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );
    write(this.root, HOST_HOOK_SETTINGS, `${settings}\n`);
    /**
     * **保持を確かめるfileを`consumerFiles`へ入れる。** 入れないと
     * 「1 byteも変わらない」の検査がREADMEだけを見て空虚になる。
     */
    this.consumerFiles[HOST_HOOK_SETTINGS] = `${settings}\n`;
    const installed = init(this.root, { apply: true });
    this.installedAssets = installed.assets;
    this.digestsBeforeRecovery = {
      [HOST_HOOK_SETTINGS]: sha256(
        fs.readFileSync(path.join(this.root, HOST_HOOK_SETTINGS)),
      ),
    };
    dropRecord(this.root);
  },
);

Given("導入後にrecordを失い展開先がdirectoryの隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-record-nonregular-");
  const outside = path.join(this.temp("asc-lifecycle-outside-"), "outside.md");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, "# 境界外\n");
  this.outsideTarget = { file: outside, contents: "# 境界外\n" };
  const asDirectory = path.join(this.root, NON_REGULAR_TARGETS[0]);
  fs.rmSync(asDirectory);
  fs.mkdirSync(asDirectory, { recursive: true });
  dropRecord(this.root);
});

When("record不在の隔離先へupdateを適用する", function () {
  /**
   * **照会（preview）とコマンド（apply）を別に観測する。** applyだけを見ると、
   * previewが`adopted`を1件も報告しなくなる変異が生存する。
   */
  this.recoveryPreview = upgrade(this.root, { apply: false });
  this.recoveryResult = upgrade(this.root, { apply: true });
});

When("record不在の隔離先へinstallとdeleteを試みる", function () {
  const rejections: string[] = [];
  for (const attempt of [
    () => init(this.root, { apply: true }),
    () => uninstall(this.root, { apply: true }),
  ]) {
    try {
      attempt();
      rejections.push("");
    } catch (error) {
      rejections.push(error instanceof Error ? error.message : String(error));
    }
  }
  this.recoveryRejections = rejections;
  this.recoveryResult = upgrade(this.root, { apply: true });
});

Then(
  "正本一致資産はadoptedとして採用され実測digestのrecordが再生成される",
  function () {
    const result = this.recoveryResult;
    assert.ok(result, "復旧結果がありません");
    assert.equal(result.applied, true);
    /**
     * **件数ではなく集合で突合する**（Issue #1305、F-04）。
     * `length > 0`だと、record不在時に先頭1件だけadoptして残りを無言で落とす
     * 変異が生存する。
     */
    assert.deepEqual(
      [...result.adopted].sort(),
      [...this.installedAssets].sort(),
      "adoptedが導入済み資産の集合と一致しません",
    );
    assert.deepEqual(result.retained, []);
    const preview = this.recoveryPreview;
    assert.ok(preview, "preview結果がありません");
    assert.equal(preview.applied, false);
    assert.ok(
      preview.adopted.length > 0,
      "previewが正本一致資産をadoptedとして報告していません",
    );
    assert.deepEqual(
      [...preview.adopted].sort(),
      [...result.adopted].sort(),
      "previewとapplyのadopted集合が一致しません",
    );
    assert.deepEqual(preview.retained, []);
    const files = recordFiles(readObject(recordPath(this.root)));
    assert.deepEqual(
      Object.keys(files).sort(),
      [...this.installedAssets].sort(),
      "recordのkey集合が導入済み資産の集合と一致しません",
    );
    /**
     * **登録digestが実測値であることを1件ずつ確かめる。** 正本のdigestで
     * 代替すると、展開先が別内容でも管理済みとして登録されうる。
     */
    for (const [relative, recorded] of Object.entries(files))
      assert.equal(
        recorded,
        sha256(fs.readFileSync(path.join(this.root, relative))),
        `${relative}: recordのdigestが展開先の実測値と一致しません`,
      );
  },
);

Then("相違資産はretainedとして報告され内容は1 byteも変わらない", function () {
  const result = this.recoveryResult;
  assert.ok(result, "復旧結果がありません");
  assert.equal(result.applied, true);
  assert.ok(
    result.retained.includes(DIVERGENT_ASSET),
    `retainedへ${DIVERGENT_ASSET}が含まれていません: ${result.retained.join(", ")}`,
  );
  const before = this.digestsBeforeRecovery?.[DIVERGENT_ASSET];
  assert.ok(before, "復旧前のdigestがありません");
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, DIVERGENT_ASSET))),
    before,
    `${DIVERGENT_ASSET}が上書きされました`,
  );
  const preview = this.recoveryPreview;
  assert.ok(preview, "preview結果がありません");
  assert.ok(
    preview.retained.includes(DIVERGENT_ASSET),
    `previewのretainedへ${DIVERGENT_ASSET}が含まれていません: ${preview.retained.join(", ")}`,
  );
  /**
   * **混在状態の採用側も固定する**（Issue #1305、F-05）。
   * 相違が1件でもあればadoptを全部止める変異は、保持側だけの検査では生存する。
   */
  assert.deepEqual(
    [...result.adopted].sort(),
    this.installedAssets.filter((asset) => asset !== DIVERGENT_ASSET).sort(),
    "相違資産を除いた全資産がadoptedになっていません",
  );
  /** 保持した資産をrecordへ管理済みとして登録しない。 */
  const files = recordFiles(readObject(recordPath(this.root)));
  assert.equal(
    Object.hasOwn(files, DIVERGENT_ASSET),
    false,
    `保持した${DIVERGENT_ASSET}がrecordへ登録されています`,
  );
});

Then("拒否理由はupdateを名指しし名指しされたupdateは成功する", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.equal(rejections.length, 2);
  for (const [index, message] of rejections.entries()) {
    assert.notEqual(message, "", `${index}件目が拒否されていません`);
    assert.match(
      message,
      /update/u,
      `${index}件目の拒否理由がupdateを名指ししていません: ${message}`,
    );
    /** **拒否される手段を案内しない。** installを名指しすると閉路になる。 */
    assert.doesNotMatch(
      message,
      /先にinstallを実行してください/u,
      `${index}件目が拒否されるinstallを案内しています: ${message}`,
    );
  }
  const result = this.recoveryResult;
  assert.ok(result, "名指しされたupdateの結果がありません");
  assert.equal(
    result.applied,
    true,
    "拒否理由が名指しした手段が成功していません",
  );
});

Then("directoryの展開先はretainedとして残る", function () {
  const result = this.recoveryResult;
  assert.ok(result, "復旧結果がありません");
  assert.equal(result.applied, true);
  assert.ok(
    result.retained.includes(NON_REGULAR_TARGETS[0]),
    `retainedへ${NON_REGULAR_TARGETS[0]}が含まれていません: ${result.retained.join(", ")}`,
  );
  assert.equal(
    fs.lstatSync(path.join(this.root, NON_REGULAR_TARGETS[0])).isDirectory(),
    true,
    `${NON_REGULAR_TARGETS[0]}がdirectoryのまま残っていません`,
  );
  /** 保持した非通常fileをrecordへ管理済みとして登録しない。 */
  const files = recordFiles(readObject(recordPath(this.root)));
  assert.equal(
    Object.hasOwn(files, NON_REGULAR_TARGETS[0]),
    false,
    `保持した${NON_REGULAR_TARGETS[0]}がrecordへ登録されています`,
  );
});

/**
 * 境界外へ向くsymlinkは`retain`ではなく**操作全体の拒否**である（Issue #1305、DISC-001）。
 *
 * `mappings`が展開先を解決する時点で`resolveContained`が拒否するため、分類へ
 * 到達しない。**「1 fileも書かない」はこちらのほうが強い。**
 */
When("展開先を境界外symlinkへ差し替えてupdateを試みる", function () {
  const outside = this.outsideTarget;
  assert.ok(outside, "境界外の参照先がありません");
  const asSymlink = path.join(this.root, NON_REGULAR_TARGETS[1]);
  fs.rmSync(asSymlink, { recursive: true, force: true });
  fs.symlinkSync(outside.file, asSymlink);
  /**
   * **1つ目のupdateがrecordを再固定しているのでrecord不在へ戻す**
   * （Issue #1305、F-07）。scenario名が言う状態と測る状態を一致させる。
   */
  dropRecord(this.root);
  /**
   * **拒否前の管理資産のdigestを取る**（Issue #1305、R1305-09）。
   * 「1 fileも書かない」を境界外fileの内容だけで観測すると、内部資産を
   * 先に書いてから境界外errorを返す実装でも通ってしまう。
   */
  this.digestsBeforeRecovery = {
    [DIVERGENT_ASSET]: sha256(
      fs.readFileSync(path.join(this.root, DIVERGENT_ASSET)),
    ),
  };
  this.recoveryRejections = [];
  try {
    upgrade(this.root, { apply: true });
    this.recoveryRejections.push("");
  } catch (error) {
    this.recoveryRejections.push(
      error instanceof Error ? error.message : String(error),
    );
  }
});

Then("updateは境界外移動を拒否し境界外のfileへ書き込まない", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.equal(rejections.length, 1);
  assert.notEqual(rejections[0], "", "境界外symlinkが拒否されていません");
  assert.match(
    String(rejections[0]),
    /シンボリックリンクによる境界外移動を拒否しました/u,
    `境界外移動の拒否理由ではありません: ${String(rejections[0])}`,
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "境界外の参照先がありません");
  assert.equal(
    fs.readFileSync(outside.file, "utf8"),
    outside.contents,
    "境界外のfileへ書き込みました",
  );
  /** symlink自体の保持と、recordを書いていないこと、管理資産の不変。 */
  assert.equal(
    fs.lstatSync(path.join(this.root, NON_REGULAR_TARGETS[1])).isSymbolicLink(),
    true,
    `${NON_REGULAR_TARGETS[1]}のsymlinkが置換されました`,
  );
  assert.equal(
    fs.existsSync(recordPath(this.root)),
    false,
    "境界外拒否の前にrecordを書き込みました",
  );
  const before = this.digestsBeforeRecovery;
  assert.ok(before, "拒否前のdigestがありません");
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, DIVERGENT_ASSET))),
    before[DIVERGENT_ASSET],
    "境界外拒否の前に管理資産へ書き込みました",
  );
});

/**
 * review findingへの回帰（Issue #1305、R1305-01〜06）。
 *
 * **recordの「不在」はdirectory entryの不在である。** link先を解決する判定を
 * 使うと、dangling symlinkが不在に見えてsymlinkごと置換される。
 */
Given(
  "導入後にrecordを境界外を指すdangling symlinkへ置き換えた隔離先がある",
  function () {
    installedIsolation(this, "asc-lifecycle-record-dangling-");
    const outsideDirectory = this.temp("asc-lifecycle-dangling-target-");
    const missing = path.join(outsideDirectory, "存在しない.json");
    fs.rmSync(recordPath(this.root));
    fs.symlinkSync(missing, recordPath(this.root));
    this.outsideTarget = { file: missing, contents: "" };
  },
);

Given("導入後にrecordをJSONとして壊した隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-record-corrupt-");
  fs.writeFileSync(recordPath(this.root), "{ これはJSONではない ");
  this.digestsBeforeRecovery = {
    [".agent-skill-chain/managed-assets.json"]: sha256(
      fs.readFileSync(recordPath(this.root)),
    ),
  };
});

When("record不在の隔離先へupdateを試みる", function () {
  this.recoveryRejections = [];
  try {
    upgrade(this.root, { apply: true });
    this.recoveryRejections.push("");
  } catch (error) {
    this.recoveryRejections.push(
      error instanceof Error ? error.message : String(error),
    );
  }
});

Then("updateは書き込まず拒否しrecordのsymlinkは保持される", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(
    rejections[0],
    "",
    "dangling symlinkのrecordが拒否されていません",
  );
  assert.equal(
    fs.lstatSync(recordPath(this.root)).isSymbolicLink(),
    true,
    "recordのsymlinkが通常fileへ置換されました",
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "symlinkの参照先がありません");
  assert.equal(
    fs.existsSync(outside.file),
    false,
    "symlinkの参照先へ書き込みました",
  );
});

Then("updateは書き込まず拒否しrecordの内容は変わらない", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(rejections[0], "", "壊れたrecordが拒否されていません");
  const before =
    this.digestsBeforeRecovery?.[".agent-skill-chain/managed-assets.json"];
  assert.ok(before, "復旧前のdigestがありません");
  assert.equal(
    sha256(fs.readFileSync(recordPath(this.root))),
    before,
    "壊れたrecordが書き換えられました",
  );
});

Given("導入後にrecordを失い正本一致資産だけを持つ隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-toctou-");
  dropRecord(this.root);
});

/**
 * applyのTOCTOU再観測を強制する（R1305-03）。
 *
 * **製品APIへ注入口を足さない。** `node:fs`のmethodをtest内で一時的に差し替え、
 * `finally`で必ず戻す。`upgrade`は`fs.mkdirSync`を各itemの直前に呼ぶため、
 * ここでpreview後の状態変化を作れる。
 */
When("apply中に展開先の内容を変えてupdateを適用する", function () {
  const target = path.join(this.root, DIVERGENT_ASSET);
  const original = fs.mkdirSync;
  let mutated = false;
  try {
    (fs as { mkdirSync: typeof fs.mkdirSync }).mkdirSync = ((
      directory: Parameters<typeof fs.mkdirSync>[0],
      options?: Parameters<typeof fs.mkdirSync>[1],
    ) => {
      const result = original(directory, options);
      if (!mutated && fs.existsSync(target)) {
        mutated = true;
        fs.appendFileSync(target, "\napply中の変更\n");
      }
      return result;
    }) as typeof fs.mkdirSync;
    this.recoveryResult = upgrade(this.root, { apply: true });
  } finally {
    (fs as { mkdirSync: typeof fs.mkdirSync }).mkdirSync = original;
  }
  assert.equal(mutated, true, "apply中の変更を注入できていません");
  this.digestsBeforeRecovery = {
    [DIVERGENT_ASSET]: sha256(fs.readFileSync(target)),
  };
});

Then("変更された展開先はretainedとして残りrecordへ登録されない", function () {
  const result = this.recoveryResult;
  assert.ok(result, "復旧結果がありません");
  assert.equal(result.applied, true);
  assert.ok(
    result.retained.includes(DIVERGENT_ASSET),
    `retainedへ${DIVERGENT_ASSET}が含まれていません: ${result.retained.join(", ")}`,
  );
  const files = recordFiles(readObject(recordPath(this.root)));
  assert.equal(
    Object.hasOwn(files, DIVERGENT_ASSET),
    false,
    `apply中に変わった${DIVERGENT_ASSET}がrecordへ登録されています`,
  );
});

Given("導入後にrecordと展開済み資産1件を失った隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-place-digest-");
  fs.rmSync(path.join(this.root, DIVERGENT_ASSET));
  dropRecord(this.root);
});

/**
 * 実測digest登録を強制する（R1305-04）。
 *
 * `copyFileSync`直後にdestへ追記すると、`digest(item.src)`を登録する実装では
 * record値がdestの実測値と食い違う。**INV-04をここで名指しで固定する。**
 */
When("copy直後に配置先へ追記してupdateを適用する", function () {
  const target = path.join(this.root, DIVERGENT_ASSET);
  const original = fs.copyFileSync;
  let appended = false;
  try {
    (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((
      source: Parameters<typeof fs.copyFileSync>[0],
      destination: Parameters<typeof fs.copyFileSync>[1],
      mode?: Parameters<typeof fs.copyFileSync>[2],
    ) => {
      original(source, destination, mode);
      if (!appended && String(destination) === target) {
        appended = true;
        fs.appendFileSync(target, "\ncopy直後の追記\n");
      }
    }) as typeof fs.copyFileSync;
    this.recoveryResult = upgrade(this.root, { apply: true });
  } finally {
    (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = original;
  }
  assert.equal(appended, true, "copy直後の追記を注入できていません");
});

Then("recordの登録digestは追記後の展開先の実測値と一致する", function () {
  const result = this.recoveryResult;
  assert.ok(result, "復旧結果がありません");
  assert.equal(result.applied, true);
  const files = recordFiles(readObject(recordPath(this.root)));
  const recorded = files[DIVERGENT_ASSET];
  assert.ok(
    typeof recorded === "string",
    `${DIVERGENT_ASSET}がrecordへ登録されていません`,
  );
  const measured = sha256(
    fs.readFileSync(path.join(this.root, DIVERGENT_ASSET)),
  );
  assert.equal(
    recorded,
    measured,
    `recordのdigestが展開先の実測値と一致しません。正本のdigestで代替していないかを確認してください`,
  );
});

/**
 * 拒否の連鎖が閉路にならないことを固定する（Issue #1305、R1305-02）。
 *
 * **是正した欠陥は「閉路」である。** `update`が`install`を名指しし、その
 * `install`が`update`不要の同じ状態で拒否して元へ戻る形だった。境界外symlinkが
 * ある状態では`update`も拒否するが、**その理由は別の原因を名指しし、同じ拒否へ
 * 戻らない。** ここで固定するのは「成功」ではなく「進行」である。
 */
Given(
  "導入後にrecordを失い展開済み資産が境界外symlinkの隔離先がある",
  function () {
    installedIsolation(this, "asc-lifecycle-chain-");
    const outsideDirectory = this.temp("asc-lifecycle-chain-target-");
    const outside = path.join(outsideDirectory, "境界外.md");
    fs.writeFileSync(outside, "# 境界外\n");
    this.outsideTarget = { file: outside, contents: "# 境界外\n" };
    const asSymlink = path.join(this.root, NON_REGULAR_TARGETS[1]);
    fs.rmSync(asSymlink);
    fs.symlinkSync(outside, asSymlink);
    dropRecord(this.root);
  },
);

When("deleteが名指しした手段を順に実行する", function () {
  const rejections: string[] = [];
  for (const attempt of [
    () => uninstall(this.root, { apply: true }),
    () => upgrade(this.root, { apply: true }),
  ]) {
    try {
      attempt();
      rejections.push("");
    } catch (error) {
      rejections.push(error instanceof Error ? error.message : String(error));
    }
  }
  this.recoveryRejections = rejections;
});

Then("2つ目の拒否は1つ目と別の原因を名指しし同じ拒否へ戻らない", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.equal(rejections.length, 2);
  const [first, second] = rejections;
  assert.notEqual(first, "", "deleteが拒否されていません");
  assert.match(
    String(first),
    /update/u,
    `1つ目が次の手段を名指ししていません: ${String(first)}`,
  );
  assert.notEqual(second, "", "updateが拒否されていません");
  /** **同じ拒否へ戻らないこと。** 閉路の不在をここで固定する。 */
  assert.notEqual(
    second,
    first,
    "2つ目の拒否が1つ目と同一であり閉路になっています",
  );
  assert.doesNotMatch(
    String(second),
    /先にinstallを実行してください/u,
    `2つ目が拒否されるinstallへ戻しています: ${String(second)}`,
  );
  assert.match(
    String(second),
    /シンボリックリンクによる境界外移動を拒否しました/u,
    `2つ目が別の原因を名指ししていません: ${String(second)}`,
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "境界外の参照先がありません");
  assert.equal(
    fs.readFileSync(outside.file, "utf8"),
    outside.contents,
    "境界外のfileへ書き込みました",
  );
});

/**
 * record不在の受理範囲の境界（Issue #1305、F-01）。
 *
 * **record不在は「導入済み」の代わりにならない。** 展開済み資産が0件の
 * directoryも同じ状態に含めると、`update --apply`が`install`と同じ書き込みを
 * 行う。是正前の`upgrade`はrecord不在で拒否していたため、これは本変更が
 * 到達可能にしうる書き込みである。
 */
Given("ASCを一度も導入していない隔離directoryがある", function () {
  this.root = this.temp("asc-lifecycle-never-installed-");
  write(this.root, "README.md", "# fixture\n");
  this.consumerFiles = { "README.md": "# fixture\n" };
  this.installedAssets = [];
});

Then(
  "updateは1 fileも書かずinstallを名指しして拒否し名指しされたinstallは成功する",
  function () {
    const rejections = this.recoveryRejections;
    assert.ok(rejections, "拒否理由がありません");
    assert.notEqual(
      rejections[0],
      "",
      "未導入directoryのupdateが拒否されていません",
    );
    assert.match(
      String(rejections[0]),
      /install/u,
      `拒否理由がinstallを名指ししていません: ${String(rejections[0])}`,
    );
    /** **1 fileも書かない。** README.md以外が現れていないことで観測する。 */
    const entries = fs
      .readdirSync(this.root)
      .filter((entry) => entry !== ".git")
      .sort();
    assert.deepEqual(
      entries,
      ["README.md"],
      `updateが未導入directoryへ書き込みました: ${entries.join(", ")}`,
    );
    assert.equal(fs.existsSync(recordPath(this.root)), false);
    /** 名指しした手段が同じ状態で成功すること。 */
    const installed = init(this.root, { apply: true });
    assert.ok(
      installed.assets.length > 0,
      "名指しされたinstallが資産を配置していません",
    );
    assert.equal(fs.existsSync(recordPath(this.root)), true);
  },
);
