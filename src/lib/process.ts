import { spawn, spawnSync } from "node:child_process";
import { redactSecrets } from "./security.js";

export interface ProcessOptions {
  allowFailure?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface JsonlSessionOptions extends Omit<
  ProcessOptions,
  "maxBufferBytes"
> {
  input: string;
  timeoutMs: number;
  isComplete: (stdout: string) => boolean;
}

const MAX_STREAM_BYTES = 1024 * 1024;
/**
 * `spawnSync`の既定`maxBuffer`は1MiBで、`git ls-files --others --ignored`のように
 * repository規模へ比例する出力で必ず超過する。超過時は`status`がnullになり`stderr`も
 * 空のため、既定値のままでは原因を判別できない失敗になる。
 */
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024;

export function run(
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions = {},
): ProcessResult {
  const result = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: options.maxBufferBytes ?? MAX_PROCESS_OUTPUT_BYTES,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  const command = redactSecrets(`${file} ${args.join(" ")}`);
  /**
   * `result.error`はprocessが正常に完了しなかったこと（ENOBUFS、ENOENT、timeout）を表す。
   * 停止させられたprocessの`status`は通常nullだが、上限超過が最終chunkで起きて子processが
   * 先に終了していた場合は0のまま残る（`git ls-files`で実測）。**`status`だけでは判別できない。**
   * `status ?? 1`は前者を終了値1へ写し`stderr`も空にするため、原因をstderrへ載せて
   * allowFailure側の呼び出しにも判別可能な失敗として渡す。
   */
  const failure =
    result.error === undefined
      ? undefined
      : `${command}を実行できませんでした（${(result.error as NodeJS.ErrnoException).code ?? result.error.name}）: ${redactSecrets(result.error.message).trim()}`;
  const output = {
    status: failure === undefined ? (result.status ?? 1) : 1,
    stdout: failure === undefined ? (result.stdout ?? "") : "",
    stderr: failure ?? redactSecrets(result.stderr ?? ""),
  };
  if (!options.allowFailure && output.status !== 0) {
    throw new Error(
      failure ??
        `${command}が失敗しました（終了値${output.status}）: ${output.stderr.trim()}`,
    );
  }
  return output;
}

export function runJsonlSession(
  file: string,
  args: string[],
  cwd: string,
  options: JsonlSessionOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let completed = false;
    const appendWithinLimit = (current: string, chunk: string): string => {
      const combined = current + chunk;
      if (Buffer.byteLength(combined) > MAX_STREAM_BYTES) {
        child.kill("SIGKILL");
        finish(1);
        return current;
      }
      return combined;
    };
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = {
        status,
        stdout,
        stderr: redactSecrets(stderr),
      };
      if (!options.allowFailure && output.status !== 0) {
        const command = redactSecrets(`${file} ${args.join(" ")}`);
        reject(
          new Error(
            `${command}が失敗しました（終了値${output.status}）: ${output.stderr.trim()}`,
          ),
        );
        return;
      }
      resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(1);
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendWithinLimit(stdout, chunk);
      if (settled) return;
      if (!completed && options.isComplete(stdout)) {
        completed = true;
        child.stdin.end();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendWithinLimit(stderr, chunk);
    });
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => undefined);
    child.stdin.write(options.input);
  });
}

export function git(
  args: string[],
  cwd: string,
  options: ProcessOptions = {},
): ProcessResult {
  return run("git", args, cwd, options);
}
