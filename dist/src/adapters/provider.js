import { run, runJsonlSession, } from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { isRecord } from "../types.js";
const PROVIDER_NAME = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const MODEL_SLUG = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const CODEX_RESPONSE_ID = 1;
const PROVIDER_TIMEOUT_MS = 10_000;
function parseJsonLines(stdout) {
    return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseJsonStrict(line, "provider JSONL response"));
}
function parseTerminatedJsonLines(stdout) {
    return parseJsonLines(stdout.slice(0, stdout.lastIndexOf("\n") + 1));
}
function hasCodexResponse(stdout) {
    for (const line of stdout
        .slice(0, stdout.lastIndexOf("\n") + 1)
        .split("\n")) {
        const source = line.trim();
        if (!source)
            continue;
        try {
            const message = parseJsonStrict(source, "provider JSONL response");
            if (isRecord(message) && message.id === CODEX_RESPONSE_ID)
                return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
function codexInput() {
    return [
        {
            method: "initialize",
            id: 0,
            params: {
                clientInfo: {
                    name: "agent-skill-chain",
                    title: "agent-skill-chain",
                    version: PACKAGE_VERSION,
                },
            },
        },
        { method: "initialized", params: {} },
        {
            method: "model/list",
            id: CODEX_RESPONSE_ID,
            params: { limit: 1000, includeHidden: false },
        },
    ]
        .map((message) => JSON.stringify(message))
        .join("\n")
        .concat("\n");
}
function codexCatalog(stdout) {
    const response = parseTerminatedJsonLines(stdout).find((message) => isRecord(message) && message.id === CODEX_RESPONSE_ID);
    if (!isRecord(response) || !isRecord(response.result))
        return undefined;
    const result = response.result;
    if (!Array.isArray(result.data) ||
        (result.nextCursor !== null && result.nextCursor !== undefined))
        return undefined;
    const modelMetadata = [];
    for (const entry of result.data) {
        if (!isRecord(entry) ||
            typeof entry.model !== "string" ||
            !MODEL_SLUG.test(entry.model) ||
            (entry.isDefault !== undefined && typeof entry.isDefault !== "boolean") ||
            entry.hidden === true)
            return undefined;
        const efforts = entry.supportedReasoningEfforts;
        if (efforts !== undefined && !Array.isArray(efforts))
            return undefined;
        const supportedReasoningEfforts = (efforts ?? []).map((effort) => isRecord(effort) ? effort.reasoningEffort : undefined);
        if (supportedReasoningEfforts.some((effort) => typeof effort !== "string" ||
            !/^[a-z][a-z0-9_-]{0,31}$/u.test(effort)) ||
            new Set(supportedReasoningEfforts).size !==
                supportedReasoningEfforts.length)
            return undefined;
        modelMetadata.push({
            model: entry.model,
            recommended: entry.isDefault === true,
            supportedReasoningEfforts: supportedReasoningEfforts,
        });
    }
    const models = modelMetadata.map((entry) => entry.model);
    if (new Set(models).size !== models.length)
        return undefined;
    return {
        available: models.length > 0,
        models,
        modelMetadata,
    };
}
async function defaultExecutor(file, args, cwd, options) {
    if (file !== "codex")
        return run(file, args, cwd, options);
    return runJsonlSession(file, args, cwd, {
        ...options,
        input: codexInput(),
        timeoutMs: options.timeoutMs ?? PROVIDER_TIMEOUT_MS,
        isComplete: hasCodexResponse,
    });
}
function isLegacyProviderCatalog(value) {
    if (!isRecord(value))
        return false;
    if (Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, "available") ||
        !Object.hasOwn(value, "models") ||
        typeof value.available !== "boolean" ||
        !Array.isArray(value.models))
        return false;
    const models = value.models;
    if (models.some((model) => typeof model !== "string" || !MODEL_SLUG.test(model)) ||
        new Set(models).size !== models.length)
        return false;
    return value.available ? models.length > 0 : models.length === 0;
}
function unknownObservation(provider, observedAt, reason) {
    return {
        provider,
        state: "unknown",
        models: [],
        modelMetadata: [],
        observedAt,
        entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
        reason,
    };
}
export async function observeProvider(provider, execute = defaultExecutor, now = () => new Date()) {
    const observedAt = now().toISOString();
    if (!PROVIDER_NAME.test(provider))
        return unknownObservation(provider, observedAt, "provider実行入口の名前が不正です");
    let result;
    try {
        result = await execute(provider, provider === "codex"
            ? ["app-server", "--stdio"]
            : ["models", "list", "--json"], process.cwd(), { allowFailure: true, timeoutMs: PROVIDER_TIMEOUT_MS });
    }
    catch {
        return unknownObservation(provider, observedAt, "provider実行入口を起動できません");
    }
    if (result.status !== 0)
        return unknownObservation(provider, observedAt, "provider実行入口のread-only観測が失敗しました");
    let catalog;
    try {
        if (provider === "codex")
            catalog = codexCatalog(result.stdout);
        else {
            const value = parseJsonStrict(result.stdout, "provider model catalog");
            if (isLegacyProviderCatalog(value))
                catalog = {
                    available: value.available,
                    models: [...value.models],
                    modelMetadata: value.models.map((model) => ({
                        model,
                        recommended: false,
                        supportedReasoningEfforts: [],
                    })),
                };
        }
    }
    catch {
        return unknownObservation(provider, observedAt, "provider model catalogを解釈できません");
    }
    if (!catalog)
        return unknownObservation(provider, observedAt, "provider model catalogの構造が不正です");
    return {
        provider,
        state: catalog.available ? "available" : "unavailable",
        models: [...catalog.models],
        modelMetadata: catalog.modelMetadata.map((entry) => ({
            ...entry,
            supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
        })),
        observedAt,
        entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
    };
}
//# sourceMappingURL=provider.js.map