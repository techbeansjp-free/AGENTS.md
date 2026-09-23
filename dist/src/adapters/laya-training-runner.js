import fs from "node:fs";
import path from "node:path";
import { validateTrainingManifest, } from "../domain/laya-decision-training.js";
import { run } from "../lib/process.js";
import { parseJsonStrict, resolveContained } from "../lib/security.js";
const RUNNER = "scripts/laya_training_runner.py";
const TIMEOUT_MS = 6 * 60 * 60 * 1000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
function runnerEnvironment() {
    const allowed = [
        "HOME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "CUDA_VISIBLE_DEVICES",
        "HF_HOME",
        "TRANSFORMERS_CACHE",
    ];
    return Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
}
export function launchLayaTrainingRunner(request, execute = run) {
    const root = fs.realpathSync(request.repositoryRoot);
    const manifest = resolveContained(root, request.manifestPath);
    const parsed = parseJsonStrict(fs.readFileSync(manifest, "utf8"), "Laya training manifest");
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
    return execute("python3", [
        "-I",
        RUNNER,
        "train",
        `--manifest=${manifestRelative}`,
        `--output=${outputRelative}`,
    ], root, {
        env: runnerEnvironment(),
        timeoutMs: TIMEOUT_MS,
        maxBufferBytes: OUTPUT_LIMIT,
        allowFailure: true,
    });
}
//# sourceMappingURL=laya-training-runner.js.map