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
  doctorResult?: ReturnType<typeof doctor>;
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
  /** record不正の各分類の観測（Issue #1305、R2-M01）。 */
  invalidRecordCases?: Array<{
    label: string;
    root: string;
    recordDigest: string | undefined;
    assetDigest: string;
  }>;
  invalidRecordRejections?: string[];
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

/**
 * **許容する診断文そのものを1つに固定する**（Issue #1305、codex Medium 3）。
 *
 * 前版は`/install/`・`/update/`のような**禁止語の列挙**で守っていた。これは必ず漏れる。
 * codexとfableが独立に反例を出した。`src/cli-contract.ts`の`LEGACY_LIFECYCLE_ALIASES`
 * （`init`・`upgrade`・`uninstall`）はCLIが現に受理するので「`upgrade`に
 * `--recover-record`を付けてください」は生存し、`delete`・`doctor`も生存し、
 * 大小文字を変えた`Update`も生存し、「ASCが入っていません」「初期導入が済んで
 * いません」のような状態断定の言い換えも生存した。
 *
 * **禁止語を数え上げるのをやめ、許容文面との完全一致で固定する。** 何を足しても、
 * どう言い換えても、文面が変われば落ちる。動的部分は原因と対象pathだけであり、
 * それらもtest側で**literalに書き下す**（実装から導出しない）。
 */
const ABSENT_PREFIX = "managed asset recordがありません。";
const DELETE_ABSENT_PREFIX =
  "managed asset recordがありません。撤去対象を確定できません。";
const MINIMAL_TAIL =
  "復旧するには update に --recover-record が必要です。手順は配布される利用案内を参照してください";
const CONFLICT_PREFIX =
  "初期導入先が競合しています。ファイルは書き込んでいません: ";

/**
 * 境界外symlinkの原因文。**対象pathを含む**（Issue #1305、fable H-2）。
 *
 * `NON_REGULAR_TARGETS`はこの下で宣言されるため、**定数ではなく関数にする。**
 * top-levelの`const`にすると読み込み順でtemporal dead zoneに入る。
 */
function outsideCause(): string {
  return `シンボリックリンクによる境界外移動を拒否しました: ${NON_REGULAR_TARGETS[1]}`;
}

function blockedTail(cause: string): string {
  return `この状態では --recover-record を付けても次の理由で拒否されます: ${cause}。先にこの原因を解消してください`;
}

/**
 * 診断文が許容形と**完全一致**することを固定する。
 *
 * `assert.equal`なので、末尾へ助言を1語足しただけでも落ちる。`doesNotMatch`の
 * 列挙と違い、**列挙漏れという失敗様式そのものが無い。**
 */
