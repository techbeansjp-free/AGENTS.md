import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  doctor,
  init,
  uninstall,
  upgrade,
} from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

const SOURCE = ".agent-skill-chain/skills/asc-step/SKILL.md";
const TARGETS = [
  ".claude/skills/asc-step/SKILL.md",
  ".agents/skills/asc-step/SKILL.md",
] as const;

interface HostSkillWorld extends WorkflowWorld {
  externalFile?: string;
  root: string;
  result: unknown;
  original?: string;
  cliResults: Array<ReturnType<typeof spawnSync>>;
}

const { Given, When, Then } = stepDefinitions<HostSkillWorld>();

function recordPath(root: string): string {
  return path.join(root, ".agent-skill-chain", "managed-assets.json");
}

function readRecord(root: string): {
  version: unknown;
  files: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(recordPath(root), "utf8")) as {
    version: unknown;
    files: Record<string, string>;
  };
}

function writeRecord(
  root: string,
  record: { version: unknown; files: Record<string, string> },
): void {
  fs.writeFileSync(recordPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

function sha256(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function runCli(root: string, command: string, apply = false) {
  return spawnSync(
    process.execPath,
    [
      path.resolve("dist/bin/agent-skill-chain.js"),
      command,
      ...(apply ? ["--apply"] : []),
      `--root=${root}`,
    ],
    { encoding: "utf8" },
  );
}

Given("package内のhost skill登録アダプター正本がある", function () {
  this.root = process.cwd();
  assert.equal(fs.existsSync(path.join(this.root, SOURCE)), true);
});

When("adapter正本の契約を検査する", function () {
  this.result = fs.readFileSync(path.join(this.root, SOURCE), "utf8");
});

Then(
  "adapter正本はasc-step frontmatterとWorkflow・Step skillへの誘導を持つ",
  function () {
    const markdown = this.result as string;
    assert.match(markdown, /^---\r?\nname: asc-step\r?\n/);
    assert.match(markdown, /^description:\s*\S.+$/mu);
    assert.match(
      markdown,
      /\.\.\/\.\.\/\.\.\/\.agent-skill-chain\/docs\/01_開発ワークフロー\.md/u,
    );
    assert.match(markdown, /\.agent-skill-chain\/skills\/step-NN-/u);
  },
);

When("adapter正本の発見経路契約を検査する", function () {
  this.result = fs.readFileSync(path.join(this.root, SOURCE), "utf8");
});

Then("adapter正本は配布先でも解決するStep skill一覧linkを持つ", function () {
  const markdown = this.result as string;
  const match = /\]\((\.\.\/[^)]*00_利用案内\.md)\)/u.exec(markdown);
  assert.ok(match, "Step skill一覧へのlinkがありません");
  const link = match[1];
  assert.ok(
    link.startsWith("../../../"),
    `一覧linkは配布先でも解決する../../../基点が必要です: ${link}`,
  );
  const resolved = path.resolve(path.join(this.root, SOURCE), "..", link);
  assert.equal(fs.existsSync(resolved), true, `解決先がありません: ${link}`);
});

Then(
  "adapter正本のdescriptionは各Step境界での起動を促す単一行である",
  function () {
    const markdown = this.result as string;
    const description = /^description:\s*(\S.*)$/mu.exec(markdown)?.[1];
    assert.ok(description, "descriptionがありません");
    assert.match(description, /各Step|Stepごと|Stepの開始/u);
  },
);

Then("adapter正本は実在するStep skill名を列挙しない", function () {
  const markdown = this.result as string;
  const stepSkills = fs
    .readdirSync(path.join(this.root, ".agent-skill-chain", "skills"), {
      withFileTypes: true,
    })
    .filter((entry) => entry.isDirectory() && /^step-\d{2}-/u.test(entry.name))
    .map((entry) => entry.name);
  assert.equal(stepSkills.length, 12);
  const listed = stepSkills.filter((name) => markdown.includes(name));
  assert.deepEqual(listed, []);
});

Given("package内容検査scriptがある", function () {
  this.root = process.cwd();
});

When("package内容検査の必須資産を検査する", function () {
  this.result = fs.readFileSync(
    path.join(this.root, "scripts", "check_package_contents.ts"),
    "utf8",
  );
});

Then("host skill登録アダプター正本は必須配布資産である", function () {
  const script = this.result as string;
  assert.ok(script.includes(`"${SOURCE}"`));
});

Given("空のconsumer repositoryがある", function () {
  this.root = this.temp("asc-host-skill-install-");
});

When("package lifecycleのinstallを適用する", function () {
  this.result = init(this.root, { apply: true });
});

Then("両host adapterは正本とbyte一致しmanaged recordへ記録される", function () {
  const source = fs.readFileSync(path.join(this.root, SOURCE));
  const record = readRecord(this.root);
  for (const target of TARGETS) {
    assert.deepEqual(fs.readFileSync(path.join(this.root, target)), source);
    assert.equal(record.files[target], sha256(path.join(this.root, target)));
  }
});

Then("doctorはhost adapterをhealthyと診断する", function () {
  const result = doctor(this.root);
  assert.equal(result.healthy, true);
  assert.equal(result.adapters.healthy, true);
  assert.deepEqual(result.adapters.diagnostics, []);
  assert.equal(result.tooling.git.minimumVersion, "2.38.0");
  assert.equal(result.tooling.git.supported, true);
  assert.equal(result.tooling.gh.minimumVersion, "2.13.0");
  assert.equal(result.tooling.gh.supported, true);
  assert.equal(result.tooling.healthy, true);
  assert.deepEqual(result.tooling.diagnostics, []);
});

Given(
  "install済みconsumerから両host adapterの管理記録だけを除いた状態がある",
  function () {
    this.root = this.temp("asc-host-skill-adopt-");
    init(this.root, { apply: true });
    const record = readRecord(this.root);
    for (const target of TARGETS) delete record.files[target];
    writeRecord(this.root, record);
  },
);

When("package lifecycleのupdateを適用する", function () {
  this.result = upgrade(this.root, { apply: true });
});

Then("両host adapterはadoptedとしてmanaged recordへ記録される", function () {
  const result = this.result as { adopted: string[] };
  assert.deepEqual([...result.adopted].sort(), [...TARGETS].sort());
  const record = readRecord(this.root);
  for (const target of TARGETS)
    assert.equal(typeof record.files[target], "string");
});

Given(
  "install済みconsumerに未管理で内容が異なるClaude adapterがある",
  function () {
    this.root = this.temp("asc-host-skill-retain-");
    init(this.root, { apply: true });
    const record = readRecord(this.root);
    delete record.files[TARGETS[0]];
    writeRecord(this.root, record);
    this.original = "利用者が所有するClaude skill\n";
    fs.writeFileSync(path.join(this.root, TARGETS[0]), this.original);
  },
);

Then("異なるClaude adapterはretainedとして同じ内容で残る", function () {
  const result = this.result as { retained: string[] };
  assert.ok(result.retained.includes(TARGETS[0]));
  assert.equal(
    fs.readFileSync(path.join(this.root, TARGETS[0]), "utf8"),
    this.original,
  );
  assert.equal(readRecord(this.root).files[TARGETS[0]], undefined);
});

Given("install済みconsumerに旧package所有adapterがある", function () {
  this.root = this.temp("asc-host-skill-upgrade-");
  init(this.root, { apply: true });
  const target = path.join(this.root, TARGETS[1]);
  fs.writeFileSync(target, "旧package adapter\n");
  const record = readRecord(this.root);
  record.files[TARGETS[1]] = sha256(target);
  writeRecord(this.root, record);
});

Then("管理中の旧adapterは現在のpackage正本へ更新される", function () {
  assert.deepEqual(
    fs.readFileSync(path.join(this.root, TARGETS[1])),
    fs.readFileSync(path.join(this.root, SOURCE)),
  );
});

Given("install済みconsumerにClaude CodeとCodexの他skillがある", function () {
  this.root = this.temp("asc-host-skill-delete-");
  init(this.root, { apply: true });
  for (const host of [".claude", ".agents"]) {
    const file = path.join(this.root, host, "skills", "consumer", "SKILL.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `keep:${host}\n`);
  }
});

When("package lifecycleのdeleteを適用する", function () {
  this.result = uninstall(this.root, { apply: true });
});

Then("両host adapterだけが削除され他skillは同じ内容で残る", function () {
  for (const target of TARGETS)
    assert.equal(fs.existsSync(path.join(this.root, target)), false);
  for (const host of [".claude", ".agents"])
    assert.equal(
      fs.readFileSync(
        path.join(this.root, host, "skills", "consumer", "SKILL.md"),
        "utf8",
      ),
      `keep:${host}\n`,
    );
});

Given("install済みconsumerのCodex adapterが改ざんされている", function () {
  this.root = this.temp("asc-host-skill-doctor-");
  init(this.root, { apply: true });
  fs.writeFileSync(path.join(this.root, TARGETS[1]), "tampered\n");
});

When("package lifecycleのdoctorを実行する", function () {
  this.result = doctor(this.root);
});

Then("doctorはunhealthyと対象pathを含む診断を返す", function () {
  const result = this.result as ReturnType<typeof doctor>;
  assert.equal(result.healthy, false);
  assert.equal(result.adapters.healthy, false);
  assert.ok(
    result.adapters.diagnostics.some((item) => item.includes(TARGETS[1])),
  );
});

Given("install済みconsumerに現行Codex adapterだけがある", function () {
  this.root = this.temp("asc-host-skill-legacy-");
  init(this.root, { apply: true });
});

Then("doctorはdot agentsをlegacyと判定しない", function () {
  const result = this.result as ReturnType<typeof doctor>;
  assert.equal(result.legacyDetected.includes(".agents"), false);
});

When("dot agentsへ旧資産を追加してdoctorを実行する", function () {
  fs.writeFileSync(path.join(this.root, ".agents", "legacy.md"), "legacy\n");
  this.result = doctor(this.root);
});

Then("doctorはdot agentsをlegacyと判定する", function () {
  const result = this.result as ReturnType<typeof doctor>;
  assert.equal(result.legacyDetected.includes(".agents"), true);
});

Given(
  "consumerのClaude探索pathが境界外directoryへのsymlinkである",
  function () {
    this.root = this.temp("asc-host-skill-symlink-root-");
    const outside = this.temp("asc-host-skill-symlink-outside-");
    this.externalFile = path.join(outside, "skills", "asc-step", "SKILL.md");
    fs.symlinkSync(outside, path.join(this.root, ".claude"));
  },
);

When("package lifecycleのinstallを試みる", function () {
  try {
    init(this.root, { apply: true });
  } catch (error) {
    this.error = error;
  }
});

Then("installは書込前に拒否され境界内外へpackage資産を作らない", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /シンボリックリンク/u);
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
  assert.equal(fs.existsSync(this.externalFile ?? ""), false);
});

Given("host adapter CLI検証用consumerがある", function () {
  this.root = this.temp("asc-host-skill-cli-");
  this.cliResults = [];
});

When("CLIでinstallとupdateとdoctorとdeleteを適用する", function () {
  const installResult = runCli(this.root, "install", true);
  assert.equal(installResult.status, 0, installResult.stderr);
  for (const target of TARGETS)
    assert.equal(fs.existsSync(path.join(this.root, target)), true);
  this.cliResults = [
    installResult,
    runCli(this.root, "update", true),
    runCli(this.root, "doctor"),
    runCli(this.root, "delete", true),
  ];
});

Then("CLIは両host adapterを登録診断削除して成功する", function () {
  for (const result of this.cliResults)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const target of TARGETS)
    assert.equal(fs.existsSync(path.join(this.root, target)), false);
});
