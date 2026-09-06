import crypto from "node:crypto";
import { isPackageVersion, packageReleaseVersion } from "../lib/version.js";
/**
 * releaseのstage。
 *
 * **npm公開stageを持たない。** owner決裁でnpm registryへ公開しないことが確定しており、
 * `package.json`の`private: true`により`npm publish`は必ず失敗する。stageを残すと、
 * 方針上あってはならない経路を計画が宣言し続ける（Issue #1216）。
 */
const RELEASE_STAGES = [
    "validate",
    "tag",
    "github_release",
];
const REQUIRED_GATES = [
    "quality",
    "build",
    "package",
    "test",
    "typecheck",
];
const RELEASE_INPUT_KEYS = new Set([
    "currentVersion",
    "requestedVersion",
    "dryRun",
    "actor",
    "ref",
    "refSha",
    "defaultBranch",
    "existingTags",
    "gates",
]);
const AUTO_RELEASE_INPUT_KEYS = new Set([
    "currentVersion",
    "existingTags",
    "distributionDigest",
    "previousDistributionDigest",
    "headCommitMessage",
    "ref",
    "defaultBranch",
]);
const SHA256_HEX = /^[0-9a-f]{64}$/u;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.has(key));
}
function isGate(value) {
    return (isRecord(value) &&
        hasOnlyKeys(value, new Set(["name", "passed"])) &&
        typeof value.name === "string" &&
        value.name.length > 0 &&
        typeof value.passed === "boolean");
}
function compareUnicodeCodePoints(left, right) {
    const leftPoints = Array.from(left, (character) => character.codePointAt(0));
    const rightPoints = Array.from(right, (character) => character.codePointAt(0));
    const length = Math.max(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
        const leftPoint = leftPoints[index];
        const rightPoint = rightPoints[index];
        if (leftPoint === undefined)
            return -1;
        if (rightPoint === undefined)
            return 1;
        if (leftPoint !== rightPoint)
            return leftPoint < rightPoint ? -1 : 1;
    }
    return 0;
}
function stableDistributionJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableDistributionJson).join(",")}]`;
    if (isRecord(value))
        return `{${Object.entries(value)
            .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableDistributionJson(item)}`)
            .join(",")}}`;
    return JSON.stringify(value) ?? "null";
}
export function computeDistributionDigest(value) {
    if (!Array.isArray(value))
        return {
            digest: "",
            entryCount: 0,
            errors: ["配布entryは配列でなければなりません"],
        };
    const errors = [];
    const entries = [];
    const paths = new Set();
    if (value.length === 0)
        errors.push("配布entryが0件のため配布物は空です");
    value.forEach((entry, index) => {
        if (!isRecord(entry)) {
            errors.push(`配布entry[${index}]はobjectでなければなりません`);
            return;
        }
        const entryPath = entry.path;
        const contentHash = entry.contentHash;
        if (typeof entryPath !== "string" || entryPath.length === 0)
            errors.push(`配布entry[${index}].pathは空でない文字列でなければなりません`);
        if (typeof contentHash !== "string" || !SHA256_HEX.test(contentHash))
            errors.push(`配布entry[${index}].contentHashは64桁の小文字hexでなければなりません`);
        if (typeof entryPath === "string" && entryPath.length > 0) {
            if (paths.has(entryPath))
                errors.push(`配布entryのpath「${entryPath}」が重複しています`);
            paths.add(entryPath);
        }
        if (typeof entryPath === "string" &&
            entryPath.length > 0 &&
            typeof contentHash === "string" &&
            SHA256_HEX.test(contentHash))
            entries.push({ path: entryPath, contentHash });
    });
    if (errors.length > 0)
        return { digest: "", entryCount: value.length, errors };
    entries.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
    const canonical = entries.map(({ path, contentHash }) => [path, contentHash]);
    return {
        digest: crypto
            .createHash("sha256")
            .update(stableDistributionJson(canonical))
            .digest("hex"),
        entryCount: entries.length,
        errors: [],
    };
}
export function normalizeDistributionContent(filePath, content) {
    const normalizedPath = filePath.startsWith("./")
        ? filePath.slice(2)
        : filePath;
    if (normalizedPath !== "package.json" &&
        normalizedPath !== "package-lock.json")
        return content;
    try {
        const parsed = JSON.parse(content);
        if (isRecord(parsed)) {
            delete parsed.version;
            if (normalizedPath === "package-lock.json" &&
                isRecord(parsed.packages) &&
                isRecord(parsed.packages[""]))
                delete parsed.packages[""].version;
        }
        return stableDistributionJson(parsed);
    }
    catch {
        return content;
    }
}
function skippedAutoRelease(version, reasons) {
    return {
        state: "skipped",
        version,
        tag: version.length > 0 ? `v${version}` : "",
        needsVersionBump: false,
        reasons,
    };
}
function validateAutoReleaseInput(value) {
    if (!isRecord(value))
        return {
            version: "",
            reasons: ["自動release計画入力はobjectでなければなりません"],
        };
    const version = typeof value.currentVersion === "string" ? value.currentVersion : "";
    const reasons = [];
    if (!hasOnlyKeys(value, AUTO_RELEASE_INPUT_KEYS))
        reasons.push("自動release計画入力に未知fieldがあります");
    for (const key of [
        "currentVersion",
        "distributionDigest",
        "previousDistributionDigest",
        "headCommitMessage",
        "ref",
        "defaultBranch",
    ])
        if (typeof value[key] !== "string")
            reasons.push(`${key}は文字列でなければなりません`);
    if (!Array.isArray(value.existingTags) ||
        value.existingTags.some((item) => typeof item !== "string"))
        reasons.push("existingTagsは文字列配列でなければなりません");
    if (reasons.length > 0)
        return { version, reasons };
    return {
        version,
        reasons,
        input: {
            currentVersion: value.currentVersion,
            existingTags: value.existingTags,
            distributionDigest: value.distributionDigest,
            previousDistributionDigest: value.previousDistributionDigest,
            headCommitMessage: value.headCommitMessage,
            ref: value.ref,
            defaultBranch: value.defaultBranch,
        },
    };
}
export function nextAutoReleaseVersion(version) {
    const withoutBuild = version.split("+", 1)[0] ?? version;
    const prereleaseSeparator = withoutBuild.indexOf("-");
    if (prereleaseSeparator >= 0) {
        const core = withoutBuild.slice(0, prereleaseSeparator);
        const identifiers = withoutBuild.slice(prereleaseSeparator + 1).split(".");
        const lastIdentifier = identifiers.at(-1);
        if (!lastIdentifier || !/^\d+$/u.test(lastIdentifier))
            return undefined;
        identifiers[identifiers.length - 1] = (BigInt(lastIdentifier) + 1n).toString();
        const candidate = `${core}-${identifiers.join(".")}`;
        return isPackageVersion(candidate) ? candidate : undefined;
    }
    const core = packageReleaseVersion(version).split(".");
    const patch = core[2];
    if (core.length !== 3 || !patch || !/^\d+$/u.test(patch))
        return undefined;
    const candidate = `${core[0]}.${core[1]}.${BigInt(patch) + 1n}`;
    return isPackageVersion(candidate) ? candidate : undefined;
}
export function planAutoRelease(value) {
    const validated = validateAutoReleaseInput(value);
    if (!validated.input)
        return skippedAutoRelease(validated.version, validated.reasons);
    const input = validated.input;
    if (!isPackageVersion(input.currentVersion))
        return skippedAutoRelease(input.currentVersion, [
            `currentVersion「${input.currentVersion}」は0.3.xの正しいversion形式ではありません`,
        ]);
    if (input.ref !== input.defaultBranch)
        return skippedAutoRelease(input.currentVersion, [
            `release対象ref「${input.ref}」は既定branch「${input.defaultBranch}」と一致しないため停止します`,
        ]);
    if (input.headCommitMessage.includes("[skip ci]"))
        return skippedAutoRelease(input.currentVersion, [
            "head commit messageに[skip ci]があるため再帰releaseを停止します",
        ]);
    const currentTag = `v${input.currentVersion}`;
    if (!input.existingTags.includes(currentTag))
        return {
            state: "release",
            version: input.currentVersion,
            tag: currentTag,
            needsVersionBump: false,
            reasons: [
                `package.jsonのversionに対応するtag「${currentTag}」が存在しないためreleaseします`,
            ],
        };
    if (!SHA256_HEX.test(input.distributionDigest))
        return skippedAutoRelease(input.currentVersion, [
            "現在の配布digestを算出できなかったため自動releaseを停止します",
        ]);
    if (input.previousDistributionDigest.length > 0 &&
        input.distributionDigest === input.previousDistributionDigest)
        return skippedAutoRelease(input.currentVersion, [
            `配布物が前回release「${currentTag}」と同一のため自動releaseを停止します`,
        ]);
    const nextVersion = nextAutoReleaseVersion(input.currentVersion);
    if (!nextVersion)
        return skippedAutoRelease(input.currentVersion, [
            `version「${input.currentVersion}」を0.3.x内で安全にbumpできないため停止します`,
        ]);
    return {
        state: "release",
        version: nextVersion,
        tag: `v${nextVersion}`,
        needsVersionBump: false,
        reasons: [
            `tag「${currentTag}」が既に存在し配布物が変わったためtag「v${nextVersion}」を作成します`,
        ],
    };
}
function validatePlanInput(value) {
    if (!isRecord(value))
        return {
            reasons: ["release計画入力はobjectでなければなりません"],
            requestedVersion: "",
        };
    const requestedVersion = typeof value.requestedVersion === "string" ? value.requestedVersion : "";
    const reasons = [];
    if (!hasOnlyKeys(value, RELEASE_INPUT_KEYS))
        reasons.push("release計画入力に未知fieldがあります");
    for (const key of [
        "currentVersion",
        "requestedVersion",
        "actor",
        "ref",
        "refSha",
        "defaultBranch",
    ])
        if (typeof value[key] !== "string")
            reasons.push(`${key}は文字列でなければなりません`);
    if (typeof value.dryRun !== "boolean")
        reasons.push("dryRunはbooleanでなければなりません");
    if (!Array.isArray(value.existingTags) ||
        value.existingTags.some((tag) => typeof tag !== "string"))
        reasons.push("existingTagsは文字列配列でなければなりません");
    if (!Array.isArray(value.gates) || value.gates.some((gate) => !isGate(gate)))
        reasons.push("gatesはnameとpassedを持つ配列でなければなりません");
    if (reasons.length > 0)
        return { reasons, requestedVersion };
    const input = {
        currentVersion: value.currentVersion,
        requestedVersion: value.requestedVersion,
        dryRun: value.dryRun,
        actor: value.actor,
        ref: value.ref,
        refSha: value.refSha,
        defaultBranch: value.defaultBranch,
        existingTags: value.existingTags,
        gates: value.gates,
    };
    return { input, reasons, requestedVersion };
}
function prereleaseIdentifiers(version) {
    const withoutBuild = version.split("+", 1)[0] ?? version;
    const separator = withoutBuild.indexOf("-");
    return separator < 0
        ? undefined
        : withoutBuild.slice(separator + 1).split(".");
}
function compareIdentifiers(left, right) {
    const leftNumeric = /^\d+$/u.test(left);
    const rightNumeric = /^\d+$/u.test(right);
    if (leftNumeric && rightNumeric) {
        const leftNumber = BigInt(left);
        const rightNumber = BigInt(right);
        return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
    }
    if (leftNumeric !== rightNumeric)
        return leftNumeric ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}
