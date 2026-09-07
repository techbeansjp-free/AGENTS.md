import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runJsonlSession, type ProcessResult } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class StdinWorld extends WorkflowWorld {
  closedStdinScript = "";
  failedResult: ProcessResult | undefined;
  rejectedResult: unknown;
}
const { Given, When, Then } = stepDefinitions<StdinWorld>();
const inputMarker = "stdin-private-marker-1265";
const closedNotice = "stdin-closed\n";

Given("stdin閉鎖を通知して終了値0を返す実Node childがある", function () {
  // close済み通知が追加入力の同期点。timerは順序を決めず、正常exitを保留する。
  this.closedStdinScript = `
const fs = require('node:fs');
fs.readSync(0, Buffer.alloc(64), 0, 64, null);
fs.closeSync(0);
process.stdout.write('stdin-closed\\n');
setTimeout(() => process.exit(0), 100);
`;
});

When("閉鎖通知後にsessionの追加入力を送信する", async function () {
  const script = this.closedStdinScript;
  // 同じ実childを直接観測し、模擬errorでなくOSのEPIPEとexit0を確認する。
  const calibration = await new Promise<{
    error?: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let error: string | undefined;
    let output = "";
    let sent = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("stdin閉鎖fixtureが完了しません"));
    }, 5_000);
    child.stdin.on("error", (failure: NodeJS.ErrnoException) => {
      error = failure.code;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (!sent && output.includes(closedNotice)) {
        sent = true;
        child.stdin.write(`${inputMarker}\n`);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ error, code });
    });
    child.stdin.write("initial\n");
  });
  assert.deepEqual(calibration, { error: "EPIPE", code: 0 });
  const observe = (allowFailure: boolean) => {
    let sent = false;
    return runJsonlSession(process.execPath, ["-e", script], process.cwd(), {
      input: `token=${inputMarker}\n`,
      timeoutMs: 5_000,
      allowFailure,
      nextInput: (stdout) => {
        if (!sent && stdout.includes(closedNotice)) {
          sent = true;
          return `${inputMarker}\n`;
        }
        return undefined;
      },
      isComplete: () => false,
    });
  };
  this.failedResult = await observe(true);
  try {
    this.rejectedResult = await observe(false);
  } catch (error) {
    this.rejectedResult = error;
  }
});

Then("allowFailureの両値でstdin書込失敗を安全に返す", function () {
  assert.equal(this.failedResult?.status, 1);
  assert.match(this.failedResult?.stderr ?? "", /stdinへの書込に失敗/u);
  assert.ok(this.rejectedResult instanceof Error);
  assert.match(this.rejectedResult.message, /stdinへの書込に失敗/u);
  for (const diagnostic of [
    JSON.stringify(this.failedResult),
    this.rejectedResult.message,
  ]) {
    assert.equal(diagnostic.includes(inputMarker), false);
  }
});

Then("通常のsession送信と終了は成功する", async function () {
  let sent = false;
  const result = await runJsonlSession(
    process.execPath,
    [
      "-e",
      `let input=''; process.stdin.on('data', chunk => {
        input += chunk;
        if(input.includes('followup')) process.stdout.write('complete\\n');
        else process.stdout.write('ready\\n');
      });`,
    ],
    process.cwd(),
    {
      input: "initial\n",
      timeoutMs: 5_000,
      nextInput: (stdout) => {
        if (!sent && stdout.includes("ready\n")) {
          sent = true;
          return "followup\n";
        }
        return undefined;
      },
      isComplete: (stdout) => stdout.includes("complete\n"),
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "ready\ncomplete\n");
  assert.equal(result.stderr, "");
});