function assertDiagnosticIsExactly(
  message: string,
  expected: string,
  label: string,
): void {
  assert.equal(
    message,
    expected,
    `${label}の診断文が許容形と完全一致しません。\n実際: ${message}\n許容: ${expected}`,
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
  this.recoveryPreview = upgrade(this.root, {
    apply: false,
    recoverRecord: true,
  });
  this.recoveryResult = upgrade(this.root, {
    apply: true,
    recoverRecord: true,
  });
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
  this.recoveryResult = upgrade(this.root, {
    apply: true,
    recoverRecord: true,
  });
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

/**
 * **復旧の帰結を後から見えるようにする**（Issue #1314）。
 *
 * `retained`はrecordへ登録しないので、当該資産は以後`update`の対象から外れる。
 * 正しい設計だが帰結が見えないため、`doctor`が報告する。**門は足さない。**
 */
When("明示指定つきで復旧してからdoctorを実行する", function () {
  upgrade(this.root, { apply: true, recoverRecord: true });
  this.doctorResult = doctor(this.root);
});

Then(
  "doctorはhealthyを変えず管理対象外の資産を件数と対処つきで報告する",
  function () {
    const result = this.doctorResult;
    assert.ok(result, "doctor結果がありません");
    const unmanaged = result.unmanagedAssets;
    assert.ok(unmanaged, "unmanagedAssetsがありません");
    assert.ok(
      unmanaged.paths.length > 0,
      "相違資産があるのに管理対象外として報告していません",
    );
    assert.ok(
      unmanaged.paths.includes(DIVERGENT_ASSET),
      `保持した${DIVERGENT_ASSET}を報告していません: ${unmanaged.paths.join(", ")}`,
    );
    /** **次に採る行動まで出す。** 件数だけでは利用者が動けない。 */
    assert.match(
      String(unmanaged.note),
      /update の対象にならず/u,
      `帰結を述べていません: ${String(unmanaged.note)}`,
    );
    assert.match(
      String(unmanaged.note),
      /--recover-record/u,
      `次に採る行動を出していません: ${String(unmanaged.note)}`,
    );
    /**
     * **報告するが`healthy`を変えない。**
     * 管理対象外という事実そのものは`healthy`を落とす診断へ入れない。
     * 入れると門になり、復旧直後の正常な状態を異常として扱ってしまう。
     */
    for (const diagnostic of result.adapters.diagnostics)
      assert.doesNotMatch(
        String(diagnostic),
        /managed recordに無い|管理対象外/u,
        `管理対象外の報告をhealthyの要因にしています: ${String(diagnostic)}`,
      );
  },
);

Then("拒否理由は最小診断だけを返す", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.equal(rejections.length, 2);
  const [conflict, absent] = rejections;
  /**
   * **callerごとに主張が違う**（Issue #1305、#1310へ分離）。
   *
   * 1本のcaller非依存な文字列を3 callerへ連結する構造が、4ラウンド連続でHighを
   * 生んだ。`init`の競合は競合pathだけを述べ、復旧手段を案内しない。案内すると
   * いま拒否した`install`を再び名指しする閉路になる。
   */
  assert.notEqual(conflict, "", "installが拒否されていません");
  assert.match(
    String(conflict),
    /初期導入先が競合しています。ファイルは書き込んでいません:/u,
    `競合pathを述べていません: ${String(conflict)}`,
  );
  assert.doesNotMatch(
    String(conflict),
    /--recover-record|--dry-run|--apply|配置予定/u,
    `競合拒否へ復旧手段を連結しています: ${String(conflict)}`,
  );
  /**
   * **`install`という語の不在も固定する。** 競合拒否へ「一度も導入していない場合は
   * install を使ってください」を連結する変異は、flag名や手順語の禁止では捕まらない。
   * いま拒否した`install`を再び名指しすれば閉路である。
   */
  /**
   * **競合拒否は競合pathだけを述べる。** 完全一致なので、commandの名指し・手順・
   * 状態の断定を1語でも足せば落ちる。競合するのは乖離させた1資産だけである
   * （正本とbyte一致する資産は競合しない）。
   */
  assertDiagnosticIsExactly(
    String(conflict),
    `${CONFLICT_PREFIX}${path.join(this.root, DIVERGENT_ASSET)}`,
    "installの競合拒否",
  );
  /** `delete`のrecord不在は最小診断だけを返す。 */
  assert.notEqual(absent, "", "deleteが拒否されていません");
  /**
   * **所属commandを名指しすること**（Issue #1305、fable H-01）。
   *
   * `--recover-record`は`update`のflagであって`delete`のflagではない。**CLIは宣言外の
   * flagを黙って捨てる**ため、flag名だけを返すと`delete --recover-record --apply`が
   * byte一致の拒否を返し、誤ったcommandを使ったという信号が出ない。**それは本Issueが
   * 断とうとしている閉路と同型である。** previewが成功した経路なのでINV-02に適合する。
   */
  assertDiagnosticIsExactly(
    String(absent),
    `${DELETE_ABSENT_PREFIX}${MINIMAL_TAIL}`,
    "deleteのrecord不在拒否",
  );
  assert.doesNotMatch(
    String(absent),
    /--dry-run|--apply|配置予定/u,
    `手順または内訳を含みます: ${String(absent)}`,
  );
  /** 明示指定つきの復旧が同じ状態で成功すること。 */
  const result = this.recoveryResult;
  assert.ok(result, "復旧結果がありません");
  assert.equal(result.applied, true, "明示指定つきの復旧が成功していません");
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
    upgrade(this.root, { apply: true, recoverRecord: true });
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
  /**
   * **診断を名指しする**（Issue #1305、M-A8）。不在判定を`existsSync`へ戻すと
   * dangling symlinkが不在に見え、**公開直前の再検証まで検出が遅れる。**
   * どちらでも拒否はされるが、捕まえる層が違う。読み取り時に捕まえることを固定する。
   */
  assert.match(
    String(rejections[0]),
    /managed asset recordは通常fileでなければなりません: \.agent-skill-chain\/managed-assets\.json/u,
    `読み取り時の診断が対象pathを名指ししていません: ${String(rejections[0])}`,
  );
  assert.doesNotMatch(
    String(rejections[0]),
    /公開先が通常fileではありません/u,
    `不在判定をすり抜けて公開直前の検証で捕まえています: ${String(rejections[0])}`,
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
    this.recoveryResult = upgrade(this.root, {
      apply: true,
      recoverRecord: true,
    });
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
    this.recoveryResult = upgrade(this.root, {
      apply: true,
      recoverRecord: true,
    });
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

When("deleteを試みてから同じ状態でupdateも試みる", function () {
  const rejections: string[] = [];
  for (const attempt of [
    () => uninstall(this.root, { apply: true }),
    () => upgrade(this.root, { apply: true, recoverRecord: true }),
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

Then(
  "deleteの拒否理由はupdateを手段として案内せず解消すべき原因を名指しする",
  function () {
    const rejections = this.recoveryRejections;
    assert.ok(rejections, "拒否理由がありません");
    assert.equal(rejections.length, 2);
    const [first, second] = rejections;
    assert.notEqual(first, "", "deleteが拒否されていません");
    /**
     * **成功しない手段を名指ししない**（Issue #1305、codex Medium 3）。
     *
     * この状態ではpreviewが拒否されるので、どのcommandも手段として名指しできない。
     * 旧版は`/次にupdateを実行してください/`という**字面**で禁じていたため、
     * 「update を使ってください」へ言い換えるだけで空虚化した。語で禁じる。
     */
    assertDiagnosticIsExactly(
      String(first),
      `${DELETE_ABSENT_PREFIX}${blockedTail(outsideCause())}`,
      "blocked分岐のdelete拒否",
    );
    /** 解消すべき原因を名指ししていること。 */
    assert.match(
      String(first),
      /シンボリックリンクによる境界外移動を拒否しました/u,
      `解消すべき原因を名指ししていません: ${String(first)}`,
    );
    assert.match(
      String(first),
      /先にこの原因を解消してください/u,
      `原因の解消を求めていません: ${String(first)}`,
    );
    /** 案内が正しいこと。実際に同じ状態のupdateは拒否される。 */
    assert.notEqual(second, "", "updateが拒否されていません");
    assert.match(
      String(second),
      /シンボリックリンクによる境界外移動を拒否しました/u,
      `updateの拒否理由が原因を示していません: ${String(second)}`,
    );
    const outside = this.outsideTarget;
    assert.ok(outside, "境界外の参照先がありません");
    assert.equal(
      fs.readFileSync(outside.file, "utf8"),
      outside.contents,
      "境界外のfileへ書き込みました",
    );
  },
);

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
  "updateは1 fileも書かず明示指定を要求して拒否しinstallは名指しされないまま別途成功する",
  function () {
    const rejections = this.recoveryRejections;
    assert.ok(rejections, "拒否理由がありません");
    assert.notEqual(
      rejections[0],
      "",
      "未導入directoryのupdateが拒否されていません",
    );
    /**
     * **`update`の拒否文は`install`を名指ししない**（Issue #1305、fable F-03）。
     * 導入済み＋record喪失＋相違資産の状態では`install`は競合で拒否されるため、
     * 無条件に名指しすると「成功しない手段の名指し」になる。**完全一致なので
     * `install`に限らずどのcommandを足しても落ちる。**
     */
    assertDiagnosticIsExactly(
      String(rejections[0]),
      `${ABSENT_PREFIX}${MINIMAL_TAIL}`,
      "未導入directoryのupdate拒否",
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

/**
 * record不正の分類を網羅する（Issue #1305、R2-M01）。
 *
 * **JSON構文不正だけでは足りない。** `readManagedAssetRecord`はdigest不正、
 * 正規化後のpath重複、非通常fileも拒否する。**errorの種別だけをcatchして
 * 一部を空recordへ降格させる変異**は、構文不正の1件では捕まらない。
 */
const INVALID_RECORDS: readonly {
  label: string;
  write: (file: string) => void;
}[] = [
  {
    label: "JSON構文不正",
    write: (file) => fs.writeFileSync(file, "{ これはJSONではない "),
  },
  {
    label: "digestがSHA-256でない",
    write: (file) =>
      fs.writeFileSync(
        file,
        `${JSON.stringify({ version: "x", files: { "AGENTS.md": "短すぎる" } }, null, 2)}\n`,
      ),
  },
  {
    label: "正規化後のpathが重複する",
    write: (file) =>
      fs.writeFileSync(
        file,
        `${JSON.stringify(
          {
            version: "x",
            files: {
              "AGENTS.md": "a".repeat(64),
              "AGENTS.md\\": "b".repeat(64),
            },
          },
          null,
          2,
        )}\n`,
      ),
  },
  {
    label: "filesがobjectでない",
    write: (file) =>
      fs.writeFileSync(
        file,
        `${JSON.stringify({ version: "x", files: [] }, null, 2)}\n`,
      ),
  },
  {
    label: "recordが通常fileでない",
    write: (file) => {
      fs.mkdirSync(file, { recursive: true });
    },
  },
];

interface InvalidRecordCase {
  label: string;
  root: string;
  recordDigest: string | undefined;
  assetDigest: string;
}

Given("導入後にrecordを不正な各分類へ壊した隔離先の一覧がある", function () {
  const cases: InvalidRecordCase[] = [];
  for (const invalid of INVALID_RECORDS) {
    const root = this.temp("asc-lifecycle-invalid-record-");
    write(root, "README.md", "# fixture\n");
    init(root, { apply: true });
    fs.rmSync(recordPath(root));
    invalid.write(recordPath(root));
    cases.push({
      label: invalid.label,
      root,
      recordDigest: fs.lstatSync(recordPath(root)).isFile()
        ? sha256(fs.readFileSync(recordPath(root)))
        : undefined,
      assetDigest: sha256(fs.readFileSync(path.join(root, DIVERGENT_ASSET))),
    });
  }
  assert.equal(cases.length, INVALID_RECORDS.length);
  this.invalidRecordCases = cases;
});

When("各不正recordの隔離先へupdateを試みる", function () {
  const cases = this.invalidRecordCases;
  assert.ok(cases, "不正recordの一覧がありません");
  this.invalidRecordRejections = cases.map((entry) => {
    try {
      upgrade(entry.root, { apply: true });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
});

Then("いずれも書き込まず拒否しrecordと管理資産は不変である", function () {
  const cases = this.invalidRecordCases;
  const rejections = this.invalidRecordRejections;
  assert.ok(cases && rejections, "観測がありません");
  assert.equal(rejections.length, cases.length);
  for (const [index, entry] of cases.entries()) {
    assert.notEqual(
      rejections[index],
      "",
      `${entry.label}: 不正recordが拒否されていません`,
    );
    if (entry.recordDigest !== undefined)
      assert.equal(
        sha256(fs.readFileSync(recordPath(entry.root))),
        entry.recordDigest,
        `${entry.label}: recordが書き換えられました`,
      );
    else
      assert.equal(
        fs.lstatSync(recordPath(entry.root)).isDirectory(),
        true,
        `${entry.label}: 非通常fileのrecordが置換されました`,
      );
    assert.equal(
      sha256(fs.readFileSync(path.join(entry.root, DIVERGENT_ASSET))),
      entry.assetDigest,
      `${entry.label}: 管理資産が書き換えられました`,
    );
  }
});

/**
 * 導入証拠の由来を判別する（Issue #1305、R2-H01）。
 *
 * `AGENTS.md`と`CLAUDE.md`はrepository直下の一般的なfile名であり、
 * **利用者が自分で所有しうる。** 同名entryが1件あることを導入の証拠にすると、
 * 未導入projectがfull installへ倒れる。
 */
Given(
  "未導入directoryに利用者所有のAGENTS.mdだけがある隔離先がある",
  function () {
    this.root = this.temp("asc-lifecycle-user-agents-");
    const contents = "# 利用者が自分で書いたAGENTS.md\n";
    write(this.root, "AGENTS.md", contents);
    this.consumerFiles = { "AGENTS.md": contents };
    this.installedAssets = [];
  },
);

Given(
  "未導入directoryに正本とbyte一致するAGENTS.mdだけがある隔離先がある",
  function () {
    this.root = this.temp("asc-lifecycle-identical-agents-");
    /**
     * **正本と偶然byte一致する同名fileも証拠にしない。** 一致していても
     * 導入した事実を示さない。
     */
    const canonical = fs.readFileSync(
      path.join(process.cwd(), "AGENTS.md"),
      "utf8",
    );
    write(this.root, "AGENTS.md", canonical);
    this.consumerFiles = { "AGENTS.md": canonical };
    this.installedAssets = [];
  },
);

Then(
  "updateは1 fileも書かず明示指定を要求して拒否し利用者のfileは不変である",
  function () {
    const rejections = this.recoveryRejections;
    assert.ok(rejections, "拒否理由がありません");
    assert.notEqual(rejections[0], "", "未導入directoryが拒否されていません");
    assertDiagnosticIsExactly(
      String(rejections[0]),
      `${ABSENT_PREFIX}${MINIMAL_TAIL}`,
      "明示指定なしのupdate拒否",
    );
    const entries = fs
      .readdirSync(this.root)
      .filter((entry) => entry !== ".git")
      .sort();
    assert.deepEqual(
      entries,
      ["AGENTS.md"],
      `updateが未導入directoryへ書き込みました: ${entries.join(", ")}`,
    );
    assertCapturedFiles(this.root, this.consumerFiles);
  },
);

Then("updateは1 fileも書かず明示指定を要求して拒否する", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(rejections[0], "", "未導入directoryが拒否されていません");
  assertDiagnosticIsExactly(
    String(rejections[0]),
    `${ABSENT_PREFIX}${MINIMAL_TAIL}`,
    "明示指定なしのupdate拒否",
  );
  const entries = fs
    .readdirSync(this.root)
    .filter((entry) => entry !== ".git")
    .sort();
  assert.deepEqual(
    entries,
    ["AGENTS.md"],
    `updateが未導入directoryへ書き込みました: ${entries.join(", ")}`,
  );
});

/**
 * record公開直前のentry差し替えを検出する（Issue #1305、R2-H02）。
 *
 * 静止状態のsymlinkはSCN-022が測る。**こちらは実行開始後に現れる場合である。**
 * `copyFileSync`のseamで、分類の後・record公開の前にsymlinkを挿入する。
 */
When(
  "資産のcopy直後にrecord公開先へsymlinkを挿入してupdateを試みる",
  function () {
    const outsideDirectory = this.temp("asc-lifecycle-publish-target-");
    const missing = path.join(outsideDirectory, "存在しない.json");
    this.outsideTarget = { file: missing, contents: "" };
    const original = fs.copyFileSync;
    let injected = false;
    this.recoveryRejections = [];
    try {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((
        source: Parameters<typeof fs.copyFileSync>[0],
        destination: Parameters<typeof fs.copyFileSync>[1],
        mode?: Parameters<typeof fs.copyFileSync>[2],
      ) => {
        original(source, destination, mode);
        if (!injected) {
          injected = true;
          fs.symlinkSync(missing, recordPath(this.root));
        }
      }) as typeof fs.copyFileSync;
      upgrade(this.root, { apply: true, recoverRecord: true });
      this.recoveryRejections.push("");
    } catch (error) {
      this.recoveryRejections.push(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = original;
    }
    assert.equal(injected, true, "公開直前のsymlinkを注入できていません");
  },
);

Then("updateは公開を中止しrecord公開先のsymlinkは保持される", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(
    rejections[0],
    "",
    "公開直前に現れたsymlinkが検出されていません",
  );
  assert.match(
    String(rejections[0]),
    /公開先に別のentryが現れました/u,
    `公開先の検証による拒否ではありません: ${String(rejections[0])}`,
  );
  assert.equal(
    fs.lstatSync(recordPath(this.root)).isSymbolicLink(),
    true,
    "record公開先のsymlinkが置換されました",
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "symlinkの参照先がありません");
  assert.equal(
    fs.existsSync(outside.file),
    false,
    "symlinkの参照先へ書き込みました",
  );
});

/**
 * record復旧の明示指定を要求する（Issue #1305、#1307 案A）。
 *
 * **導入済みであっても、opt-inが無ければ1 fileも書かない。** 推測による導入判定を
 * 撤去したため、意図の宣言だけが復旧の条件である。
 */
When("明示指定なしでrecord不在の隔離先へupdateを試みる", function () {
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

Then("明示指定の要求だけを返しrecordを再生成しない", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(
    rejections[0],
    "",
    "明示指定なしのupdateが拒否されていません",
  );
  assertDiagnosticIsExactly(
    String(rejections[0]),
    `${ABSENT_PREFIX}${MINIMAL_TAIL}`,
    "明示指定なしのupdate拒否",
  );
  /** **recordを再生成しない。** 拒否は状態を変えない。 */
  assert.equal(
    fs.existsSync(recordPath(this.root)),
    false,
    "拒否したのにrecordが再生成されています",
  );
});

/**
 * record既存時の公開先再検証（Issue #1305、R2-H02・M-A11）。
 *
 * **record不在のno-replace公開とは別経路である。** 既存recordの再固定は`rename`で
 * 公開するため、`assertRecordPublishTarget`が直前のentryを検証する。読み取り時点では
 * 通常fileだったものが公開直前にsymlinkへ差し替わる場合を測る。
 */
Given("導入済みで展開済み資産1件を失った隔離先がある", function () {
  installedIsolation(this, "asc-lifecycle-publish-existing-");
  fs.rmSync(path.join(this.root, DIVERGENT_ASSET));
});

When(
  "資産のcopy直後に既存recordをsymlinkへ差し替えてupdateを試みる",
  function () {
    const outsideDirectory = this.temp("asc-lifecycle-existing-target-");
    const missing = path.join(outsideDirectory, "存在しない.json");
    this.outsideTarget = { file: missing, contents: "" };
    const original = fs.copyFileSync;
    let injected = false;
    this.recoveryRejections = [];
    try {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((
        source: Parameters<typeof fs.copyFileSync>[0],
        destination: Parameters<typeof fs.copyFileSync>[1],
        mode?: Parameters<typeof fs.copyFileSync>[2],
      ) => {
        original(source, destination, mode);
        if (!injected) {
          injected = true;
          fs.rmSync(recordPath(this.root));
          fs.symlinkSync(missing, recordPath(this.root));
        }
      }) as typeof fs.copyFileSync;
      upgrade(this.root, { apply: true });
      this.recoveryRejections.push("");
    } catch (error) {
      this.recoveryRejections.push(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = original;
    }
    assert.equal(injected, true, "公開直前の差し替えを注入できていません");
  },
);

Then("updateは公開を中止し既存recordのsymlinkは保持される", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(rejections[0], "", "公開先の差し替えが検出されていません");
  assert.match(
    String(rejections[0]),
    /公開先が通常fileではありません/u,
    `公開先の再検証による拒否ではありません: ${String(rejections[0])}`,
  );
  assert.equal(
    fs.lstatSync(recordPath(this.root)).isSymbolicLink(),
    true,
    "既存recordのsymlinkが置換されました",
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "symlinkの参照先がありません");
  assert.equal(
    fs.existsSync(outside.file),
    false,
    "symlinkの参照先へ書き込みました",
  );
});

/**
 * 決裁されたopt-in門を**配布CLIの合成経路で**固定する（Issue #1305、F-01a・M-02）。
 *
 * **domain関数の引数testでは足りない。** `cli.ts`の`flags["recover-record"] === true`を
 * `true`へ置換すると、配布binではopt-inが既定になり#1307の決裁が無効化される。
 * その変異はdomain層のtestでは1件も落ちない。
 */
When("配布CLIで明示指定なしのupdateとapplyを順に試みる", function () {
  const before = fs
    .readdirSync(this.root)
    .filter((entry) => entry !== ".git")
    .sort();
  /**
   * **値付きの指定をopt-inとして受理しない**（Issue #1305、M-E5）。
   * `--apply`と同じ既存規約である。配線を`!== undefined`へ緩める変異は、
   * `--recover-record=false`でopt-inが成立してしまう。
   */
  this.cliResults = [
    runCli(this.root, ["update", "--dry-run"]),
    runCli(this.root, ["update", "--apply"]),
    runCli(this.root, ["update", "--recover-record=false", "--apply"]),
    runCli(this.root, ["update", "--recover-record=true", "--apply"]),
  ];
  this.consumerFiles = Object.fromEntries(
    before.map((entry) => [entry, entry]),
  );
  this.statusBefore = before.join(",");
});

Then("CLIは非0で終了し明示指定を名指しし1 fileも書かない", function () {
  const results = this.cliResults;
  assert.ok(results, "CLI結果がありません");
  assert.equal(results.length, 4);
  for (const [index, result] of results.entries()) {
    assert.notEqual(
      result.status,
      0,
      `${index}件目のCLIが非0で終了していません: ${result.stdout}${result.stderr}`,
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.match(
      output,
      /--recover-record/u,
      `${index}件目のCLI出力が明示指定を名指ししていません: ${output}`,
    );
  }
  /** **1 fileも書かない。** record再生成もdirectory増加も起きない。 */
  assert.equal(fs.existsSync(recordPath(this.root)), false);
  const after = fs
    .readdirSync(this.root)
    .filter((entry) => entry !== ".git")
    .sort()
    .join(",");
  assert.equal(after, this.statusBefore, "CLIが書き込みました");
});

/**
 * `install`側の公開先再検証（Issue #1305、M-A）。
 *
 * `assertRecordPublishTarget`は本差分で`init`へも入れた新設の防護である。
 * `upgrade`側のSCN-033だけでは`init`の呼び出し行を消す変異が生存する。
 */
When(
  "installの資産copy直後にrecord公開先へsymlinkを挿入して適用する",
  function () {
    const outsideDirectory = this.temp("asc-lifecycle-init-publish-");
    const missing = path.join(outsideDirectory, "存在しない.json");
    this.outsideTarget = { file: missing, contents: "" };
    const original = fs.copyFileSync;
    let injected = false;
    this.recoveryRejections = [];
    try {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((
        source: Parameters<typeof fs.copyFileSync>[0],
        destination: Parameters<typeof fs.copyFileSync>[1],
        mode?: Parameters<typeof fs.copyFileSync>[2],
      ) => {
        original(source, destination, mode);
        if (!injected) {
          injected = true;
          fs.mkdirSync(path.dirname(recordPath(this.root)), {
            recursive: true,
          });
          fs.symlinkSync(missing, recordPath(this.root));
        }
      }) as typeof fs.copyFileSync;
      init(this.root, { apply: true });
      this.recoveryRejections.push("");
    } catch (error) {
      this.recoveryRejections.push(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      (fs as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = original;
    }
    assert.equal(injected, true, "公開直前の挿入を注入できていません");
  },
);

Then("installは公開を中止しrecord公開先のsymlinkは保持される", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  assert.notEqual(rejections[0], "", "公開先の差し替えが検出されていません");
  assert.match(
    String(rejections[0]),
    /公開先が通常fileではありません/u,
    `公開先の再検証による拒否ではありません: ${String(rejections[0])}`,
  );
  assert.equal(
    fs.lstatSync(recordPath(this.root)).isSymbolicLink(),
    true,
    "record公開先のsymlinkが置換されました",
  );
  const outside = this.outsideTarget;
  assert.ok(outside, "symlinkの参照先がありません");
  assert.equal(
    fs.existsSync(outside.file),
    false,
    "symlinkの参照先へ書き込みました",
  );
});

/**
 * opt-inが配布CLIで**実際に効く**ことを固定する（Issue #1305、M-E2）。
 *
 * 拒否側だけを検査すると、配線を常に`false`へ倒す変異が生存する。その変異では
 * #1307で決裁した復旧経路が配布binから到達不能になる。**門が閉じることと、
 * 鍵が開くことの両方を測る。**
 */
When("配布CLIで明示指定つきのupdateを適用する", function () {
  this.cliResults = [
    runCli(this.root, ["update", "--recover-record", "--apply"]),
  ];
});

Then(
  "CLIは0で終了しrecordを再固定し相違資産をretainedとして報告する",
  function () {
    const results = this.cliResults;
    assert.ok(results, "CLI結果がありません");
    assert.equal(results.length, 1);
    const [result] = results;
    assert.ok(result);
    assert.equal(
      result.status,
      0,
      `CLIが0で終了していません: ${result.stdout}${result.stderr}`,
    );
    const parsed: unknown = JSON.parse(result.stdout);
    assert.ok(
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
      "CLI出力がJSON objectではありません",
    );
    const payload = parsed as Record<string, unknown>;
    assert.equal(payload.applied, true);
    assert.ok(
      Array.isArray(payload.retained) &&
        payload.retained.includes(DIVERGENT_ASSET),
      `retainedへ${DIVERGENT_ASSET}が含まれていません: ${result.stdout}`,
    );
    assert.equal(
      fs.existsSync(recordPath(this.root)),
      true,
      "recordが再固定されていません",
    );
    /** 相違資産は上書きされていない。 */
    const before = this.digestsBeforeRecovery?.[DIVERGENT_ASSET];
    assert.ok(before, "復旧前のdigestがありません");
    assert.equal(
      sha256(fs.readFileSync(path.join(this.root, DIVERGENT_ASSET))),
      before,
      `${DIVERGENT_ASSET}が上書きされました`,
    );
  },
);

/**
 * record存在の観測が1回であることを固定する（Issue #1305、codex High 1）。
 *
 * 以前は opt-in 門と record 読み取りで**別々に**観測していた。その間に別processが
 * 有効なrecordを配置すると、新しいrecordのdigestが`expected`として上書き権限を
 * 与え、利用者fileが正本へ上書きされたうえで公開が`EEXIST`で失敗した。
 * **「commandは失敗したのに利用者fileだけ上書き済み」**という状態を作らない。
 */
When("分類の前に有効なrecordが現れる状況でupdateを適用する", function () {
  const target = path.join(this.root, DIVERGENT_ASSET);
  const forged = {
    version: "0.0.0",
    files: { [DIVERGENT_ASSET]: sha256(fs.readFileSync(target)) },
  };
  const record = recordPath(this.root);
  const original = fs.lstatSync;
  let observations = 0;
  this.recoveryRejections = [];
  try {
    /**
     * **record pathへのlstat回数を数え、1回目の直後に有効なrecordを置く**
     * （Issue #1305、codex High 1 / fable H-02）。
     *
     * 是正前は`upgrade`と`readManagedAssetRecordOrEmpty`が**2回**観測しており、
     * 2回目が新しいrecordを見てそのdigestを`expected`として採用し、利用者fileを
     * 正本へ上書きした。是正後は観測が1回なので、後から現れたrecordは分類へ
     * 影響しない。**`fs.readFileSync`への注入では、record不在時に読み取りが
     * 発生しないため区別できない。**
     */
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
      file: Parameters<typeof fs.lstatSync>[0],
      options?: Parameters<typeof fs.lstatSync>[1],
    ) => {
      /**
       * **数えるのはoriginalの前である。** record不在のlstatはENOENTでthrowする
       * ため、後に置くと1回も数えられない。
       */
      const isRecordPath = String(file) === record;
      if (isRecordPath) observations += 1;
      try {
        return original(file, options as never);
      } finally {
        if (isRecordPath && observations === 1)
          fs.writeFileSync(record, `${JSON.stringify(forged, null, 2)}\n`);
      }
    }) as typeof fs.lstatSync;
    this.recoveryResult = upgrade(this.root, {
      apply: true,
      recoverRecord: true,
    });
    this.recoveryRejections.push("");
  } catch (error) {
    this.recoveryRejections.push(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
  }
  assert.ok(observations >= 1, "record pathへのlstatを観測できていません");
  /** **観測回数そのものを固定する。** 2回観測へ戻す変異をここで捕まえる。 */
  assert.equal(
    observations,
    1,
    `record pathの観測が${String(observations)}回あります。1回でなければ後から現れたrecordが分類へ影響します`,
  );
});

Then("相違資産は上書きされずrecordの観測は1回に保たれる", function () {
  const before = this.digestsBeforeRecovery?.[DIVERGENT_ASSET];
  assert.ok(before, "復旧前のdigestがありません");
  /**
   * **これが本scenarioの本体である。** 途中で現れたrecordのdigestを根拠に
   * 上書きしてはならない。
   */
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, DIVERGENT_ASSET))),
    before,
    `${DIVERGENT_ASSET}が途中で現れたrecordを根拠に上書きされました`,
  );
});

/**
 * opt-inつきの**正方向preview**が配布CLIから到達できることを固定する
 * （Issue #1305、codex High 5）。
 *
 * 拒否とapply成功だけを測ると、配線を`apply && flag`へ狭める変異が生存し、
 * **案内した`--dry-run`だけが閉じる。**
 */
When("配布CLIで明示指定つきのdry-runと既定previewを試みる", function () {
  this.cliResults = [
    runCli(this.root, ["update", "--recover-record", "--dry-run"]),
    runCli(this.root, ["update", "--recover-record"]),
  ];
});

Then("いずれも0で終了し書き込まずretainedを報告する", function () {
  const results = this.cliResults;
  assert.ok(results, "CLI結果がありません");
  assert.equal(results.length, 2);
  for (const [index, result] of results.entries()) {
    assert.equal(
      result.status,
      0,
      `${index}件目のCLIが0で終了していません: ${result.stdout}${result.stderr}`,
    );
    const parsed: unknown = JSON.parse(result.stdout);
    const payload = parsed as Record<string, unknown>;
    assert.equal(payload.applied, false, `${index}件目がpreviewではありません`);
    assert.ok(
      Array.isArray(payload.retained) &&
        payload.retained.includes(DIVERGENT_ASSET),
      `${index}件目がretainedを報告していません: ${result.stdout}`,
    );
  }
  /** previewは書き込まない。 */
  assert.equal(
    fs.existsSync(recordPath(this.root)),
    false,
    "previewがrecordを書き込みました",
  );
});

When("未導入の隔離先へdeleteを試みる", function () {
  this.recoveryRejections = [];
  try {
    uninstall(this.root, { apply: true });
    this.recoveryRejections.push("");
  } catch (error) {
    this.recoveryRejections.push(
      error instanceof Error ? error.message : String(error),
    );
  }
});

Then("拒否理由は最小診断だけを返しupdateを名指しする", function () {
  const rejections = this.recoveryRejections;
  assert.ok(rejections, "拒否理由がありません");
  const message = String(rejections[0]);
  assert.notEqual(message, "", "未導入directoryのdeleteが拒否されていません");
  /**
   * **最小診断だけを返す**（Issue #1305、#1310へ分離）。
   *
   * 手順・内訳・分岐の助言は4ラウンド連続でHighの発生源だった。`install`の名指しは
   * `init`では閉路、`delete`では誤誘導になる。**caller非依存な1本の文字列で
   * 助言を作らない。**
   */
  assertDiagnosticIsExactly(
    message,
    `${DELETE_ABSENT_PREFIX}${MINIMAL_TAIL}`,
    "未導入directoryのdelete拒否",
  );
  assert.doesNotMatch(
    message,
    /配置予定|採用 \d+件|保持 \d+件/u,
    `内訳を開示しています: ${message}`,
  );
  assert.doesNotMatch(
    message,
    /--dry-run|--apply/u,
    `手順を案内しています: ${message}`,
  );
});

/**
 * 門の手前の案内もpreviewで裏付ける（Issue #1305、codex High 1）。
 *
 * `update`のopt-in門は展開先の検証より前に発火する。無条件に`--recover-record`を
 * 勧めると、境界外symlinkのようにpreviewが拒否される状態でも**成功しない手段を
 * 名指しする**ことになり、正準INV-02に反する。
 */
Then(
  "拒否理由は明示指定を成功する手段として案内せず原因を名指しする",
  function () {
    const rejections = this.recoveryRejections;
    assert.ok(rejections, "拒否理由がありません");
    const message = String(rejections[0]);
    assert.notEqual(message, "", "updateが拒否されていません");
    assert.match(
      message,
      /シンボリックリンクによる境界外移動を拒否しました/u,
      `解消すべき原因を名指ししていません: ${message}`,
    );
    /**
     * **字面ではなく語で禁じる**（Issue #1305、codex Medium 3）。
     * `/--recover-record 付きで実行してください/`という字面の禁止は言い換えで
     * 空虚化する。previewが拒否した経路ではどのcommandも名指しできない。
     */
    assertDiagnosticIsExactly(
      message,
      `${ABSENT_PREFIX}${blockedTail(outsideCause())}`,
      "blocked分岐のupdate拒否",
    );
    assert.match(
      message,
      /先にこの原因を解消してください/u,
      `原因の解消を求めていません: ${message}`,
    );
  },
);
