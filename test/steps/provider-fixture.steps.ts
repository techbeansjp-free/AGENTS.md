import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { codexFixtureScript } from "../support/provider-fixture.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ProviderFixtureWorld extends WorkflowWorld {
  fixtureDirectory = "";
  fixtureScript = "";
}
const { Given, When, Then } = stepDefinitions<ProviderFixtureWorld>();

Given("実routing用のCodex fixture scriptがある", function () {
  this.fixtureDirectory = this.temp("asc-provider-chunks-");
  fs.writeFileSync(
    path.join(this.fixtureDirectory, "catalog.jsonl"),
    JSON.stringify({ id: 1, result: { data: ["catalog-fixture"] } }) + "\n",
  );
  this.fixtureScript = codexFixtureScript(this.fixtureDirectory);
});

When(/^model\/listの前後と残余を制御したchunkで送る$/u, function () {
  const invoke = (mode: string, chunks: string[]) => {
    // 実routingで生成するscriptのhandlerへ、OSの分割に頼らず同じdataを渡す。
    const stdin = Object.assign(new EventEmitter(), {
      setEncoding: () => undefined,
    });
    const output: string[] = [];
    runInNewContext(this.fixtureScript, {
      require: createRequire(import.meta.url),
      process: {
        argv: [process.execPath, "codex", mode],
        stdin,
        stdout: { write: (chunk: string) => output.push(chunk) },
        stderr: { write: () => undefined },
      },
    });
    for (const chunk of chunks) stdin.emit("data", chunk);
    stdin.emit("end");
    return output
      .join("")
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
  };
  const appServer = invoke("app-server", [
    '{"id":0,"method":"initialize"}\n',
    '{"method":"initialized"}\n{"id":1,"method":"model/',
    'list"}\n',
    "\n",
    '{"method":"unrelated"}\n',
  ]);
  const exec = invoke("exec", ["task ", "body"]);
  const calls = fs
    .readFileSync(path.join(this.fixtureDirectory, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  this.value = { appServer, exec, calls };
});

Then("初期化とcatalogは各1件でexec応答も維持する", function () {
  assert.deepEqual(this.value, {
    appServer: [
      { id: 0, result: { userAgent: "fixture" } },
      { id: 1, result: { data: ["catalog-fixture"] } },
    ],
    exec: [{ type: "turn.completed", text: "token=private-test-value" }],
    calls: [{ args: ["exec"], input: "task body" }],
  });
});

Given("PATHの未設定と空文字と値ありを検証する隔離processがある", function () {
  this.fixtureDirectory = this.temp("asc-provider-env-");
});

When("実routing用のPATH helperで成功と失敗を実行する", function () {
  const helper = pathToFileURL(
    path.resolve("test/support/provider-fixture.ts"),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';
import path from 'node:path';
import { withProviderPath } from ${JSON.stringify(helper.href)};
const observations=[];
for(const original of [undefined, '', '/original/path']) {
  for(const mode of ['success', 'reject', 'throw']) {
    if(original === undefined) delete process.env.PATH;
    else process.env.PATH=original;
    let error;
    try {
      const value=await withProviderPath('/fixture/bin', () => {
        assert.equal(process.env.PATH, '/fixture/bin'+path.delimiter+(original ?? ''));
        if(mode === 'throw') throw new Error('expected failure');
        return mode === 'reject' ? Promise.reject(new Error('expected failure')) : Promise.resolve(42);
      });
      assert.equal(value,42);
    } catch(failure) { error=failure; }
    if(mode === 'success') assert.equal(error, undefined);
    else assert.equal(error?.message, 'expected failure');
    assert.equal(Object.hasOwn(process.env,'PATH'), original !== undefined);
    assert.equal(process.env.PATH, original);
    observations.push({ state:original === undefined ? 'absent' : original === '' ? 'empty' : 'value', mode });
  }
}
process.stdout.write(JSON.stringify(observations));`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
  this.value = JSON.parse(result.stdout);
});

Then("全経路でPATHのproperty有無と値が開始前に戻る", function () {
  assert.deepEqual(
    this.value,
    ["absent", "empty", "value"].flatMap((state) =>
      ["success", "reject", "throw"].map((mode) => ({ state, mode })),
    ),
  );
});
