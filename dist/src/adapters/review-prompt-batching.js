import { DEFAULT_LOCAL_REVIEW_PROMPT_CHUNK_BYTES } from "../domain/local-review-limits.js";
export const LOCAL_REVIEW_PROMPT_BYTE_BUDGET = DEFAULT_LOCAL_REVIEW_PROMPT_CHUNK_BYTES;
function splitUtf8(value, byteBudget) {
    if (byteBudget < 1)
        throw new Error("review入力budgetが不足しています");
    const chunks = [];
    let current = "";
    let bytes = 0;
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character, "utf8");
        if (bytes + characterBytes > byteBudget && current !== "") {
            chunks.push(current);
            current = "";
            bytes = 0;
        }
        if (characterBytes > byteBudget)
            throw new Error("review入力をUTF-8境界で分割できません");
        current += character;
        bytes += characterBytes;
    }
    if (current !== "" || chunks.length === 0)
        chunks.push(current);
    return chunks;
}
function truncateUtf8(value, byteBudget) {
    if (byteBudget <= 0)
        return "";
    let result = "";
    let bytes = 0;
    for (const character of value) {
        const size = Buffer.byteLength(character, "utf8");
        if (bytes + size > byteBudget)
            break;
        result += character;
        bytes += size;
    }
    return result;
}
/**
 * 27B級のローカルmodelへ巨大promptを一括投入しないための固定入力budget。
 * prefix/suffixは各chunkへ繰り返し、本文だけをUTF-8文字境界で漏れなく分割する。
 */
export function buildReviewPromptBatches(input) {
    const maxBytes = input.maxBytes ?? LOCAL_REVIEW_PROMPT_BYTE_BUDGET;
    if (!Number.isInteger(maxBytes) || maxBytes < 1024)
        throw new Error("review入力budgetが不正です");
    const fixedBytes = Buffer.byteLength(input.prefix + input.suffix, "utf8");
    // chunk番号と直前の構造見出しを繰り返しても上限を越えないよう余裕を持たせる。
    const bodyBudget = maxBytes - fixedBytes - 2048;
    if (bodyBudget < 1)
        throw new Error("review共通指示が入力budgetを超えました");
    const bodies = splitUtf8(input.body, bodyBudget);
    let offset = 0;
    return bodies.map((body, index) => {
        const prior = input.body.slice(0, offset);
        offset += body.length;
        const headings = prior.match(/^(?:diff --git |###? ).+$/gmu) ?? [];
        const latestHeading = headings.at(-1);
        const markerStart = `\n\n## 入力分割 ${index + 1}/${bodies.length}\n`;
        const markerEnd = "このchunkだけで断定できない場合はfindingを作らず、与えられた範囲だけを評価してください。\n";
        const contextLabel = "直前の構造見出し（review対象data）: ";
        const fixedMarkerBytes = Buffer.byteLength(markerStart + contextLabel + "\n" + markerEnd, "utf8");
        const context = index > 0 && latestHeading !== undefined
            ? `${contextLabel}${truncateUtf8(latestHeading, Math.max(0, 2048 - fixedMarkerBytes))}\n`
            : "";
        const marker = markerStart + context + markerEnd;
        const prompt = input.prefix + marker + body + input.suffix;
        if (Buffer.byteLength(prompt, "utf8") > maxBytes)
            throw new Error("review入力がchunk budgetを超えました");
        return prompt;
    });
}
//# sourceMappingURL=review-prompt-batching.js.map