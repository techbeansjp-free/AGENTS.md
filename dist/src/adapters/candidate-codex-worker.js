import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/process.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import { codexPackageRoot, makeDirectoriesRemovable, workerWriteRoots, workerExecutable, } from "./candidate-worker-boundary.js";
const MAX_WORKER_MS = 30 * 60 * 1000;
/** Provider-reported usage only; do not infer missing agents or billing totals. */
export function parseCodexCandidateUsage(source) {
    const sums = {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
    };
    let completed = 0;
    for (const line of source.split("\n")) {
        if (!line.trim())
            continue;
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            return null;
        }
        if (typeof event !== "object" ||
            event === null ||
            !("type" in event) ||
            event.type !== "turn.completed")
            continue;
        if (!("usage" in event) ||
            typeof event.usage !== "object" ||
            event.usage === null)
            return null;
        const usage = event.usage;
        const fields = [
            ["inputTokens", "input_tokens"],
            ["cachedInputTokens", "cached_input_tokens"],
            ["cacheWriteInputTokens", "cache_write_input_tokens"],
            ["outputTokens", "output_tokens"],
            ["reasoningOutputTokens", "reasoning_output_tokens"],
        ];
        if (fields.some(([, sourceKey]) => typeof usage[sourceKey] !== "number" ||
            !Number.isSafeInteger(usage[sourceKey]) ||
            usage[sourceKey] < 0) ||
            usage.cached_input_tokens > usage.input_tokens ||
            usage.reasoning_output_tokens >
                usage.output_tokens)
            return null;
        for (const [target, sourceKey] of fields) {
            sums[target] += usage[sourceKey];
            if (!Number.isSafeInteger(sums[target]))
                return null;
        }
        completed += 1;
    }
    return completed > 0 ? { ...sums, source: "codex-turn-completed" } : null;
}
/** Keep provider authentication on Codex itself, not on its spawned tools. */
export function codexCandidateEnvironment(runtime, parent = process.env) {
    const env = {
        PATH: parent.PATH ?? "/usr/bin:/bin",
        HOME: parent.HOME,
        LANG: parent.LANG ?? "C.UTF-8",
        TMPDIR: runtime,
        ...(parent.CODEX_HOME ? { CODEX_HOME: parent.CODEX_HOME } : {}),
    };
    for (const name of [
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
    ]) {
        if (parent[name])
            env[name] = parent[name];
    }
    return {
        env,
        toolPolicy: [
            "-c",
            'shell_environment_policy.inherit="none"',
            "-c",
            `shell_environment_policy.set={ PATH=${JSON.stringify(env.PATH)}, HOME=${JSON.stringify(env.HOME ?? "")}, LANG=${JSON.stringify(env.LANG)}, TMPDIR=${JSON.stringify(runtime)} }`,
        ],
    };
}
/** Codex talks to its provider outside the tool sandbox; every model tool uses this profile. */
export function runCandidateCodexWorker(input) {
    if (process.platform !== "linux")
        throw new Error("candidate Codex profileをこのhostで強制できません");
    const root = fs.realpathSync(input.root);
    const workspace = resolveGitWorkspace(root);
    if (workspace.activeRoot === workspace.primaryRoot)
        throw new Error("candidate Codex Workerには専用Git worktreeが必要です");
    const localCodexConfig = path.join(root, ".codex", "config.toml");
    if (fs.lstatSync(localCodexConfig, { throwIfNoEntry: false }))
        throw new Error("candidate Codex Workerはproject-local Codex configを読み込めません");
    const writes = workerWriteRoots(root, input.allowedPaths);
    const codexExecutable = workerExecutable(["codex"]);
    if (codexExecutable === root ||
        codexExecutable.startsWith(`${root}${path.sep}`) ||
        codexExecutable === workspace.primaryRoot ||
        codexExecutable.startsWith(`${workspace.primaryRoot}${path.sep}`))
        throw new Error("candidate Codex実行fileを対象repositoryから読めません");
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "asc-candidate-codex-"));
    const sentinel = path.join(path.dirname(root), `.asc-candidate-codex-boundary-${crypto.randomUUID()}`);
    const profile = `asc_candidate_codex_${crypto.randomUUID().replaceAll("-", "")}`;
    const filesystem = new Map([
        [":root", "deny"],
        [":minimal", "read"],
        [codexPackageRoot(), "read"],
        [sentinel, "read"],
        [root, "read"],
        [runtime, "write"],
        ...writes.map((item) => [item, "write"]),
        [path.join(root, ".git"), "read"],
        [path.join(workspace.primaryRoot, ".git"), "read"],
    ]);
    const table = [...filesystem]
        .map(([name, access]) => `${JSON.stringify(name)} = "${access}"`)
        .join(", ");
    const config = [
        "-c",
        `default_permissions="${profile}"`,
        "-c",
        `permissions.${profile}.filesystem={ ${table} }`,
        "-c",
        `permissions.${profile}.network.enabled=false`,
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.multi_agent_v2=false",
        "-c",
        'web_search="disabled"',
        "-c",
        "features.enable_mcp_apps=false",
        "-c",
        "features.shell_snapshot=false",
    ];
    const { env, toolPolicy } = codexCandidateEnvironment(runtime);
    config.push(...toolPolicy);
    try {
        fs.writeFileSync(sentinel, "trusted\n", { flag: "wx", mode: 0o600 });
        const sandbox = ["sandbox", "-P", profile, ...config, "-C", root, "--"];
        const healthy = run(codexExecutable, [...sandbox, "/bin/true"], root, {
            allowFailure: true,
            timeoutMs: 20_000,
            env,
        });
        if (healthy.status !== 0)
            throw new Error(`candidate Codex profileを起動できません: ${healthy.stderr.slice(0, 500)}`);
        const probe = run(codexExecutable, [...sandbox, "/bin/sh", "-c", 'printf x >> "$1"', "probe", sentinel], root, { allowFailure: true, timeoutMs: 20_000, env });
        if (probe.status === 0 || fs.readFileSync(sentinel, "utf8") !== "trusted\n")
            throw new Error("candidate Codex profileのCoordinator書込禁止を確認できません");
        const prompt = [
            "Implement the user's request in this disposable Git worktree.",
            `Intent: ${input.intent}`,
            `Correctness criterion: ${input.correctnessCriterion}`,
            `Writable source paths: ${input.allowedPaths.join(", ")}`,
            "Modify only the listed source paths. Do not commit, alter Git metadata, use web search, browser, connectors, MCP, or subagents, or claim tests passed without running them.",
        ].join("\n");
        const startedAt = performance.now();
        const worker = run(codexExecutable, [
            "exec",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
            "-C",
            root,
            ...config,
            "-c",
            'approval_policy="never"',
            prompt,
        ], root, {
            allowFailure: true,
            timeoutMs: MAX_WORKER_MS,
            maxBufferBytes: 16 * 1024 * 1024,
            env,
        });
        return {
            boundary: "codex-profile",
            status: worker.status,
            stdout: worker.stdout,
            stderr: worker.stderr,
            usage: parseCodexCandidateUsage(worker.stdout),
            elapsedMs: Math.round(performance.now() - startedAt),
        };
    }
    finally {
        fs.rmSync(sentinel, { force: true });
        try {
            fs.rmSync(runtime, { recursive: true, force: true });
        }
        catch {
            makeDirectoriesRemovable(runtime);
            fs.rmSync(runtime, { recursive: true, force: true });
        }
    }
}
//# sourceMappingURL=candidate-codex-worker.js.map