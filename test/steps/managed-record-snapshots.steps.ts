import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeFileNoReplace } from "../../src/lib/atomic.js";
import {
  doctor,
  init,
  uninstall,
  upgrade,
} from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface SnapshotWorld extends WorkflowWorld {
  root: string;
  recordPath: string;
  outsidePath: string;
  rejection?: unknown;
  originalRecord?: string;
  assetBefore?: string;
}

const { Given, When, Then } = stepDefinitions<SnapshotWorld>();

function snapshotDirectory(root: string): string {
  return path.join(root, ".agent-skill-chain", "managed-assets-records");
}

Given("managed record公開検証用の隔離directoryがある", function () {
  this.root = this.temp("asc-record-snapshots-");
  this.recordPath = path.join(
    this.root,
    ".agent-skill-chain",
    "managed-assets.json",
  );
  this.outsidePath = path.join(this.root, "outside.txt");
  fs.writeFileSync(this.outsidePath, "outside\n");
});

When("完全書込み後のlink直前にsymlinkを挿入する", function () {
  const original = fs.linkSync;
  let injected = false;
  try {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = ((
      source: string,
      destination: string,
    ) => {
      if (!injected && path.basename(destination) === "managed-assets.json") {
        fs.symlinkSync(this.outsidePath, destination);
        injected = true;
      }
      return original(source, destination);
    }) as typeof fs.linkSync;
    assert.throws(() => writeFileNoReplace(this.recordPath, "complete\n"), {
      code: "EEXIST",
    });
  } finally {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = original;
  }
  assert.equal(injected, true);
});

Then("symlink entryと参照先を保持し一時fileを残さない", function () {
  assert.equal(fs.lstatSync(this.recordPath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(this.outsidePath, "utf8"), "outside\n");
  assert.deepEqual(fs.readdirSync(path.dirname(this.recordPath)), [
    "managed-assets.json",
  ]);
});

When("managed recordの一時書込みを途中で失敗させる", function () {
  const original = fs.writeSync;
  let calls = 0;
  try {
    (fs as { writeSync: typeof fs.writeSync }).writeSync = ((
      descriptor: number,
      buffer: Uint8Array,
      offset: number,
      _length: number,
      position: number | null,
    ) => {
      calls++;
      if (calls > 1) throw new Error("injected ENOSPC");
      return original(descriptor, buffer, offset, 1, position);
    }) as typeof fs.writeSync;
    assert.throws(
      () => writeFileNoReplace(this.recordPath, "incomplete\n"),
      /injected ENOSPC/u,
    );
  } finally {
    (fs as { writeSync: typeof fs.writeSync }).writeSync = original;
  }
});

Then("不完全なrecordと一時fileを残さない", function () {
  assert.equal(fs.existsSync(this.recordPath), false);
  assert.deepEqual(fs.readdirSync(path.dirname(this.recordPath)), []);
});

When("install後にupdateを2回適用する", function () {
  init(this.root, { apply: true });
  this.originalRecord = fs.readFileSync(this.recordPath, "utf8");
  upgrade(this.root, { apply: true });
  upgrade(this.root, { apply: true });
});

Then(
  "旧recordは不変でsnapshotを2件追加しdoctorとdeleteが成立する",
  function () {
    assert.equal(fs.readFileSync(this.recordPath, "utf8"), this.originalRecord);
    assert.equal(
      fs
        .readdirSync(snapshotDirectory(this.root))
        .filter((name) => name.endsWith(".json")).length,
      2,
    );
    assert.equal(doctor(this.root).healthy, true);
    assert.equal(uninstall(this.root, { apply: true }).applied, true);
    assert.equal(fs.existsSync(this.recordPath), false);
    assert.deepEqual(fs.readdirSync(snapshotDirectory(this.root)), []);
  },
);

When("installとupdate後にsnapshotの内容を改ざんする", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  const file = path.join(
    snapshotDirectory(this.root),
    fs.readdirSync(snapshotDirectory(this.root))[0],
  );
  fs.appendFileSync(file, "tampered");
  this.assetBefore = fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8");
  try {
    upgrade(this.root, { apply: true });
  } catch (error) {
    this.rejection = error;
  }
});

Then("doctorは不正snapshotを報告しupdateは資産を変更しない", function () {
  assert.ok(this.rejection instanceof Error);
  assert.equal(doctor(this.root).healthy, false);
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    this.assetBefore,
  );
});

