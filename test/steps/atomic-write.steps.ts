import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../../src/lib/atomic.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface AtomicWriteWorld extends WorkflowWorld {
  root: string;
  managed: string;
  record: string;
  sibling: string;
  attemptedDifferentFilesystem: boolean;
  updateError?: Error;
  external?: string;
  originalManaged?: string;
  forgedTemporary?: string;
}

const { Given, When, Then } = stepDefinitions<AtomicWriteWorld>();
const oldRecord = "old-record\n";
const newRecord = "new-record\n";

Given("digest管理directoryと既存recordがある", function () {
  this.root = this.temp("asc-atomic-write-");
  this.managed = path.join(this.root, "managed");
  this.sibling = this.root;
  this.record = path.join(this.managed, "staging-record.json");
  fs.mkdirSync(this.managed);
  fs.writeFileSync(this.record, oldRecord, { mode: 0o600 });
  this.attemptedDifferentFilesystem = false;
  this.updateError = undefined;
});

When("sibling directoryを一時領域としてrecordをatomic更新する", function () {
  writeFileAtomic(this.record, newRecord, {
    temporaryDirectory: this.sibling,
  });
});

When(
  "利用可能なら異なるfilesystemを一時領域としてrecordをatomic更新する",
  function () {
    const candidate = "/dev/shm";
    if (!fs.existsSync(candidate)) return;
    const targetDevice = fs.statSync(this.managed).dev;
    if (fs.statSync(candidate).dev === targetDevice) return;
    this.attemptedDifferentFilesystem = true;
    try {
      writeFileAtomic(this.record, newRecord, {
        temporaryDirectory: candidate,
      });
    } catch (error) {
      this.updateError = error as Error;
    }
  },
);

Then("recordは完全な新版だけを保持する", function () {
  assert.equal(fs.readFileSync(this.record, "utf8"), newRecord);
});

Then("digest管理directoryとsibling directoryに一時fileを残さない", function () {
  const temporaryPattern = /^\.staging-record\.json\.tmp-/u;
  assert.deepEqual(
    fs.readdirSync(this.managed).filter((name) => temporaryPattern.test(name)),
    [],
  );
  assert.deepEqual(
    fs.readdirSync(this.sibling).filter((name) => temporaryPattern.test(name)),
    [],
  );
});

Then("異なるfilesystemだった場合は旧recordを維持して拒否する", function () {
  if (!this.attemptedDifferentFilesystem) {
    assert.equal(fs.readFileSync(this.record, "utf8"), oldRecord);
    return;
  }
  assert.match(this.updateError?.message ?? "", /同一filesystem/u);
  assert.equal(fs.readFileSync(this.record, "utf8"), oldRecord);
});

Given("digest管理directoryを外部directoryへのsymlinkへ差し替える", function () {
  this.external = this.temp("asc-atomic-external-");
  this.originalManaged = `${this.managed}-original`;
  fs.renameSync(this.managed, this.originalManaged);
  fs.symlinkSync(this.external, this.managed, "dir");
});

When("差し替え後のrecordをatomic更新しようとする", function () {
  try {
    writeFileAtomic(this.record, newRecord, {
      temporaryDirectory: this.sibling,
    });
  } catch (error) {
    this.updateError = error as Error;
  }
});

Then("directory境界を拒否して外部fileを作らない", function () {
  assert.ok(this.updateError);
  assert.ok(this.external);
  assert.equal(
    fs.existsSync(path.join(this.external, "staging-record.json")),
    false,
  );
  assert.ok(this.originalManaged);
  assert.equal(
    fs.readFileSync(
      path.join(this.originalManaged, "staging-record.json"),
      "utf8",
    ),
    oldRecord,
  );
});

Given(
  "sibling一時directoryを外部directoryへのsymlinkへ差し替える",
  function () {
    const external = this.temp("asc-atomic-temp-external-");
    this.forgedTemporary = path.join(this.root, "forged-temporary");
    fs.symlinkSync(external, this.forgedTemporary, "dir");
  },
);

When("偽装した一時directoryからrecordをatomic更新しようとする", function () {
  assert.ok(this.forgedTemporary);
  try {
    writeFileAtomic(this.record, newRecord, {
      temporaryDirectory: this.forgedTemporary,
    });
  } catch (error) {
    this.updateError = error as Error;
  }
});

Then("一時directory境界を拒否して旧recordを維持する", function () {
  assert.ok(this.updateError);
  assert.equal(fs.readFileSync(this.record, "utf8"), oldRecord);
});
