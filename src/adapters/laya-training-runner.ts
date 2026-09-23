import fs from "node:fs";
import path from "node:path";
import {
  validateTrainingManifest,
  type LayaTrainingManifest,
} from "../domain/laya-decision-training.js";
import { run, type ProcessResult } from "../lib/process.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";

export interface LayaRunnerRequest {
  repositoryRoot: string;
  manifestPath: string;
  outputPath: string;
}

export type LayaRunnerExecutor = typeof run;

const RUNNER = "scripts/laya_training_runner.py";
const TIMEOUT_MS = 6 * 60 * 60 * 1000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

function runnerEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CUDA_VISIBLE_DEVICES",
    "HF_HOME",
    "TRANSFORMERS_CACHE",
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

export function launchLayaTrainingRunner(
  request: LayaRunnerRequest,
  execute: LayaRunnerExecutor = run,
): ProcessResult {
  const root = fs.realpathSync(request.repositoryRoot);
  const manifest = resolveContained(root, request.manifestPath);
  const parsed = parseJsonStrict(
    fs.readFileSync(manifest, "utf8"),
    "Laya training manifest",
  ) as unknown as LayaTrainingManifest;
  const validated = validateTrainingManifest(parsed);
  const runner = resolveContained(root, RUNNER);
  if (!fs.statSync(runner).isFile())
    throw new Error("Laya runnerが通常fileではありません");
  resolveContained(root, validated.trainPath);
  resolveContained(root, validated.validationPath);
  const output = resolveContained(root, request.outputPath, {
    allowMissingLeaf: true,
  });
  if (fs.existsSync(output))
    throw new Error("Laya runner outputは未作成pathが必要です");
  const manifestRelative = path
    .relative(root, manifest)
    .split(path.sep)
    .join("/");
  const outputRelative = path.relative(root, output).split(path.sep).join("/");
  return execute(
    "python3",
    [
      "-I",
      RUNNER,
      "train",
      `--manifest=${manifestRelative}`,
      `--output=${outputRelative}`,
    ],
    root,
    {
      env: runnerEnvironment(),
      timeoutMs: TIMEOUT_MS,
      maxBufferBytes: OUTPUT_LIMIT,
      allowFailure: true,
    },
  );
}
