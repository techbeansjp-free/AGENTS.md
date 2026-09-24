import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  validateTrainingManifest,
  type LayaTrainingManifest,
} from "../domain/laya-decision-training.js";
import {
  createLayaTrainingArtifactBindings,
  validateLayaTrainingDatasets,
} from "../domain/laya-training-contract.js";
import { run, type ProcessResult } from "../lib/process.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";

export interface LayaRunnerRequest {
  repositoryRoot: string;
  manifestPath: string;
  outputPath: string;
}

export type LayaRunnerExecutor = typeof run;

const RUNNER = "scripts/laya_training_runner.py";
const LOCAL_RUN_ROOT = ".agent-skill-chain/local/laya-runs";
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
    "ASC_LAYA_MODEL_PATH",
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
  const train = resolveContained(root, validated.trainPath);
  const validation = resolveContained(root, validated.validationPath);
  const readArtifact = (
    reference: { path: string; sha256: string },
    label: string,
  ): unknown => {
    const file = resolveContained(root, reference.path);
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256)
      throw new Error(`${label}のSHA-256がmanifestと一致しません`);
    return parseJsonStrict(bytes.toString("utf8"), label);
  };
  const bindings = createLayaTrainingArtifactBindings({
    manifest: validated,
    split: readArtifact(validated.splitArtifact, "sealed split artifact"),
    teachers: validated.teacherArtifacts.map((reference) => ({
      teacher: reference.teacher,
      sha256: reference.sha256,
      value: readArtifact(reference, `${reference.teacher} teacher artifact`),
    })),
    adjudications: validated.adjudicationArtifacts.map((reference) => ({
      sha256: reference.sha256,
      value: readArtifact(reference, "strong adjudication artifact"),
    })),
  });
  validateLayaTrainingDatasets(
    fs.readFileSync(train, "utf8"),
    fs.readFileSync(validation, "utf8"),
    validated,
    bindings,
  );
  const runRoot = resolveContained(root, LOCAL_RUN_ROOT);
  const runRootStat = fs.lstatSync(runRoot);
  if (!runRootStat.isDirectory() || runRootStat.isSymbolicLink())
    throw new Error("Laya runnerのlocal run rootが通常directoryではありません");
  const output = resolveContained(root, request.outputPath, {
    allowMissingLeaf: true,
  });
  if (path.dirname(output) !== runRoot)
    throw new Error(
      `Laya runner outputは${LOCAL_RUN_ROOT}直下でなければなりません`,
    );
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
