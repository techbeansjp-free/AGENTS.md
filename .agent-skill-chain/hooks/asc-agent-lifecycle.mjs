#!/usr/bin/env node
/** Retired lifecycle observer: compatibility entry for already-loaded host settings.
 * Discard input without parsing; no state, locks, reservations or permission decisions.
 * Host permissions and explicit workflow validation remain authoritative.
 */
if (process.argv.includes("--report")) {
  process.stdout.write(JSON.stringify({ enabled: false, observing: false, blocksWorktree: false, reservations: [], message: "常時観測は廃止しました。残留session記録の解除は不要です。" }) + "\n");
} else if (process.argv.some((arg) => arg.startsWith("--recover-session="))) {
  process.stdout.write(JSON.stringify({ enabled: false, recoveryRequired: false }) + "\n");
} else if (process.argv.includes("--trusted-workflow-read")) {
  process.stderr.write("この旧lifecycle経由のCLI実行は廃止しました。ASC CLIを直接実行してください。\n");
  process.exitCode = 1;
} else {
  // Drain the host pipe before exiting so large tool payloads cannot hit EPIPE.
  await new Promise((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("error", resolve);
    process.stdin.resume();
  });
  process.stdout.write("{}\n");
}
