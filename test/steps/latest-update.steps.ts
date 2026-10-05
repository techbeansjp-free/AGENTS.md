import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  updateLatest,
  type LatestUpdateDependencies,
} from "../../src/adapters/latest-update.js";
import { init, upgrade, doctor } from "../../src/domain/lifecycle.js";
import { type WorkflowWorld, stepDefinitions } from "../support/world.js";
const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
const asset =
  "https://github.com/techbeansjp-free/AGENTS.md/releases/download/v1.2.3/agent-skill-chain.tgz";
const release = () =>
  Promise.resolve({
    tag_name: "v1.2.3",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "agent-skill-chain.tgz",
        state: "uploaded",
        browser_download_url: asset,
      },
    ],
  });
type State = {
  root: string;
  calls: string[][];
  result?: Awaited<ReturnType<typeof updateLatest>>;
  checked?: boolean;
};
const states = new WeakMap<WorkflowWorld, State>();
function state(world: WorkflowWorld) {
  return states.get(world)!;
}
function dependencies(s: State): LatestUpdateDependencies {
  return {
    release,
    execute: (url, args) => {
      assert.equal(url, asset);
      assert.equal(args[1], `--root=${s.root}`);
      assert.equal(args.includes("--latest"), false);
      s.calls.push(args);
      const output =
        args[0] === "update"
          ? upgrade(s.root, { apply: true })
          : doctor(s.root);
      return { status: 0, stdout: JSON.stringify(output), stderr: "" };
    },
  };
}
Given("最新版更新用の導入済みprojectがある", function () {
  const root = this.temp("asc-latest-");
  init(root, { apply: true });
  states.set(this, { root, calls: [] });
});
When("最新正式版への更新を依頼する", async function () {
  const s = state(this);
  s.result = await updateLatest(s.root, { apply: true }, dependencies(s));
});
Then("同じ正式配布物で更新とdoctorが完了する", function () {
  const s = state(this);
  assert.equal(s.result?.applied, true);
  assert.equal(s.result?.verified, true);
  assert.equal(typeof s.result?.currentVersion, "string");
  assert.equal(s.result?.latestVersion, "1.2.3");
  assert.deepEqual(
    s.calls.map((c) => c[0]),
    ["update", "doctor"],
  );
  assert.equal((s.result?.activation as { restart: string }).restart, "none");
});
When("hook欠落を最新版更新で修復する", async function () {
  const s = state(this);
  fs.unlinkSync(path.join(s.root, ".claude/hooks/asc-agent-lifecycle.mjs"));
  s.result = await updateLatest(s.root, { apply: true }, dependencies(s));
});
Then("更新成功と新sessionの案内を報告する", function () {
  const s = state(this);
  assert.equal(s.result?.applied, true);
  assert.equal(s.result?.verified, true);
  assert.equal(
    (s.result?.activation as { restart: string }).restart,
    "new-session",
  );
  assert.match(
    (s.result?.activation as { message: string }).message,
    /新しいsession/,
  );
  assert.equal(
    fs.existsSync(path.join(s.root, ".claude/hooks/asc-agent-lifecycle.mjs")),
    true,
  );
});
When("最新版更新のpreviewと不正なreleaseを検査する", async function () {
  const s = state(this);
  const deps = dependencies(s);
  const preview = await updateLatest(s.root, { apply: false }, deps);
  assert.equal(preview.applied, false);
  assert.equal(s.calls.length, 0);
  const valid = await release();
  for (const invalid of [
    { ...valid, prerelease: true },
    { ...valid, draft: true },
    { ...valid, tag_name: "main" },
    { ...valid, assets: [] },
    {
      ...valid,
      assets: [
        {
          ...valid.assets[0],
          browser_download_url: "https://untrusted.invalid/payload.tgz",
        },
      ],
    },
  ]) {
    await assert.rejects(
      updateLatest(
        s.root,
        { apply: true },
        { ...deps, release: async () => invalid },
      ),
    );
  }
  assert.equal(s.calls.length, 0);
  s.checked = true;
});
When("最新版更新後のdoctorと更新コマンドの失敗を検査する", async function () {
  const s = state(this);
  for (const stdout of ['{"healthy":false}', "broken response"]) {
    const result = await updateLatest(
      s.root,
      { apply: true },
      {
        release,
        execute: (_url, args) =>
          args[0] === "update"
            ? { status: 0, stdout: '{"applied":true}', stderr: "" }
            : { status: 1, stdout, stderr: "doctor diagnostic" },
      },
    );
    assert.equal(result.applied, true);
    assert.equal(result.verified, false);
    assert.equal(typeof result.diagnostic, "string");
  }
  let calls = 0;
  await assert.rejects(
    updateLatest(
      s.root,
      { apply: true },
      {
        release,
        execute: () => {
          calls++;
          return { status: 1, stdout: "", stderr: "managed asset lock" };
        },
      },
    ),
    /managed asset lock/,
  );
  assert.equal(calls, 1);
  s.checked = true;
});
Then("最新版更新の境界検査が成功する", function () {
  assert.equal(state(this).checked, true);
});

When("現在version診断の失敗と更新時の安全確認を検査する", async function () {
  const s = state(this);
  const deps = {
    ...dependencies(s),
    installed: () => {
      throw new Error("current doctor unavailable");
    },
  };
  const preview = await updateLatest(s.root, { apply: false }, deps);
  assert.equal(preview.currentVersion, null);
  assert.match(preview.warnings?.[0] ?? "", /current doctor unavailable/);
  assert.equal(s.calls.length, 0);
  const result = await updateLatest(s.root, { apply: true }, deps);
  assert.equal(result.currentVersion, null);
  assert.equal(result.latestVersion, "1.2.3");
  assert.equal(result.applied, true);
  assert.equal(result.verified, true);
  assert.match(result.warnings?.[0] ?? "", /current doctor unavailable/);
  assert.deepEqual(
    s.calls.map((c) => c[0]),
    ["update", "doctor"],
  );
  s.calls.length = 0;
  fs.mkdirSync(
    path.join(s.root, ".agent-skill-chain/managed-assets-mutation.lock"),
  );
  await assert.rejects(
    updateLatest(s.root, { apply: true }, deps),
    /lock|更新中/,
  );
  assert.deepEqual(
    s.calls.map((c) => c[0]),
    ["update"],
  );
  assert.equal(s.calls[0].includes("--recover-record"), false);
  s.checked = true;
});
