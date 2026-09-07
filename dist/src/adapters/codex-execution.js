import { spawn } from "node:child_process";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";
import { CODEX_SELECTION_CONFIG } from "./provider.js";
export function codexExecutionArguments(input) {
    if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(input.model) ||
        !["read-only", "workspace-write"].includes(input.sandbox))
        throw new Error("Codex起動modelまたはsandboxが不正です");
    return [
        "exec",
        "--json",
        "--ephemeral",
        "--model",
        input.model,
        ...CODEX_SELECTION_CONFIG,
        "--sandbox",
        input.sandbox,
        "--cd",
        input.root,
        "-",
    ];
}
/** Stream events without retaining task text, raw output, or provider secrets. */
export async function executeCodex(input, limits = {}) {
    const args = codexExecutionArguments(input);
    const timeoutMs = limits.timeoutMs ?? 30 * 60 * 1000;
    const maxBytes = limits.maxOutputBytes ?? 8 * 1024 * 1024;
    if (!Number.isInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > 60 * 60 * 1000 ||
        !Number.isInteger(maxBytes) ||
        maxBytes <= 0)
        throw new Error("Codex起動の有限上限が不正です");
    return new Promise((resolve) => {
        const child = spawn("codex", args, {
            cwd: input.root,
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
        });
        let pending = "";
        let bytes = 0;
        let completed = 0;
        let failed = false;
        let malformed = false;
        let stopReason;
        let settled = false;
        const finish = (exitCode) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const succeeded = exitCode === 0 &&
                completed === 1 &&
                !failed &&
                !malformed &&
                !stopReason &&
                pending.trim() === "";
            resolve({
                state: succeeded
                    ? "succeeded"
                    : stopReason ||
                        malformed ||
                        pending.trim() !== "" ||
                        (exitCode === 0 && completed !== 1)
                        ? "unknown"
                        : "failed",
                exitCode,
                reason: succeeded
                    ? "Codexの正常完了eventと終了値0を確認しました"
                    : (stopReason ??
                        "Codexの正常完了を確認できません。作業差分を確認してから明示的に再開してください"),
            });
        };
        const stop = (reason) => {
            if (stopReason)
                return;
            stopReason = reason;
            if (process.platform !== "win32" && child.pid !== undefined) {
                try {
                    process.kill(-child.pid, "SIGKILL");
                }
                catch {
                    child.kill("SIGKILL");
                }
            }
            else
                child.kill("SIGKILL");
        };
        const timer = setTimeout(() => stop("Codex実行が有限時間上限に達しました。作業状態を確認してから明示的に再開してください"), timeoutMs);
        const count = (chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > maxBytes)
                stop("Codex出力が容量上限に達しました。作業状態を確認してください");
            return stopReason === undefined;
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (!count(chunk))
                return;
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim() === "")
                    continue;
                try {
                    const event = parseJsonStrict(line, "Codex execution event");
                    if (!isRecord(event) || typeof event.type !== "string")
                        malformed = true;
                    else if (event.type === "turn.completed")
                        completed += 1;
                    else if (event.type === "turn.failed" || event.type === "error")
                        failed = true;
                }
                catch {
                    malformed = true;
                }
            }
        });
        child.stderr.on("data", (chunk) => {
            count(chunk);
        });
        child.on("error", () => {
            stopReason = "Codexを起動できません。実行入口を復旧してください";
            finish(null);
        });
        child.on("close", (code) => finish(code));
        child.stdin.on("error", () => undefined);
        child.stdin.end(input.prompt);
    });
}
//# sourceMappingURL=codex-execution.js.map