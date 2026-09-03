import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  injectPublishVersion,
  versionFromReleaseTag,
} from "../../scripts/inject_publish_version.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * npm公開経路のversion注入を、実tree操作なしで検査する。
 *
 * **`injectPublishVersion`そのものを呼ぶ。** 判定関数`canonicalBumpDiff`を直接呼ぶ
 * scenarioでは、注入経路からその呼び出し行を消す変異が生存する。`apply`と`read`の
 * seamへfixtureを渡し、**検査が実行経路の上にあること**を固定する（Issue #1184）。
 */
class InjectionWorld extends WorkflowWorld {
  injectionRoot = "";
  injectionBefore: { manifest: string; lockfile: string } | undefined;
  injectionAfter: { manifest: string; lockfile: string } | undefined;
  injectionVersion = "";
  injectionAccepted: boolean | undefined;
  injectionError = "";
}

const { Given, When, Then } = stepDefinitions<InjectionWorld>();

const SENTINEL = "0.3.1-managed-by-tag";

function manifest(version: string): string {
  return `${JSON.stringify({ name: "agent-skill-chain", version, license: "MIT" }, null, 2)}\n`;
}

function lockfile(version: string, integrity = "sha512-fixture"): string {
  return `${JSON.stringify(
    {
      name: "agent-skill-chain",
      version,
      lockfileVersion: 3,
      packages: {
        "": { name: "agent-skill-chain", version },
        "node_modules/example": { version: "1.0.0", integrity },
      },
    },
    null,
    2,
  )}\n`;
}

Given("sentinel versionを持つ隔離package treeがある", function () {
  this.injectionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "asc-inject-"));
  this.injectionBefore = {
    manifest: manifest(SENTINEL),
    lockfile: lockfile(SENTINEL),
  };
  this.injectionVersion = versionFromReleaseTag("v0.3.1-beta.74");
});

function inject(world: InjectionWorld, integrity: string): void {
  try {
    injectPublishVersion(
      "v0.3.1-beta.74",
      (version) => {
        world.injectionAfter = {
          manifest: manifest(version),
          lockfile: lockfile(version, integrity),
        };
      },
      () => world.injectionAfter ?? world.injectionBefore!,
    );
    world.injectionAccepted = true;
  } catch (error) {
    world.injectionAccepted = false;
    world.injectionError = error instanceof Error ? error.message : "";
  }
}

When("release tagのversionを注入する", function () {
  inject(this, "sha512-fixture");
});

When("version以外も変える注入を実行する", function () {
  inject(this, "sha512-tampered");
});

Then(
  "変更はpackage.jsonとpackage-lock.jsonの3 version fieldだけである",
  function () {
    assert.equal(this.injectionAccepted, true);
    assert.equal(this.injectionVersion, "0.3.1-beta.74");
    for (const content of [
      this.injectionAfter?.manifest ?? "",
      this.injectionAfter?.lockfile ?? "",
    ])
      assert.doesNotMatch(content, /managed-by-tag/u);
  },
);

Then("注入は正規bump差分でないことを理由に拒否される", function () {
  assert.equal(this.injectionAccepted, false);
  assert.match(this.injectionError, /3 version field以外を変更しました/u);
});