When("hardlinkを利用できない状態でinstallを適用する", function () {
  const original = fs.linkSync;
  try {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = (() => {
      throw new Error("hardlink unsupported");
    }) as typeof fs.linkSync;
    assert.throws(
      () => init(this.root, { apply: true }),
      /hardlink unsupported/u,
    );
  } finally {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = original;
  }
});

Then("recordとpackage資産は配置されない", function () {
  assert.equal(fs.existsSync(this.recordPath), false);
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
  assert.equal(
    fs.existsSync(path.join(this.root, ".agent-skill-chain")),
    false,
  );
});

When("install後のsnapshot公開直前にsymlinkを挿入する", function () {
  init(this.root, { apply: true });
  const original = fs.linkSync;
  let inserted = false;
  try {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = ((
      source: string,
      destination: string,
    ) => {
      if (
        !inserted &&
        /^(?:legacy|snapshot)-[a-f0-9]{64}\.json$/u.test(
          path.basename(destination),
        )
      ) {
        fs.symlinkSync(this.outsidePath, destination);
        inserted = true;
      }
      return original(source, destination);
    }) as typeof fs.linkSync;
    assert.throws(() => upgrade(this.root, { apply: true }));
  } finally {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = original;
  }
  assert.equal(inserted, true);
});

Then("snapshotのsymlink entryと参照先を保持する", function () {
  const file = path.join(
    snapshotDirectory(this.root),
    fs.readdirSync(snapshotDirectory(this.root))[0],
  );
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(this.outsidePath, "utf8"), "outside\n");
});

When("install後に未接続snapshotを置く", function () {
  init(this.root, { apply: true });
  const directory = snapshotDirectory(this.root);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "snapshot-orphan.json"), "{}\n");
});

Then("doctorとupdateは不正な連鎖を拒否する", function () {
  const result = doctor(this.root);
  assert.equal(result.healthy, false);
  assert.match(String(result.unmanagedAssets.note), /未接続entryの由来/u);
  assert.doesNotMatch(
    String(result.unmanagedAssets.note),
    /先に install または update/u,
  );
  assert.throws(() => upgrade(this.root, { apply: true }), /未接続のentry/u);
});

When("snapshot公開後に旧anchorだけを失う", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.assetBefore = fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8");
  fs.rmSync(this.recordPath);
});

Then("doctorは欠落した旧anchorを報告しrecoverも資産を変更しない", function () {
  const result = doctor(this.root);
  assert.equal(result.healthy, false);
  assert.match(
    String(result.unmanagedAssets.note),
    /anchorとsnapshotの正しい組/u,
  );
  assert.doesNotMatch(
    String(result.unmanagedAssets.note),
    /先に install または update/u,
  );
  assert.throws(
    () => upgrade(this.root, { apply: true, recoverRecord: true }),
    /旧anchorがありません/u,
  );
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    this.assetBefore,
  );
});

When("install後のsnapshot directoryに中断したprobeのfileが残る", function () {
  init(this.root, { apply: true });
  const directory = snapshotDirectory(this.root);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(
      directory,
      ".record-link-probe.json.tmp-1234-aaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    "probe",
  );
});

Then("updateとdoctorは一意のsnapshot連鎖を使える", function () {
  assert.equal(upgrade(this.root, { apply: true }).applied, true);
  assert.equal(doctor(this.root).healthy, true);
});

When("同じ親へ2つのupdateが競合する", function () {
  init(this.root, { apply: true });
  const original = fs.linkSync;
  let nested = false;
  try {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = ((
      source: string,
      destination: string,
    ) => {
      if (
        !nested &&
        /^(?:legacy|snapshot)-[a-f0-9]{64}\.json$/u.test(
          path.basename(destination),
        )
      ) {
        nested = true;
        upgrade(this.root, { apply: true });
      }
      return original(source, destination);
    }) as typeof fs.linkSync;
    assert.throws(
      () => upgrade(this.root, { apply: true }),
      /公開先に別のentry|並行更新/u,
    );
  } finally {
    (fs as { linkSync: typeof fs.linkSync }).linkSync = original;
  }
  assert.equal(nested, true);
});

Then("先着のsnapshotだけが残りdoctorは健全である", function () {
  assert.equal(fs.readdirSync(snapshotDirectory(this.root)).length, 1);
  assert.equal(doctor(this.root).healthy, true);
});
