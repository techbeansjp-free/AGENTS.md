import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { resolveContained } from "../lib/security.js";
export const RELATED_FILE_LIMIT = 20;
export const RELATED_STEM_MATCH_LIMIT = 10;
export const REVIEW_COLLECTION_BYTE_LIMIT = 1024 * 1024;
const ID_PATTERN = /\b(?:AC|FR|NFR|INV|RQ|OUTCOME|DC|TERM-ASC)-\d+\b/g;
/**
 * Step 10相当の対象を収集する。base..headの変更fileと、その呼び出し元
 * （fileの識別子を含む他file）を関連fileとして追加する。dotfileと
 * 広範囲に現れる汎用名は検索根拠にしない。上限件数で打ち切る。
 */
export function collectSupplementalReviewDiff(root, baseSha, headSha, limit = RELATED_FILE_LIMIT) {
    const changed = git(["diff", "--name-only", "-z", `${baseSha}..${headSha}`], root, { maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT })
        .stdout.split("\0")
        .filter((value) => value !== "");
    const diffText = git(["diff", `${baseSha}..${headSha}`], root, {
        maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
    }).stdout;
    if (Buffer.byteLength(diffText, "utf8") > REVIEW_COLLECTION_BYTE_LIMIT)
        throw new Error("review差分が1MiBを超えました");
    const related = [];
    let truncated = false;
    for (const changedPath of changed) {
        if (truncated)
            break;
        const basename = path.basename(changedPath);
        const extension = path.extname(basename);
        if (basename.startsWith(".") && extension === "")
            continue;
        const stem = path.basename(basename, extension);
        if (stem === "")
            continue;
        const grepArgs = [
            "grep",
            "-l",
            "-z",
            "--fixed-strings",
            "-e",
            stem,
            headSha,
        ];
        const grep = git(grepArgs, root, {
            allowFailure: true,
            maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
        });
        // 過剰な一致は非specificなstemと同等に扱う。検索失敗とは区別する。
        if (grep.stderr.startsWith(`git ${grepArgs.join(" ")}を実行できませんでした（ENOBUFS）:`))
            continue;
        if (grep.status > 1 || grep.stderr !== "")
            throw new Error("関連fileの探索を安全に完了できませんでした");
        const matches = grep.stdout.split("\0").filter((line) => line !== "");
        if (matches.length > RELATED_STEM_MATCH_LIMIT)
            continue;
        for (const line of matches) {
            const trimmed = line.trim();
            const candidate = trimmed.startsWith(`${headSha}:`)
                ? trimmed.slice(headSha.length + 1)
                : trimmed;
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
    const relatedSections = [];
    let collectedBytes = Buffer.byteLength(diffText, "utf8");
    for (const relatedPath of related) {
        if (git(["cat-file", "-e", `${headSha}:${relatedPath}`], root, {
            allowFailure: true,
        }).status !== 0)
            continue;
        const body = git(["show", `${headSha}:${relatedPath}`], root, {
            maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
        }).stdout;
        const section = `### ${relatedPath}\n${body}`;
        collectedBytes += Buffer.byteLength(section, "utf8") + 2;
        if (collectedBytes > REVIEW_COLLECTION_BYTE_LIMIT)
            throw new Error("review差分と関連fileが1MiBを超えました");
        relatedSections.push(section);
    }
    const relatedText = relatedSections.join("\n\n");
    const promptBody = `## diff (${baseSha}..${headSha})\n${diffText}\n\n` +
        `## 関連ファイル（未変更、上限${limit}件、呼び出し元・呼び出し先の文脈として提供）\n${relatedText}`;
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
    if (entries.length > 100)
        throw new Error("review対象文書が100件を超えました");
    const changed = [];
    const sections = [];
    let collectedBytes = 0;
    for (const name of entries) {
        const file = path.join(resolvedStaging, name);
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let text;
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() ||
                stat.size > REVIEW_COLLECTION_BYTE_LIMIT - collectedBytes)
                throw new Error("review対象文書が1MiBを超えました");
            text = fs.readFileSync(fd, "utf8");
        }
        finally {
            fs.closeSync(fd);
        }
        changed.push(name);
        const ids = [...new Set(text.match(ID_PATTERN) ?? [])].sort();
        const section = `### ${name}\n出現ID: ${ids.length > 0 ? ids.join("、") : "（なし）"}\n\n${text}`;
        collectedBytes += Buffer.byteLength(section, "utf8") + 2;
        if (collectedBytes > REVIEW_COLLECTION_BYTE_LIMIT)
            throw new Error("review対象文書が1MiBを超えました");
        sections.push(section);
    }
    const promptBody = sections.join("\n\n");
    return { target: "staging", changed, promptBody };
}
//# sourceMappingURL=supplemental-review-collect.js.map