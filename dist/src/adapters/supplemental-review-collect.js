import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { resolveContained } from "../lib/security.js";
export const RELATED_FILE_LIMIT = 20;
const ID_PATTERN = /\b(?:AC|FR|NFR|INV|RQ|OUTCOME|DC|TERM-ASC)-\d+\b/g;
/**
 * Step 10相当の対象を収集する。base..headの変更fileと、その呼び出し元
 * （fileの識別子を含む他file）を関連fileとして追加する。上限件数で
 * 打ち切る（FR-1428-02、NFR-1428-06）。
 */
export function collectSupplementalReviewDiff(root, baseSha, headSha, limit = RELATED_FILE_LIMIT) {
    const nameStatus = git(["diff", "--name-status", `${baseSha}..${headSha}`], root).stdout;
    const changed = nameStatus
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.split("\t").at(-1) ?? "")
        .filter((value) => value !== "");
    const diffText = git(["diff", `${baseSha}..${headSha}`], root).stdout;
    const related = [];
    let truncated = false;
    for (const changedPath of changed) {
        if (truncated)
            break;
        const stem = path.basename(changedPath, path.extname(changedPath));
        if (stem === "")
            continue;
        const grep = git(["grep", "-l", "--fixed-strings", stem], root, {
            allowFailure: true,
        }).stdout;
        for (const line of grep.split("\n")) {
            const candidate = line.trim();
            if (candidate === "" ||
                changed.includes(candidate) ||
                related.includes(candidate))
                continue;
            if (related.length >= limit) {
                truncated = true;
                break;
            }
            related.push(candidate);
        }
    }
    const relatedText = related
        .filter((relatedPath) => {
        try {
            return fs.statSync(path.resolve(root, relatedPath)).isFile();
        }
        catch {
            return false;
        }
    })
        .map((relatedPath) => `### ${relatedPath}\n${fs.readFileSync(path.resolve(root, relatedPath), "utf8")}`)
        .join("\n\n");
    const promptBody = "以下はexact-head diffと、その呼び出し元・関連ファイルです。" +
        "変更ファイル単体では気づけない横断的な不整合・見落としだけを指摘してください。\n\n" +
        `## diff (${baseSha}..${headSha})\n${diffText}\n\n` +
        `## 関連ファイル（未変更、上限${limit}件）\n${relatedText}`;
    return { target: "diff", changed, related, truncated, promptBody };
}
/**
 * Step 03/07相当の対象を収集する。staging path配下に存在する文書を
 * 読み込み、ID出現箇所を抽出してprompt本文へ含める（FR-1428-03）。
 * どのfile名が存在するかは利用projectのstaging構成に依存するため、
 * 固定のfile一覧を要求せず、存在するものだけを対象にする。
 */
export function collectSupplementalReviewStaging(root, stagingPath) {
    const resolvedStaging = resolveContained(root, stagingPath);
    const entries = fs
        .readdirSync(resolvedStaging, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort();
    const changed = [];
    const sections = [];
    for (const name of entries) {
        const text = fs.readFileSync(path.join(resolvedStaging, name), "utf8");
        changed.push(name);
        const ids = [...new Set(text.match(ID_PATTERN) ?? [])].sort();
        sections.push(`### ${name}\n出現ID: ${ids.length > 0 ? ids.join("、") : "（なし）"}\n\n${text}`);
    }
    const promptBody = "以下はASC Issue staging内の文書です。" +
        "同一IDが文書間で異なる内容を指している不整合（暗黙の再定義、ID衝突、追跡切れ）だけを指摘してください。\n\n" +
        sections.join("\n\n");
    return { target: "staging", changed, promptBody };
}
//# sourceMappingURL=supplemental-review-collect.js.map