import { spawnSync } from "node:child_process";
import { redactSecrets } from "./security.js";

export interface ProcessOptions {
  allowFailure?: boolean;
}

export interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

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
  });
  const output = {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: redactSecrets(result.stderr ?? ""),
  };
  if (!options.allowFailure && output.status !== 0) {
    const command = redactSecrets(`${file} ${args.join(" ")}`);
    throw new Error(
      `${command}が失敗しました（終了値${output.status}）: ${output.stderr.trim()}`,
    );
  }
  return output;
}

export function git(
  args: string[],
  cwd: string,
  options: ProcessOptions = {},
): ProcessResult {
  return run("git", args, cwd, options);
}
