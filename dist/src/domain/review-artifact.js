import path from "node:path";
const REVIEW_IDENTITY_HEADING = "## 0. レビュー識別情報";
const IDENTITY_BASE_EXPECTED = "| 比較基点 | `<40桁の小文字hex>` |";
const IDENTITY_IMPL_EXPECTED = "| H_impl | `<40桁の小文字hex>` |";
const REQUIRED_HEADINGS = Object.freeze([
    REVIEW_IDENTITY_HEADING,
    "## 1. 入力証拠",
    "### 1.1 変更ファイル個別監査",
    "## 2. 受け入れ条件の確認",
    "## 3. 肯定的評価",
    "## 4. 敵対的評価",
    "## 5. 指摘",
    "## 6. ラウンド固有の確認",
    "## 7. テスト結果",
    "## 8. 配布物影響",
    "## 9. 独立reviewの成立",
    "## 10. 仕様整合性",
    "## 11. 総合判定と再開地点",
]);
/** Markdown fence内を空行へ置換し、行番号を維持したまま構造だけを読む。 */
function visibleMarkdownLines(markdown) {
    const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
    let fence;
    return lines.map((line) => {
        const delimiter = /^ {0,3}(`{3,}|~{3,})(?:[^`]*)$/u.exec(line)?.[1];
        if (delimiter !== undefined) {
            const character = delimiter[0];
            if (fence === undefined)
                fence = { character, length: delimiter.length };
            else if (fence.character === character &&
                delimiter.length >= fence.length &&
                new RegExp(`^ {0,3}${character}{${fence.length},} *$`, "u").test(line))
                fence = undefined;
            return "";
        }
        return fence === undefined ? line : "";
    });
}
function sectionRange(lines, heading) {
    const starts = lines
        .map((line, index) => (line === heading ? index : -1))
        .filter((index) => index >= 0);
    if (starts.length !== 1)
        return undefined;
    const start = starts[0];
    const level = heading.startsWith("### ") ? 3 : 2;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
        if (level === 2
            ? /^## /u.test(lines[index])
            : /^#{2,3} /u.test(lines[index])) {
            end = index;
            break;
        }
    }
    return { start, end };
}
function exactIdentityValue(lines, range, label) {
    if (range === undefined)
        return { line: 1, count: 0 };
    const labelPattern = new RegExp(`^\\| ${label} \\|`, "u");
    const exactPattern = label === "比較基点"
        ? /^\| 比較基点 \| `([a-f0-9]{40})` \|$/u
        : /^\| H_impl \| `([a-f0-9]{40})` \|$/u;
    const candidates = lines
        .slice(range.start + 1, range.end)
        .map((line, offset) => ({ line, index: range.start + 1 + offset }))
        .filter((entry) => labelPattern.test(entry.line));
    const exact = candidates.filter((entry) => exactPattern.test(entry.line));
    return {
        value: candidates.length === 1 && exact.length === 1
            ? exactPattern.exec(exact[0].line)?.[1]
            : undefined,
        line: (candidates[0]?.index ?? range.start) + 1,
        count: candidates.length,
    };
}
function identityCell(lines, range, label) {
    if (range === undefined)
        return { line: 1, count: 0 };
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`^\\| ${escaped} \\| ([^|]+) \\|$`, "u");
    const labelPattern = new RegExp(`^\\| ${escaped} \\|`, "u");
    const candidates = lines
        .slice(range.start + 1, range.end)
        .map((line, offset) => ({ line, index: range.start + 1 + offset }))
        .filter((entry) => labelPattern.test(entry.line));
    return {
        value: candidates.length === 1
            ? pattern.exec(candidates[0].line)?.[1]?.trim()
            : undefined,
        line: (candidates[0]?.index ?? range.start) + 1,
        count: candidates.length,
    };
}
export function parseReviewArtifactAudit(markdown) {
    const lines = visibleMarkdownLines(markdown);
    const identity = sectionRange(lines, REVIEW_IDENTITY_HEADING);
    const base = exactIdentityValue(lines, identity, "比較基点").value;
    const implementation = exactIdentityValue(lines, identity, "H_impl").value;
    const roundsText = identityCell(lines, identity, "ラウンド数").value;
    const leadingRound = /^(\d+)/u.exec(roundsText ?? "")?.[1];
    const rounds = leadingRound === undefined ? undefined : Number(leadingRound);
    const chainText = identityCell(lines, identity, "Step chain").value;
    const chainMatch = /^(経由|迂回) *[:：] *(.+)$/u.exec(chainText ?? "");
    const stepChain = chainMatch
        ? {
            kind: chainMatch[1] === "経由" ? "via" : "bypass",
            detail: chainMatch[2].trim(),
        }
        : undefined;
    const audit = sectionRange(lines, "### 1.1 変更ファイル個別監査") ??
        sectionRange(lines, "## 変更ファイル個別監査");
    const entries = [];
    if (audit !== undefined)
        for (const line of lines.slice(audit.start + 1, audit.end)) {
            const cells = line
                .split("|")
                .slice(1, -1)
                .map((cell) => cell.trim());
            if (cells.length === 9 &&
                /^`[^`]+`$/u.test(cells[0]) &&
                ["A", "M", "D", "R"].includes(cells[1]))
                entries.push({
                    path: cells[0].slice(1, -1),
                    status: cells[1],
                    fields: cells.slice(2, 8),
                    decision: cells[8],
                });
        }
    return { base, implementation, rounds, stepChain, entries };
}
/** review artifactから機械導出される2つの正規identity cellを一意に読む。 */
export function parseReviewIdentityAnchor(markdown) {
    const parsed = parseReviewArtifactAudit(markdown);
    return parsed.base === undefined || parsed.implementation === undefined
        ? undefined
        : { base: parsed.base, implementation: parsed.implementation };
}
/** 再固定比較のため、機械導出されるidentity 2値だけをplaceholderへ置換する。 */
export function normalizeReviewIdentityAnchor(markdown) {
    const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
    const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
    const visible = visibleMarkdownLines(markdown);
    const range = sectionRange(visible, REVIEW_IDENTITY_HEADING);
    if (range === undefined || parseReviewIdentityAnchor(markdown) === undefined)
        return undefined;
    for (let index = range.start + 1; index < range.end; index += 1) {
        if (/^\| 比較基点 \| `[a-f0-9]{40}` \|$/u.test(visible[index]))
            lines[index] = `| 比較基点 | \`<正規化済み>\` |`;
        if (/^\| H_impl \| `[a-f0-9]{40}` \|$/u.test(visible[index]))
            lines[index] = `| H_impl | \`<正規化済み>\` |`;
    }
    return lines.join(newline);
}
/** Markdown review artifactの事前検証。成功はauthorityやapprovalを生成しない。 */
export function validateReviewArtifactStructure(markdown) {
    const lines = visibleMarkdownLines(markdown);
    const diagnostics = [];
    const add = (code, line, expected, message) => diagnostics.push({ code, line, expected, message });
    for (const heading of REQUIRED_HEADINGS) {
        const matches = lines
            .map((line, index) => (line === heading ? index : -1))
            .filter((index) => index >= 0);
        if (matches.length !== 1)
            add("heading", (matches[0] ?? 0) + 1, heading, `${heading}は1件必要です（実測=${matches.length}件）`);
    }
    const identity = sectionRange(lines, REVIEW_IDENTITY_HEADING);
    const base = exactIdentityValue(lines, identity, "比較基点");
    const implementation = exactIdentityValue(lines, identity, "H_impl");
    if (base.value === undefined)
        add("identity-base", base.line, IDENTITY_BASE_EXPECTED, "比較基点を一意な厳密行で記録してください");
    if (implementation.value === undefined)
        add("identity-implementation", implementation.line, IDENTITY_IMPL_EXPECTED, "H_implを一意な厳密行で記録してください");
    const roundsCell = identityCell(lines, identity, "ラウンド数");
    const roundText = /^(\d+)/u.exec(roundsCell.value ?? "")?.[1];
    const rounds = roundText === undefined ? undefined : Number(roundText);
    if (rounds === undefined)
        add("rounds", roundsCell.line, "| ラウンド数 | <0以上の整数で始まる値> |", "ラウンド数を一意に記録してください");
    const chainCell = identityCell(lines, identity, "Step chain");
    const chainMatch = /^(経由|迂回) *[:：] *(.+)$/u.exec(chainCell.value ?? "");
    const stepChain = chainMatch
        ? {
            kind: chainMatch[1] === "経由" ? "via" : "bypass",
            detail: chainMatch[2].trim(),
        }
        : undefined;
    if (stepChain === undefined)
        add("step-chain", chainCell.line, "| Step chain | 経由: <staging> | または | Step chain | 迂回: <理由> |", "Step chainを一意に記録してください");
    const distribution = sectionRange(lines, "## 8. 配布物影響");
    const distributionLines = distribution === undefined
        ? []
        : lines.slice(distribution.start + 1, distribution.end);
    const decisions = distributionLines
        .map((line, offset) => ({
        line,
        index: (distribution?.start ?? 0) + 1 + offset,
    }))
        .filter((entry) => entry.line.startsWith("判断:"));
    const roots = distributionLines
        .map((line, offset) => ({
        line,
        index: (distribution?.start ?? 0) + 1 + offset,
    }))
        .filter((entry) => entry.line.startsWith("根拠:"));
    if (decisions.length !== 1 ||
        !["判断: 配布物を更新した", "判断: 配布物を更新しない"].includes(decisions[0]?.line ?? ""))
        add("distribution-decision", (decisions[0]?.index ?? distribution?.start ?? 0) + 1, "判断: 配布物を更新した または 判断: 配布物を更新しない（1件）", "配布物影響の判断を一意に記録してください");
    if (roots.length !== 1 || roots[0].line.slice("根拠:".length).trim() === "")
        add("distribution-reason", (roots[0]?.index ?? distribution?.start ?? 0) + 1, "根拠: <具体的な根拠>（1件）", "配布物影響の根拠を一意に記録してください");
    const audit = parseReviewArtifactAudit(markdown);
    return {
        base: base.value,
        implementation: implementation.value,
        rounds,
        stepChain,
        auditEntries: audit.entries,
        diagnostics,
    };
}
/** review artifact用stagingが対象rootの規定issues directory直下にあるか判定する。 */
export function isReviewArtifactStagingDirectChild(root, staging) {
    const resolvedRoot = path.resolve(root);
    const issuesRoot = path.join(resolvedRoot, ".agent-skill-chain", "tmp", "issues");
    return path.dirname(path.resolve(staging)) === issuesRoot;
}
/** lexical rootから期待する親とreal parentが一致し、repository内に留まることを判定する。 */
export function isReviewArtifactParentContained(lexicalRoot, realRoot, lexicalParent, realParent) {
    const relative = path.relative(path.resolve(lexicalRoot), lexicalParent);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
        return false;
    return path.resolve(realRoot, relative) === realParent;
}
function escapeCell(value) {
    return value
        .replaceAll("|", "｜")
        .replace(/[\r\n]+/gu, " ")
        .trim();
}
function replaceRow(content, label, value) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return content.replace(new RegExp(`^\\|[ \\t]*${escaped}[ \\t]*\\|[^\\n]*$`, "mu"), `| ${label} | ${escapeCell(value)} |`);
}
/** reviewer判断を確定せず、Gitとstagingから導ける04欄だけを埋める。 */
export function renderReviewArtifactDraft(input) {
    let content = input.template;
    const targetPaths = input.paths.map((item) => item.path).join("、") || "差分なし";
    content = replaceRow(content, "対象", "実装");
    content = replaceRow(content, "ラウンド", "1");
    content = replaceRow(content, "対象SHA・文書ダイジェスト", input.headSha);
    content = replaceRow(content, "比較基点", `\`${input.baseSha}\``);
    content = replaceRow(content, "H_impl", `\`${input.headSha}\``);
    content = replaceRow(content, "対象差分", targetPaths);
    content = replaceRow(content, "対象外", "比較基点に存在し変更されていない範囲");
    content = replaceRow(content, "残り予算", "3ラウンド");
    content = replaceRow(content, "ラウンド数", "0（review未実施）");
    content = replaceRow(content, "Step chain", `経由: ${input.staging}`);
    const auditRows = input.paths
        .map((item) => `| \`${escapeCell(item.path)}\` | ${item.changeType} | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | finding |`)
        .join("\n");
    content = content.replace(/^\| （repository相対path） \| A \/ M \/ D \/ R \|[^\n]*$/mu, auditRows ||
        "| 差分なし | M | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | reviewerが確認 | finding |");
    const evidenceRows = [
        `| 要求・受け入れ条件 | ${escapeCell(input.staging)} | staging digest ${input.stagingDigest} | 既存コード |`,
        `| 差分 | \`${input.baseSha}\`..\`${input.headSha}\` | ${input.paths.length} path | 既存コード |`,
        "| テスト | reviewerが実行後に記録 | 未実行 | テスト出力 |",
        "| 仕様 | reviewerが確認後に記録 | unknown | 既存文書 |",
        `| commit前candidate | ${escapeCell(targetPaths)} | H_impl ${input.headSha} | Git index |`,
        "| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |",
        `| review session | ${escapeCell(input.staging)} | 未開始 | Git観測 |`,
    ].join("\n");
    content = content.replace(/^\| 要求・受け入れ条件 \| （URL・ID） \|[^\n]*(?:\n\| 差分 \|[^\n]*)?(?:\n\| テスト \|[^\n]*)?(?:\n\| 仕様 \|[^\n]*)?(?:\n\| commit前candidate \|[^\n]*)?(?:\n\| Phase A artifact \|[^\n]*)?(?:\n\| review session \|[^\n]*)?/mu, evidenceRows);
    content = content.replace(/## 7\. テスト結果[\s\S]*?(?=\n## 8\. 配布物影響)/u, "## 7. テスト結果\n\n- 実行したcommandの一覧: 未実行（reviewerが実行後に記録）\n- 全layerの合計: 未実行（成功・失敗・skipは未確定）\n- runner・Gherkin方言: project choicesからreviewerが確認\n");
    return content;
}
//# sourceMappingURL=review-artifact.js.map