function comparePackageVersions(left, right) {
    const leftCore = packageReleaseVersion(left).split(".");
    const rightCore = packageReleaseVersion(right).split(".");
    for (let index = 0; index < 3; index += 1) {
        const comparison = compareIdentifiers(leftCore[index] ?? "0", rightCore[index] ?? "0");
        if (comparison !== 0)
            return comparison;
    }
    const leftPrerelease = prereleaseIdentifiers(left);
    const rightPrerelease = prereleaseIdentifiers(right);
    if (!leftPrerelease && !rightPrerelease)
        return 0;
    if (!leftPrerelease)
        return 1;
    if (!rightPrerelease)
        return -1;
    const length = Math.max(leftPrerelease.length, rightPrerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftIdentifier = leftPrerelease[index];
        const rightIdentifier = rightPrerelease[index];
        if (leftIdentifier === undefined)
            return -1;
        if (rightIdentifier === undefined)
            return 1;
        const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
        if (comparison !== 0)
            return comparison;
    }
    return 0;
}
function rejectedPlan(version, reasons) {
    const tag = version.length > 0 ? `v${version}` : "";
    return {
        state: "rejected",
        version,
        tag,
        stages: RELEASE_STAGES.map((stage) => ({
            stage,
            enabled: false,
            reason: stage === "validate"
                ? "release条件の検証に失敗した"
                : "計画が拒否されたため外部更新しない",
        })),
        reasons,
        diagnostic: { ruleId: "ASC-RELEASE-PLAN", reasons: [...reasons] },
    };
}
export function planRelease(value) {
    const validated = validatePlanInput(value);
    if (!validated.input)
        return rejectedPlan(validated.requestedVersion, validated.reasons);
    const input = validated.input;
    const reasons = [];
    if (!isPackageVersion(input.requestedVersion))
        reasons.push(`requestedVersion「${input.requestedVersion}」は0.3.xの正しいversion形式ではありません`);
    if (!isPackageVersion(input.currentVersion))
        reasons.push(`currentVersion「${input.currentVersion}」は0.3.xの正しいversion形式ではありません`);
    if (isPackageVersion(input.requestedVersion) &&
        isPackageVersion(input.currentVersion) &&
        comparePackageVersions(input.requestedVersion, input.currentVersion) <= 0)
        reasons.push(`requestedVersion「${input.requestedVersion}」はcurrentVersion「${input.currentVersion}」から単調増加していません`);
    const tag = `v${input.requestedVersion}`;
    if (input.existingTags.includes(tag))
        reasons.push(`作成予定tag「${tag}」は既に存在します`);
    if (input.ref !== input.defaultBranch)
        reasons.push(`release対象ref「${input.ref}」は既定branch「${input.defaultBranch}」と一致しません`);
    if (!/^[0-9a-f]{40}$/iu.test(input.refSha))
        reasons.push("refShaは40桁hexでなければなりません");
    if (input.actor.trim().length === 0)
        reasons.push("release実行actorを空にできません");
    const gateNames = new Set(input.gates.map(({ name }) => name));
    const duplicateGates = input.gates
        .map(({ name }) => name)
        .filter((name, index, names) => names.indexOf(name) !== index);
    if (duplicateGates.length > 0)
        reasons.push(`gate名が重複しています: ${[...new Set(duplicateGates)].join(", ")}`);
    const missingGates = REQUIRED_GATES.filter((name) => !gateNames.has(name));
    if (missingGates.length > 0)
        reasons.push(`必須gateが欠落しています: ${missingGates.join(", ")}`);
    const failedGates = input.gates
        .filter(({ passed }) => !passed)
        .map(({ name }) => name);
    if (failedGates.length > 0)
        reasons.push(`失敗したgateがあります: ${failedGates.join(", ")}`);
    if (reasons.length > 0)
        return rejectedPlan(input.requestedVersion, reasons);
    if (input.dryRun)
        return {
            state: "dry-run",
            version: input.requestedVersion,
            tag,
            stages: RELEASE_STAGES.map((stage) => ({
                stage,
                enabled: stage === "validate",
                reason: stage === "validate"
                    ? "release前の検証を実行する"
                    : "dry-runのため外部更新しない",
            })),
            reasons: [],
        };
    return {
        state: "ready",
        version: input.requestedVersion,
        tag,
        stages: [
            { stage: "validate", enabled: true, reason: "release前検証に合格した" },
            {
                stage: "tag",
                enabled: true,
                reason: "明示されたversion tagを作成する",
            },
            {
                stage: "github_release",
                enabled: true,
                reason: "検証済みtagからGitHub Releaseを作成する",
            },
        ],
        reasons: [],
    };
}
function isReleaseOutcome(value) {
    return (isRecord(value) &&
        hasOnlyKeys(value, new Set(["stage", "state", "detail"])) &&
        RELEASE_STAGES.includes(value.stage) &&
        ["succeeded", "failed", "skipped"].includes(value.state) &&
        typeof value.detail === "string" &&
        value.detail.trim().length > 0);
}
export function summarizeReleaseOutcome(outcomes) {
    if (!Array.isArray(outcomes) ||
        outcomes.some((item) => !isReleaseOutcome(item)))
        return {
            state: "failed",
            completed: [],
            pending: [...RELEASE_STAGES],
            recovery: [
                "操作結果の形式を確認し、外部状態を読み直してからrelease計画を再作成してください",
            ],
        };
    const records = outcomes;
    const duplicates = records.filter(({ stage }, index) => records.findIndex((item) => item.stage === stage) !== index);
    if (duplicates.length > 0)
        return {
            state: "failed",
            completed: [],
            pending: [...RELEASE_STAGES],
            recovery: [
                `stage結果の重複（${[...new Set(duplicates.map(({ stage }) => stage))].join(", ")}）を解消し、外部状態を再確認してください`,
            ],
        };
    const byStage = new Map(records.map((outcome) => [outcome.stage, outcome]));
    const completed = RELEASE_STAGES.filter((stage) => byStage.get(stage)?.state === "succeeded");
    const pending = RELEASE_STAGES.filter((stage) => {
        const state = byStage.get(stage)?.state;
        return state === undefined || state === "failed";
    });
    const failed = records.some(({ state }) => state === "failed");
    const state = failed || pending.length > 0
        ? completed.length > 0
            ? "partial"
            : "failed"
        : "succeeded";
    const recovery = [];
    if (state !== "succeeded" && completed.includes("github_release"))
        recovery.push("GitHub Release作成済みの場合は対象tagとの対応を確認し、Releaseを削除してから再実行してください");
    if (state !== "succeeded" && completed.includes("tag"))
        recovery.push("Git tag作成済みの場合は参照SHAを確認し、GitHub Release未公開を確認してからremoteとlocalのtagを削除してください");
    if (state !== "succeeded" && pending.length > 0)
        recovery.push(`未完了stage（${pending.join(", ")}）の外部状態を確認し、原因を解消して新しいworkflow runで再計画してください`);
    return { state, completed, pending, recovery };
}
function indentation(line) {
    return /^\s*/u.exec(line)?.[0].length ?? 0;
}
function yamlBlock(lines, start) {
    const parentIndent = indentation(lines[start] ?? "");
    const block = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.trim().length > 0 && indentation(line) <= parentIndent)
            break;
        block.push(line);
    }
    return block;
}
function inputHasDefault(lines, inputName, expected) {
    const inputPattern = new RegExp(`^\\s*${inputName}:\\s*$`, "u");
    const index = lines.findIndex((line) => inputPattern.test(line));
    if (index < 0)
        return false;
    return yamlBlock(lines, index).some((line) => {
        const match = /^\s*default:\s*["']?(true|false)["']?\s*$/u.exec(line);
        return match?.[1] === expected;
    });
}
const DISTRIBUTION_VERIFICATION_SCRIPTS = [
    "prepack",
    "verify:distribution",
];
function blockHasDistributionVerification(block) {
    return DISTRIBUTION_VERIFICATION_SCRIPTS.some((script) => blockHasNpmRun(block, script));
}
/**
 * `npm run <script>`の実行を検出する。**script名の直後を境界で閉じる。**
 * `\b`では`verify:distribution-extra`のような接尾辞つきの別scriptを同じgateと誤認する。
 */
function npmRunPattern(scriptName) {
    const escapedScriptName = scriptName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\bnpm\\s+run\\s+${escapedScriptName}(?=\\s|$)`, "u");
}
function blockHasNpmRun(block, scriptName) {
    return npmRunPattern(scriptName).test(block.join("\n"));
}
/**
 * release workflowが定義するjob名の集合。
 *
 * `jobs:`直下の2 space indentのkeyだけを拾う。`on:`・`concurrency:`・`permissions:`は
 * top-levelなので混ざらない。
 */
/**
 * GitHub Actionsのjob ID。**英字または`_`で始まり、英数字・`-`・`_`を使える。**
 *
 * `[a-z][a-z0-9_]*`へ狭めると`deploy-docs`・`Deploy`・`_shared`が両方の集合から
 * 同時に落ち、集合差が空になって**未記載も廃止済みも検出できない**（PR #1195 の外部指摘）。
 */
const JOB_ID = "[A-Za-z_][A-Za-z0-9_-]*";
/**
 * 行末のYAMLコメント。**`jobs: # …`と`validate: # …`はどちらも正当なYAMLである。**
 *
 * 許さないと、コメントを付けたjobが集合から落ちて**未記載のjobを検出できない**
 * （PR #1197 の外部指摘）。PR #1195 のjob ID文法と同じfail-openである。
 */
const TRAILING_COMMENT = "\\s*(?:#.*)?";
export function releaseWorkflowJobNames(yaml) {
    const lines = yaml.split(/\r?\n/u);
    const jobsHeader = new RegExp(`^jobs:${TRAILING_COMMENT}$`, "u");
    const jobsIndex = lines.findIndex((line) => jobsHeader.test(line));
    if (jobsIndex < 0)
        return [];
    const pattern = new RegExp(`^ {2}(${JOB_ID}):${TRAILING_COMMENT}$`, "u");
    const names = [];
    for (const line of lines.slice(jobsIndex + 1)) {
        if (/^\S/u.test(line))
            break;
        const match = pattern.exec(line);
        if (match?.[1])
            names.push(match[1]);
    }
    return names;
}
/**
 * 運用設計の権限境界表が列挙するjob名の集合。
 *
 * 表の1列目が`` `<job>` ``形式の行だけを拾う。見出しと区切り行は形が合わない。
 */
/** 権限境界表を持つ節の見出し。 */
const PERMISSION_BOUNDARY_HEADING = "### 権限境界";
export function documentedReleaseJobNames(markdown) {
    const lines = markdown.split(/\r?\n/u);
    const start = lines.findIndex((line) => line.trim() === PERMISSION_BOUNDARY_HEADING);
    if (start < 0)
        return [];
    const pattern = new RegExp(`^\\|\\s*\`(${JOB_ID})\`\\s*\\|`, "u");
    const names = [];
    /**
     * **節の外の表を拾わない。** 次の見出しで走査を打ち切る。文書全体を走査すると、
     * 復旧手順表のような他の表の1列目をjob名と誤認する（PR #1195 の外部指摘）。
     */
    for (const line of lines.slice(start + 1)) {
        if (/^#{1,6}\s/u.test(line.trim()))
            break;
        const match = pattern.exec(line.trim());
        if (match?.[1])
            names.push(match[1]);
    }
    return names;
}
/**
 * release workflowのjob集合と運用設計の権限境界表を突き合わせる。
 *
 * **両方向を検査する。** 廃止したjobが文書へ残る形（Issue #1184でbump_versionが残った）と、
 * 新設したjobを文書へ書き忘れる形の両方を拒否する。**片方向だけでは、文書を空にすれば
 * 通ってしまう。**
 *
 * 判定するのは名前の集合一致だけであり、権限や開始条件の記述内容は判定しない。
 */
export function releaseJobDocumentationMismatch(input) {
    const defined = new Set(releaseWorkflowJobNames(input.yaml));
    const documented = new Set(documentedReleaseJobNames(input.markdown));
    const errors = [];
    const stale = [...documented].filter((name) => !defined.has(name)).sort();
    const missing = [...defined].filter((name) => !documented.has(name)).sort();
    if (stale.length > 0)
        errors.push(`運用設計の権限境界表がrelease workflowに存在しないjobを載せています: ${stale.join("、")}`);
    if (missing.length > 0)
        errors.push(`運用設計の権限境界表がrelease workflowのjobを載せていません: ${missing.join("、")}`);
    return errors;
}
export function validateReleaseWorkflow(yaml) {
    if (typeof yaml !== "string")
        return {
            valid: false,
            errors: ["workflow YAML本文は文字列でなければなりません"],
            checks: [],
        };
    const lines = yaml.split(/\r?\n/u);
    const errors = [];
    const checks = [];
    const onIndex = lines.findIndex((line) => /^\s*(?:on|["']on["']):\s*$/u.test(line));
    const onBlock = onIndex < 0 ? [] : yamlBlock(lines, onIndex);
    if (onIndex < 0 ||
        !onBlock.some((line) => /^\s*workflow_dispatch:\s*$/u.test(line)))
        errors.push("on:にはworkflow_dispatchを宣言してください");
    else
        checks.push("手動workflow_dispatch triggerを確認した");
    const pushIndex = onBlock.findIndex((line) => /^\s*push:\s*$/u.test(line));
    const pushBlock = pushIndex < 0 ? [] : yamlBlock(onBlock, pushIndex);
    if (pushIndex < 0)
        errors.push("on:にはpush triggerを宣言してください");
    else
        checks.push("自動push triggerを確認した");
    if (!pushBlock.some((line) => /^\s*branches:\s*\[\s*['"]?main['"]?\s*\]\s*$/u.test(line)))
        errors.push("push.branchesは[main]に限定してください");
    else
        checks.push("push branchがmainに限定されていることを確認した");
    const hasPaths = pushBlock.some((line) => /^\s*paths\s*:/u.test(line));
    if (hasPaths)
        errors.push("push.pathsで対象を限定せず、配布digestで判定してください");
    else
        checks.push("push pathsによる限定が無いことを確認した");
    const concurrencyIndex = lines.findIndex((line) => /^\s*concurrency:\s*$/u.test(line));
    const concurrencyBlock = concurrencyIndex < 0 ? [] : yamlBlock(lines, concurrencyIndex);
    if (concurrencyIndex < 0)
        errors.push("main更新の直列化にconcurrencyを宣言してください");
    else if (!concurrencyBlock.some((line) => /^\s*group:\s*main-mutator\s*$/u.test(line)) ||
        !concurrencyBlock.some((line) => /^\s*cancel-in-progress:\s*false\s*$/u.test(line)))
        errors.push("concurrencyはmain-mutatorをcancelせず直列実行してください");
    else
        checks.push("main-mutator concurrency宣言を確認した");
    const validateJobIndex = lines.findIndex((line) => /^ {2}validate:\s*$/u.test(line));
    const validateJobBlock = validateJobIndex < 0 ? [] : yamlBlock(lines, validateJobIndex);
    if (!blockHasDistributionVerification(validateJobBlock))
        errors.push("validate jobは引き続きnpm run prepackまたはnpm run verify:distributionを実行してください");
    else
        checks.push("validate jobの配布前品質検証の実行を確認した");
    if (!validateJobBlock.some((line) => /scripts\/compute_distribution_digest\.ts/u.test(line)))
        errors.push("validate jobはscripts/compute_distribution_digest.tsで配布digestを算出してください");
    else
        checks.push("validate jobの配布digest算出を確認した");
    if (!validateJobBlock.some((line) => /^\s*if:\s*.*!\s*contains\(github\.event\.head_commit\.message,\s*['"]\[skip ci\]['"]\)/u.test(line)))
        errors.push("validate jobに[skip ci]のhead commit message guardが必要です");
    else
        checks.push("job-levelの[skip ci]再帰防止guardを確認した");
    /**
     * **bump jobそのものを禁止する。**
     *
     * releaseは既定branchへ書き込まない（Issue #1184）。version bump jobを「gateを備えていれば
     * よい」形で許すと、mainを動かす経路が残る。**存在しないことを要求する。**
     */
    if (lines.some((line) => /^ {2}bump_version:\s*$/u.test(line)))
        errors.push("bump_version jobを置かないでください。releaseは既定branchへ書き込まずtagとGitHub Releaseだけを作ります");
    else
        checks.push("bump_version jobが存在しないことを確認した");
    if (/secrets\.RELEASE_MAIN_PAT/u.test(yaml))
        errors.push("RELEASE_MAIN_PATを使わないでください。既定branchへの書き込み権限をreleaseへ与えません");
    else
        checks.push("RELEASE_MAIN_PATを使わないことを確認した");
    if (/gh\s+pr\s+merge\b/u.test(yaml))
        errors.push("releaseからPRをmergeしないでください");
    else
        checks.push("releaseがPRをmergeしないことを確認した");
    if (/gh\s+pr\s+create\b/u.test(yaml))
        errors.push("releaseからPRを作成しないでください");
    else
        checks.push("releaseがPRを作成しないことを確認した");
    /**
     * **`git push`のoptionとrefspecの書き方を数え上げない。** `--force`、`-C <dir>`、
     * `HEAD:main`、`main:main`、`+main`のいずれも既定branchを動かす。
     * **`git push`から既定branch名へ到達する形をまとめて拒否する。**
     */
    if (/\bgit\b[^\n]*\bpush\b[^\n]*(?:^|[\s:+])(?:refs\/heads\/)?main\b/mu.test(yaml))
        errors.push("release workflowから既定branchへpushしないでください");
    else
        checks.push("既定branchへの直接pushがないことを確認した");
    /**
     * **後続のmain更新で追い越されたrunを止める。**
     *
     * trigger SHAがremote既定branch tipと異なるrunは、最新runが同じ配布物を再評価する。
     * 止めないと、重いgateを走らせたうえで古いtreeへtagを付けうる。
     * **tag書き込み直前にも同じ再読取を要求する**（validate通過後のmerge競合を塞ぐ）。
     */
    /**
     * **2箇所を別々に要求する。** 存在件数を見ないと、validate側かtag側の
     * どちらか1件だけを残すworkflowが通る。tag側だけを消せば重いgateの前で止まらず、
     * validate側だけを消せば**検証通過後にmainが動いても古いcommitへtagを付けられる。**
     */
    const validateJobTipCheck = validateJobBlock.some((line) => /git\s+ls-remote\s+(?:--exit-code\s+)?origin\s+["']?refs\/heads\//u.test(line));
    const tagJobIndex = lines.findIndex((line) => /^ {2}tag:\s*$/u.test(line));
    const tagJobBlock = tagJobIndex < 0 ? [] : yamlBlock(lines, tagJobIndex);
    const tagJobTipCheck = tagJobBlock.some((line) => /git\s+ls-remote\s+(?:--exit-code\s+)?origin\s+["']?refs\/heads\//u.test(line));
    if (!validateJobTipCheck)
        errors.push("validate jobにtrigger SHAとremote既定branch tipを照合するstepが必要です");
    else
        checks.push("validate jobのremote既定branch tip照合stepを確認した");
    if (!tagJobTipCheck)
        errors.push("tag jobにtag書き込み直前のremote既定branch tip再照合stepが必要です");
    else
        checks.push("tag jobのremote既定branch tip再照合stepを確認した");
    /**
     * **再照合stepはcheckoutの後に置く。** checkout前の`git ls-remote origin`は
     * workspaceにrepositoryも`origin`も無いため解決できず、空の観測値で必ず停止する。
     * 外部reviewerがPR #1189 でCriticalとして検出した。
     */
    const tagCheckoutIndex = tagJobBlock.findIndex((line) => /uses:\s*actions\/checkout@/u.test(line));
    const tagTipCheckIndex = tagJobBlock.findIndex((line) => /git\s+ls-remote\s+(?:--exit-code\s+)?origin\s+["']?refs\/heads\//u.test(line));
    if (tagJobTipCheck &&
        (tagCheckoutIndex < 0 || tagTipCheckIndex < tagCheckoutIndex))
        errors.push("tag jobのremote既定branch tip再照合はactions/checkoutより後に置いてください");
    else
        checks.push("tag jobの再照合がcheckoutより後にあることを確認した");
    if (!/rev-list\s+--parents\s+-n\s*1|--pretty=%P|\bgit\s+show\b[^\n]*%P/u.test(yaml))
        errors.push("release対象commitの親が2つであることを確認するstepが必要です");
    else
        checks.push("2-parent判定を確認した");
    const permissionsDeclared = lines.some((line) => /^\s*permissions:\s*$/u.test(line));
    if (!permissionsDeclared)
        errors.push("permissionsを明示してください");
    else
        checks.push("permissions宣言を確認した");
    if (!lines.some((line) => /^\s*contents:\s*(?:read|write)\s*$/u.test(line)))
        errors.push("permissions.contentsはreadまたはwriteを明示してください");
    else
        checks.push("contents権限の明示を確認した");
    if (!inputHasDefault(lines, "dry_run", "true"))
        errors.push("dry_run入力を宣言しdefaultをtrueにしてください");
    else
        checks.push("dry_run=trueの安全な既定値を確認した");
    /**
     * **npm公開経路そのものを拒否する。** 条件付きで許すのではなく存在を許さない。
     * 条件付きにすると、条件を満たす入力を与えるだけで方針違反の経路が開く。
     */
    if (lines.some((line) => /\bnpm\s+publish\b/u.test(line)))
        errors.push("npm公開stepを置かないでください。npm registryへは公開しません");
    else
        checks.push("npm公開stepが存在しないことを確認した");
    if (lines.some((line) => /^\s*publish_npm\s*:/u.test(line)))
        errors.push("publish_npm入力を宣言しないでください。npm公開経路は存在しません");
    else
        checks.push("publish_npm入力が存在しないことを確認した");
    /**
     * **consumer acceptanceの`git-dependency`をtag作成より前で実行させる。**
     * `packed-bin`と`scale-output`は`package:check`から毎回実行されるが、
     * `git-dependency`だけはどのreleaseでも実行されていなかった（Issue #1216）。
     */
    if (!/--mechanisms=[^\s]*git-dependency/u.test(yaml))
        errors.push("validate jobでconsumer acceptanceのgit-dependencyを実行してください");
    else
        checks.push("git-dependency acceptanceの実行を確認した");
    if (![...DISTRIBUTION_VERIFICATION_SCRIPTS, "quality"].some((script) => npmRunPattern(script).test(yaml)))
        errors.push("release前の品質gateとしてnpm run prepack、npm run verify:distribution、npm run qualityのいずれかが必要です");
    else
        checks.push("release前の品質gateを確認した");
    if (!/git\s+ls-remote\s+--tags\b/u.test(yaml))
        errors.push("tag作成前後にremote tagの存在確認が必要です");
    else
        checks.push("Git tagの冪等な存在確認を確認した");
    if (!/gh\s+release\s+view\b/u.test(yaml))
        errors.push("GitHub Release作成前後に既存Releaseの確認が必要です");
    else
        checks.push("GitHub Releaseの冪等な存在確認を確認した");
    if (!/--title\s+["']\$RELEASE_TAG["']/u.test(yaml))
        errors.push("GitHub Release名はpackage versionから導いたtag名と一致させてください");
    else
        checks.push("GitHub Release名とtag名の一致を確認した");
    const secretOutput = lines.some((line) => /(?:^|\s)(?:echo|cat)(?:\s|$)/u.test(line) &&
        /(?:\$\{\{\s*secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|TOKEN|PASSWORD|SECRET)/iu.test(line));
    if (secretOutput)
        errors.push("秘密値をechoまたはcatで出力するstepがあります");
    else
        checks.push("秘密値をechoまたはcatで出力しないことを確認した");
    if (!lines.some((line) => /^\s*-?\s*name:\s*.*[\u3040-\u30ff\u3400-\u9fff]/u.test(line)))
        errors.push("日本語のstep名が必要です");
    else
        checks.push("日本語のstep名を確認した");
    return { valid: errors.length === 0, errors, checks };
}
//# sourceMappingURL=release.js.map