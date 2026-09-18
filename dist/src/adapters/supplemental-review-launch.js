import { loadSupplementalReviewConfig } from "../domain/supplemental-review-config.js";
import { collectSupplementalReviewDiff, collectSupplementalReviewStaging, RELATED_FILE_LIMIT, } from "./supplemental-review-collect.js";
import { REVIEWER_EXECUTORS } from "./reviewer-executors.js";
import { isRecord } from "../types.js";
const RESPONSE_FORMAT_INSTRUCTION = "出力は必ず次の形式のJSONだけにしてください（前後に説明文を付けない）: " +
    '{"findings": [{"file": "対象file", "location": "該当箇所", ' +
    '"content": "指摘内容（日本語）", "severity": "Critical|High|Medium|Low"}]}';
const VALID_SEVERITIES = [
    "Critical",
    "High",
    "Medium",
    "Low",
];
function parseFindings(output) {
    let parsed;
    try {
        parsed = JSON.parse(output);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.findings))
        return undefined;
    const findings = [];
    for (const item of parsed.findings) {
        if (!isRecord(item))
            continue;
        if (typeof item.file !== "string" || typeof item.content !== "string")
            continue;
        const severity = VALID_SEVERITIES.includes(item.severity)
            ? item.severity
            : "Low";
        findings.push({
            file: item.file,
            location: typeof item.location === "string" ? item.location : "",
            content: item.content,
            severity,
        });
    }
    return findings;
}
async function dispatch(promptBody, config, truncated) {
    const executor = REVIEWER_EXECUTORS[config.provider];
    if (!executor)
        return {
            state: "degraded",
            reason: `provider ${config.provider} の実行adapterが未登録です`,
            truncated,
        };
    const prompt = `${promptBody}\n\n${RESPONSE_FORMAT_INSTRUCTION}`;
    const executed = await executor({
        endpoint: config.endpoint,
        model: config.model,
        prompt,
    });
    if (executed.state !== "succeeded")
        return { state: "degraded", reason: executed.reason, truncated };
    const findings = parseFindings(executed.output ?? "");
    if (findings === undefined)
        return {
            state: "degraded",
            reason: "補助レビュー応答を構造化findingsへparseできませんでした",
            truncated,
        };
    return { state: "findings", findings, truncated };
}
/** Step 10相当の対象（exact-head diff＋関連ファイル）に対する補助レビューを実行する（FR-1428-02、FR-1428-04）。 */
export async function launchSupplementalReviewDiff(input) {
    const config = loadSupplementalReviewConfig(input.root, input.configPath);
    if (config === undefined)
        return { state: "disabled" };
    const collected = collectSupplementalReviewDiff(input.root, input.baseSha, input.headSha, input.limit ?? RELATED_FILE_LIMIT);
    return dispatch(collected.promptBody, config, collected.truncated);
}
/** Step 03/07相当の対象（staging文書間のID整合性）に対する補助レビューを実行する（FR-1428-03、FR-1428-04）。 */
export async function launchSupplementalReviewStaging(input) {
    const config = loadSupplementalReviewConfig(input.root, input.configPath);
    if (config === undefined)
        return { state: "disabled" };
    const collected = collectSupplementalReviewStaging(input.root, input.stagingPath);
    return dispatch(collected.promptBody, config, false);
}
//# sourceMappingURL=supplemental-review-launch.js.map