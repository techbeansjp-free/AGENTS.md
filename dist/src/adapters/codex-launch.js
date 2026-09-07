import fs from "node:fs";
import path from "node:path";
import { loadOperationPolicy } from "../domain/policy.js";
import { requiredTier, validateCodexTier, validateRoleAssignment, MODEL_TIERS, CODEX_ADOPTION_SELECTOR, } from "../domain/role.js";
import { resolveRouting } from "../domain/routing.js";
import { resolveContained } from "../lib/security.js";
import { observeProvider } from "./provider.js";
import { executeCodex } from "./codex-execution.js";
function rejection(reason) {
    return {
        state: "rejected",
        dispatched: false,
        reason,
        next: "入力・Codex公式観測・trusted project choiceを修復して再実行してください。起動済みtaskの自動再送は行いません",
    };
}
function readPrompt(input) {
    const root = path.resolve(input.root);
    if (fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory())
        throw new Error("rootはsymlinkを含まない通常directoryが必要です");
    if (/[\p{Cc}\p{Cf}]/u.test(input.promptFile) ||
        input.promptFile.normalize("NFC") !== input.promptFile)
        throw new Error("prompt-fileに制御文字または非NFC名を使用できません");
    const file = resolveContained(root, input.promptFile);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(file) !== file ||
        stat.size > 1024 * 1024)
        throw new Error("prompt-fileはroot内の1MiB以下の通常fileが必要です");
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (opened.dev !== stat.dev ||
            opened.ino !== stat.ino ||
            opened.size > 1024 * 1024)
            throw new Error("prompt-fileが読取直前に変化しました");
        const prompt = fs.readFileSync(descriptor, "utf8");
        if (prompt.trim() === "" || Buffer.byteLength(prompt) > 1024 * 1024)
            throw new Error("prompt-fileは空でない1MiB以下のtask本文が必要です");
        return { root, prompt };
    }
    finally {
        fs.closeSync(descriptor);
    }
}
/** Each invocation reads trusted adoption and a new official catalog before dispatch. */
export async function launchCodex(input, dependencies = {}) {
    const identifiers = [
        input.scope,
        input.coordinator,
        input.implementer,
        input.reviewer,
        input.implementerContext,
        input.reviewerContext,
    ];
    if (identifiers.some((value) => value.trim() === "" ||
        value.length > 512 ||
        /[\p{Cc}\p{Cf}]/u.test(value)))
        return rejection("scope、identity、contextは制御文字を含まない非空値が必要です");
    if (!["full", "quick", "poc"].includes(input.mode) ||
        !/^[a-z][a-z_-]{0,63}$/u.test(input.risk))
        return rejection("modeはfull/quick/poc、riskはprojectのrisk名が必要です");
    if (!["read-only", "workspace-write"].includes(input.sandbox))
        return rejection("sandboxはread-onlyまたはworkspace-writeだけを指定できます");
    if (input.coordinator === input.implementer)
        return rejection("coordinatorとimplementerを別identityへ割り当ててください");
    const roles = validateRoleAssignment({
        scope: input.scope,
        assignments: [
            {
                role: "coordinator",
                identity: input.coordinator,
                context: "coordinator",
            },
            {
                role: "implementer",
                identity: input.implementer,
                context: input.implementerContext,
            },
            {
                role: "reviewer",
                identity: input.reviewer,
                context: input.reviewerContext,
            },
        ],
    });
    if (!roles.valid)
        return rejection(roles.errors.join(" / "));
    const { root, prompt } = readPrompt(input);
    const trusted = loadOperationPolicy(root);
    const choices = trusted.policy.projectChoices?.modelMapping;
    if (!choices || typeof choices === "string")
        return rejection("trusted modelMappingが未設定です");
    const policySha = trusted.provenance.commitSha;
    if (typeof policySha !== "string" || !/^[a-f0-9]{40}$/u.test(policySha))
        return rejection("trusted policyの固定commit SHAを確認できません");
    if (choices.roles.implementer.provider !== "codex")
        return rejection("trusted implementer providerがCodexではありません");
    if (!Object.hasOwn(choices.minimumTierByRisk ?? {}, input.risk))
        return rejection("riskはtrusted minimumTierByRiskに定義した名前が必要です");
    const minimum = requiredTier({
        risk: input.risk,
        mode: input.mode,
        scope: input.scope,
    });
    const configured = choices.minimumTierByRisk?.[input.risk];
    const required = configured && MODEL_TIERS.indexOf(configured) > MODEL_TIERS.indexOf(minimum)
        ? configured
        : minimum;
    const tier = validateCodexTier({
        required,
        mapping: choices.tierMapping ?? {},
    });
    if (!tier.valid)
        return rejection(tier.errors.join(" / "));
    const mapping = "providerMappings" in trusted ? trusted.providerMappings[0] : undefined;
    if (!mapping)
        return rejection("trusted provider capability mappingが未設定です");
    const observation = await observeProvider("codex", dependencies.observeExecutor, undefined, { cwd: root, official: true });
    if (observation.state !== "available")
        return rejection(observation.reason ?? "Codex公式一覧を取得できません");
    const decision = resolveRouting({
        scope: input.scope,
        coordinatorIdentity: input.coordinator,
        implementerIdentity: input.implementer,
        reviewerIdentity: input.reviewer,
        availability: observation,
        mapping,
        modelMapping: choices,
        requiredCapability: "coding",
        evaluatorRef: policySha,
    });
    if (decision.state !== "resolved")
        return rejection(decision.reason);
    if (decision.routeMode !== "preferred" || decision.provider !== "codex")
        return rejection(`公式推奨Codexの起動条件が不成立です: ${decision.routingReason}`);
    const rechecked = loadOperationPolicy(root);
    if (rechecked.provenance.commitSha !== policySha)
        return rejection("trusted policyが観測中に変化しました。新しい起動要求で再検証してください");
    const dispatched = await (dependencies.execute ?? executeCodex)({
        root,
        model: decision.model,
        prompt,
        sandbox: input.sandbox,
    });
    return {
        ...dispatched,
        dispatched: true,
        scope: input.scope,
        observedAt: observation.observedAt,
        entrypoint: observation.entrypoint,
        selectedModel: decision.model,
        dispatchedModel: decision.model,
        modelEvidence: "dispatch_arguments",
        reasoningEffort: decision.reasoningEffort,
        serviceTier: decision.serviceTier,
        requiredTier: required,
        adoptedTier: choices.tierMapping[CODEX_ADOPTION_SELECTOR],
        trustedPolicySha: policySha,
        sandbox: input.sandbox,
    };
}
//# sourceMappingURL=codex-launch.js.map