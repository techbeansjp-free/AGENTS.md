import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeSlug } from "../lib/security.js";
import { publishDirectoryAtomic, writeFileAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
import { git } from "../lib/process.js";
import { classifyMode, detectQuickDisqualifiers, POC_HIGH_RISK_IDS, QUESTIONS, } from "./mode.js";
import { validateDevelopmentConsiderations } from "./conformance.js";
import { parseVerificationSelectionInput, } from "./agile-verification.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, STAGING_RECORD_FILE, withStagingMutationLock, } from "./staging.js";
import { MODE_DECISION_FILE, parseModeDecision, STEP_JOURNAL_FILE, WORKFLOW_JOURNAL_DIRECTORY, renderModeDecision, WORKFLOW_STEPS, } from "./workflow.js";
const packageRoot = findPackageRoot(import.meta.url);
const templateRoot = path.join(packageRoot, ".agent-skill-chain", "templates", "issue");
const FULL_FILES = {
    "01_要件定義.md": "01_要件定義.md",
    "02_設計.md": "02_設計.md",
    "03_実装計画.md": "03_実装計画.md",
};
const LOW_RISK_SHORT_FORM_FILE = "verification-input.json";
const LOW_RISK_SHORT_FORM = /^対象外:\s*(.*)$/u;
const LOW_RISK_SHORT_FORM_LIKE = /^\s*(?:(?:[-*+>])\s*)*対象外(?:$|(?=\s|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9_]))/u;
const MAX_VERIFICATION_INPUT_BYTES = 1024 * 1024;
const LOW_RISK_SHORT_FORM_TARGETS = Object.freeze([
    Object.freeze({
        file: "02_設計.md",
        heading: "4.2 識別子・UUID（必要な場合だけ）",
    }),
    Object.freeze({ file: "02_設計.md", heading: "8. UIと表示契約（該当時）" }),
    Object.freeze({ file: "02_設計.md", heading: "9. 観測可能性" }),
    Object.freeze({ file: "03_実装計画.md", heading: "5.2 安全性の必須観点" }),
]);
/** exact Markdown heading配下を、同じか上位levelの次headingまでに閉じる。 */
function markdownSectionBodies(text, heading) {
    const visible = withoutMarkdownCode(text);
    const lines = visible.split("\n");
    const bodies = [];
    for (let start = 0; start < lines.length; start += 1) {
        const match = /^(#{2,6})\s+(.+?)\s*$/u.exec(lines[start]);
        if (match?.[2] !== heading)
            continue;
        const level = match[1].length;
        let end = lines.length;
        for (let index = start + 1; index < lines.length; index += 1) {
            const nextLevel = /^(#{2,6})\s/u.exec(lines[index])?.[1]?.length;
            if (nextLevel !== undefined && nextLevel <= level) {
                end = index;
                break;
            }
        }
        bodies.push(lines.slice(start + 1, end).join("\n"));
    }
    return Object.freeze(bodies);
}
function verificationRisk(issuePath) {
    const inputPath = path.join(issuePath, LOW_RISK_SHORT_FORM_FILE);
    let descriptor;
    let input;
    try {
        const named = fs.lstatSync(inputPath, { bigint: true });
        if (!named.isFile() || named.isSymbolicLink())
            throw new Error(`${LOW_RISK_SHORT_FORM_FILE}は通常fileでなければなりません`);
        descriptor = fs.openSync(inputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (!opened.isFile() ||
            opened.dev !== named.dev ||
            opened.ino !== named.ino)
            throw new Error(`${LOW_RISK_SHORT_FORM_FILE}が読取中に変更されました`);
        if (opened.size > BigInt(MAX_VERIFICATION_INPUT_BYTES))
            throw new Error(`${LOW_RISK_SHORT_FORM_FILE}は${MAX_VERIFICATION_INPUT_BYTES} bytes以下でなければなりません`);
        const buffer = Buffer.alloc(MAX_VERIFICATION_INPUT_BYTES + 1);
        const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_VERIFICATION_INPUT_BYTES)
            throw new Error(`${LOW_RISK_SHORT_FORM_FILE}は${MAX_VERIFICATION_INPUT_BYTES} bytes以下でなければなりません`);
        const after = fs.fstatSync(descriptor, { bigint: true });
        const current = fs.lstatSync(inputPath, { bigint: true });
        if (after.dev !== opened.dev ||
            after.ino !== opened.ino ||
            after.size !== opened.size ||
            after.size !== BigInt(bytesRead) ||
            after.mtimeNs !== opened.mtimeNs ||
            after.ctimeNs !== opened.ctimeNs ||
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.dev !== after.dev ||
            current.ino !== after.ino)
            throw new Error(`${LOW_RISK_SHORT_FORM_FILE}が読取中に変更されました`);
        input = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    }
    catch (error) {
        throw new Error(`${LOW_RISK_SHORT_FORM_FILE}を安全に読めません: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    finally {
        if (descriptor !== undefined)
            fs.closeSync(descriptor);
    }
    return parseVerificationSelectionInput(input).risk;
}
/** 指定4節にshort formが現れた場合だけ、low限定・理由付き1行を強制する。 */
export function validateLowRiskShortForms(issuePath, includedFiles) {
    const candidates = LOW_RISK_SHORT_FORM_TARGETS.filter((target) => includedFiles === undefined || includedFiles.has(target.file)).flatMap((target) => {
        const artifact = path.join(issuePath, target.file);
        if (!fs.existsSync(artifact))
            return [];
        const bodies = markdownSectionBodies(fs.readFileSync(artifact, "utf8"), target.heading);
        return bodies.flatMap((body) => {
            const lines = body.split("\n").filter((line) => line.trim() !== "");
            return lines.some((line) => LOW_RISK_SHORT_FORM_LIKE.test(line))
                ? [{ ...target, lines }]
                : [];
        });
    });
    if (candidates.length === 0)
        return Object.freeze([]);
    let risk;
    try {
        risk = verificationRisk(issuePath);
    }
    catch (error) {
        return Object.freeze([
            `\`対象外: <理由>\`はrisk=lowだけで使用できます。riskを確認できません: ${error instanceof Error ? error.message : String(error)}`,
        ]);
    }
    const errors = [];
    for (const candidate of candidates) {
        const match = candidate.lines.length === 1
            ? LOW_RISK_SHORT_FORM.exec(candidate.lines[0])
            : null;
        const visibleReason = match?.[1]
            .replace(/<!--[\s\S]*?-->/gu, "")
            .replace(/\p{Cf}/gu, "")
            .trim();
        if (!match || visibleReason === "")
            errors.push(`${candidate.file} §${candidate.heading}の短縮形式は\`対象外: <理由>\`の理由付き1行にしてください`);
        if (risk !== "low")
            errors.push(`${candidate.file} §${candidate.heading}の\`対象外: <理由>\`はrisk=lowだけで使用できます（現在: ${risk}）`);
    }
    return Object.freeze(errors);
}
/** mode/checkpointごとの同期対象を、CLIとtestが共有できる形で返す。 */
export function issueSyncArtifactNames(mode, checkpoint) {
    if (mode === "full")
        return checkpoint === 8
            ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
            : ["00_要求定義.md", "01_要件定義.md"];
    return ["00_要求定義.md"];
}
/**
 * fenced blockとinline codeを取り除く。**行構造は保つ。**見出しの行全体一致に使うため、
 * 行番号と行の境界がずれてはならない。
 */
export function withoutMarkdownCode(text) {
    return withoutCode(text)
        .split("\n")
        .map((line) => withoutInlineCode(line))
        .join("\n");
}
/** 配布templateのPR本文。見出し構造の正本はこのfileだけが持つ。 */
const PULL_REQUEST_BODY_TEMPLATE = "11_プルリクエスト本文.md";
/**
 * PR本文の必須見出しを配布templateから導出する。
 *
 * **一覧をここへ書き写さない。** 書き写すとtemplateと独立に古くなり、Issue #951が
 * 指摘した「同じ規則が複数箇所に複製される」型を再生産する。
 *
 * 見出しに条件を書いた節（`（…だけ）`）は任意とする。条件節を必須にすると、条件を
 * 満たさない変更でPRを作れなくなり、充足不能な受け入れ条件になる。
 */
export function pullRequestRequiredHeadings() {
    const template = fs.readFileSync(path.join(templateRoot, PULL_REQUEST_BODY_TEMPLATE), "utf8");
    return [...template.matchAll(/^## (.+)$/gmu)]
        .map((match) => match[1].trim())
        .filter((heading) => !/（[^）]*だけ）/u.test(heading));
}
/**
 * PR本文が配布templateの構造を満たすかを検証する。
 *
 * **構造の存在確認だけを行う。** 「2〜4文で記載する」のような内容品質は判定しない。
 * 空欄も一律には禁止しない。未実施のラウンドは空で正しいためである。
 */
export function validatePullRequestBody(body) {
    const errors = [];
    /**
     * **包含判定では緩すぎる。** `### 概要`も`## 概要（補足）`もcode block内の`## 概要`も
     * 通ってしまう。codeを除いた本文の行全体と一致することを要求する。
     */
    const headings = new Set(withoutMarkdownCode(body)
        .split("\n")
        .map((line) => /^##\s+(.+?)\s*$/u.exec(line)?.[1])
        .filter((heading) => heading !== undefined));
    for (const heading of pullRequestRequiredHeadings())
        if (!headings.has(heading))
            errors.push(`PR本文に必須見出しがありません: ${heading}`);
    const bodyPlaceholders = unresolvedPlaceholders(body);
    if (bodyPlaceholders.length > 0)
        errors.push(unresolvedPlaceholderError("PR本文に", bodyPlaceholders));
    return { valid: errors.length === 0, errors };
}
export function issueRequiredHeadings(mode) {
    return mode === "quick"
        ? [
            "1. 目的、現在、期待状態（必須）",
            "2. 対象範囲と権限（必須）",
            "3. ドメイン影響（必須）",
            "4. Q-01〜Q-08の回答と根拠（必須）",
            "5. 要求、受け入れ条件、最小Gherkin（必須）",
            "6. 最小設計",
            "7. 実装とテストの計画",
            "8. P-01〜P-07の証拠",
            "9. 仕様、図表、識別子",
            "10. リスク、レビュー、再開地点",
        ]
        : mode === "poc"
            ? [
                "1. 目的、現在、期待状態（必須）",
                "2. 対象範囲と権限（必須）",
                "3. ドメイン影響（必須）",
                "4. PoC宣言（必須）",
                "5. high risk確認（必須）",
                "6. 要求、受け入れ条件、実行可能な受け入れ例（必須）",
                "7. 最小設計",
                "8. 実装とテストの計画",
                "9. P-01〜P-07の証拠",
                "10. 仕様、図表、識別子",
                "11. リスク、昇格・廃止判断、再開地点",
            ]
            : [
                "1. 目的と背景",
                "2. 対象範囲",
                "3. 利害関係者と利用場面",
                "4. ドメイン影響",
                "5. 要求の概要",
                "6. 制約、前提、依存関係",
                "7. 受け入れ条件と成功基準",
                "8. リスクと安全側への縮小",
                "9. モード判定Q-01〜Q-08",
                "10. P-01〜P-07の適用計画",
                "11. 図表と識別子の判断",
                "12. 参考資料、未決事項、再開地点",
            ];
}
const TEMPLATE_PLACEHOLDER_TERM = /記載|記入|件名|名称|内容|役割|日時|ISO 8601形式|状態|結果|根拠|条件|パス|URL|SHA|値|対象/u;
function templateParentheticalPlaceholders() {
    const placeholders = new Set();
    for (const name of fs.readdirSync(templateRoot)) {
        if (!name.endsWith(".md"))
            continue;
        const template = fs.readFileSync(path.join(templateRoot, name), "utf8");
        for (const match of template.matchAll(/（[^）\n]+）/gu))
            if (TEMPLATE_PLACEHOLDER_TERM.test(match[0]))
                placeholders.add(match[0]);
    }
    return placeholders;
}
const TEMPLATE_PARENTHETICAL_PLACEHOLDERS = templateParentheticalPlaceholders();
function withoutInlineCode(line) {
    let visible = "";
    let cursor = 0;
    while (cursor < line.length) {
        const opening = line.indexOf("`", cursor);
        if (opening < 0)
            return visible + line.slice(cursor);
        visible += line.slice(cursor, opening);
        let length = 1;
        while (line[opening + length] === "`")
            length += 1;
        const delimiter = "`".repeat(length);
        const closing = line.indexOf(delimiter, opening + length);
        if (closing < 0)
            return visible + line.slice(opening);
        cursor = closing + length;
    }
    return visible;
}
function withoutCode(text) {
    const visible = [];
    let fence;
    for (const line of text.split("\n")) {
        const opening = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
        if (fence) {
            if (new RegExp(`^\\s*${escapeRegExp(fence.marker)}{${fence.length},}\\s*$`, "u").test(line))
                fence = undefined;
            visible.push("");
            continue;
        }
        if (opening) {
            fence = {
                marker: opening[0],
                length: opening.length,
            };
            visible.push("");
            continue;
        }
        visible.push(withoutInlineCode(line));
    }
    return visible.join("\n");
}
/**
 * **project choiceの`gherkinDialect`ごとの、scenario ID行を開始するkeyword。**
 *
 * 従来は英語`Scenario:`だけを検出し、`gherkinDialect`は宣言できても参照されなかった
 * （Issue #1324）。方言は固定表で持ち、runtime dependencyを足さない。
 * **表に無い方言はfail-closedで拒否し、英語keywordへ暗黙にfallbackしない。**
 * `ja`は英語keywordも受理する上位集合であり、`en`の受理集合は従来の`Scenario:`に
 * `Scenario Outline:`のID行を加えたものである。
 */
export const GHERKIN_SCENARIO_KEYWORDS = Object.freeze({
    en: Object.freeze(["Scenario", "Scenario Outline"]),
    ja: Object.freeze([
        "Scenario",
        "Scenario Outline",
        "シナリオ",
        "シナリオアウトライン",
        "シナリオテンプレート",
        "テンプレ",
    ]),
});
/**
 * **placeholder判定でGherkin区間の開始と見なす、scenario以外の行頭keyword。**
 *
 * `ja`のstep keyword（前提・もし・ならば・かつ・しかし）はcolonを持たず、
 * 英語keywordだけを見るとja Outlineの`<param>`を含むstep行が散文として
 * 未解決placeholderに数えられる（round 1 REV-01）。scenario keywordと同じ
 * 表で管理し、方言ごとに`GHERKIN_SCENARIO_KEYWORDS`と対にする。
 */
const GHERKIN_BLOCK_KEYWORDS = Object.freeze({
    en: Object.freeze({
        colon: Object.freeze(["Feature", "Rule", "Background", "Examples"]),
        step: Object.freeze(["Given", "When", "Then", "And", "But"]),
    }),
    ja: Object.freeze({
        colon: Object.freeze([
            "Feature",
            "Rule",
            "Background",
            "Examples",
            "機能",
            "フィーチャ",
            "ルール",
            "背景",
            "例",
            "サンプル",
        ]),
        step: Object.freeze([
            "Given",
            "When",
            "Then",
            "And",
            "But",
            "前提",
            "もし",
            "ならば",
            "かつ",
            "しかし",
            "但し",
            "ただし",
        ]),
    }),
});
export const DEFAULT_GHERKIN_DIALECT = "en";
export function scenarioKeywords(dialect) {
    const keywords = Object.hasOwn(GHERKIN_SCENARIO_KEYWORDS, dialect)
        ? GHERKIN_SCENARIO_KEYWORDS[dialect]
        : undefined;
    if (!keywords)
        throw new Error(`gherkinDialectが未対応です: ${dialect}。対応する方言は${Object.keys(GHERKIN_SCENARIO_KEYWORDS).join("、")}です`);
    return keywords;
}
function scenarioIdPattern(dialect) {
    const alternatives = scenarioKeywords(dialect)
        .map((keyword) => escapeRegExp(keyword))
        .join("|");
    /**
     * **行頭keywordとしてだけ受理する**（FR-04、round 1 REV-04）。散文中の
     * 「シナリオ: SCN-…」という言及を実scenarioとして数えない。indentは許す。
     */
    return new RegExp(`^\\s*(?:${alternatives}):\\s+SCN-[A-Z0-9-]+`, "mu");
}
function withoutGherkin(text, dialect = DEFAULT_GHERKIN_DIALECT) {
    let inGherkin = false;
    const block = GHERKIN_BLOCK_KEYWORDS[dialect];
    if (!block)
        throw new Error(`gherkinDialectが未対応です: ${dialect}`);
    const colonKeywords = [...scenarioKeywords(dialect), ...block.colon]
        .map((keyword) => `${escapeRegExp(keyword)}:`)
        .join("|");
    const stepKeywords = block.step
        .map((keyword) => /^[A-Za-z]+$/u.test(keyword)
        ? `${keyword}\\b`
        : `${escapeRegExp(keyword)}(?=\\s|$)`)
        .join("|");
    const gherkinStart = new RegExp(`^\\s*(?:@[\\w@-]+|${colonKeywords}|${stepKeywords}|\\*)`, "u");
    return text
        .split("\n")
        .map((line) => {
        if (gherkinStart.test(line)) {
            inGherkin = true;
            return "";
        }
        if (inGherkin && /^\s*(?:\||#|$)/u.test(line))
            return "";
        inGherkin = false;
        return line;
    })
        .join("\n");
}
const UNRESOLVED_PLACEHOLDER_SAMPLE_LIMIT = 5;
function unresolvedPlaceholders(text, dialect = DEFAULT_GHERKIN_DIALECT) {
    const prose = withoutGherkin(withoutCode(text), dialect);
    const found = new Set();
    for (const match of prose.matchAll(/<[^>\n]+>|\{[^}\n]+\}/gu))
        found.add(match[0]);
    for (const match of prose.matchAll(/（[^）\n]+）/gu))
        if (TEMPLATE_PARENTHETICAL_PLACEHOLDERS.has(match[0]))
            found.add(match[0]);
    return [...found].sort();
}
function unresolvedPlaceholderError(subject, found) {
    const shown = found.slice(0, UNRESOLVED_PLACEHOLDER_SAMPLE_LIMIT);
    const remaining = found.length - shown.length;
    return `${subject}未解決のplaceholderが残っています: ${shown.join("、")}${remaining > 0 ? `、ほか${remaining}件` : ""}`;
}
function jstTimestamp(date) {
    if (Number.isNaN(date.getTime()))
        throw new RangeError("Invalid time value");
    const japan = new Date(date.getTime() + 9 * 60 * 60 * 1_000);
    const pad = (value, width = 2) => String(value).padStart(width, "0");
    return `${pad(japan.getUTCFullYear(), 4)}${pad(japan.getUTCMonth() + 1)}${pad(japan.getUTCDate())}_${pad(japan.getUTCHours())}${pad(japan.getUTCMinutes())}${pad(japan.getUTCSeconds())}`;
}
function requirementDocument(mode, title, answers, poc, now, projectChoices) {
    const name = mode === "poc"
        ? "00_要求定義_poc.md"
        : mode === "quick"
            ? "00_要求定義_quick.md"
            : "00_要求定義_full.md";
    let content = fs.readFileSync(path.join(templateRoot, name), "utf8");
    content = replaceTwoColumnRow(content, "件名", escapeCell(title));
    content = replaceTwoColumnRow(content, "正本", "未同期");
    if (now)
        content = replaceTwoColumnRow(content, "作成・更新日", now.toISOString());
    content = replaceTwoColumnRow(content, "作成・確認者", "AIエージェント");
    for (const id of QUESTIONS) {
        const item = answers?.[id];
        const answer = item?.answer === true
            ? "true"
            : item?.answer === false
                ? "false"
                : "unknown";
        const evidence = escapeCell(item?.evidence || "根拠なし");
        content = content.replace(new RegExp(`^\\|[ \\t]*${id}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`, "m"), () => `| ${id} | ${answer} | ${evidence} |`);
    }
    if (mode === "poc" && poc) {
        const replacements = [
            ["PoC目的", escapeCell(poc.purpose)],
            ["隔離fixture ID", escapeCell(poc.fixture.id)],
            ["fixture root", escapeCell(poc.fixture.root)],
            ["隔離境界Evidence", escapeCell(poc.fixture.isolationEvidence)],
            ["初期化Evidence", escapeCell(poc.fixture.resetEvidence)],
            ["runner ID", escapeCell(poc.fixture.runner.id)],
            ["runner path", escapeCell(poc.fixture.runner.path)],
            ["成功条件", escapeCell(poc.successCriteria)],
            ["中止条件", escapeCell(poc.abortCriteria)],
            ["非対象", escapeCell(poc.outOfScope)],
            ["責任者", escapeCell(poc.owner)],
        ];
        for (const [label, value] of replacements)
            content = replaceTwoColumnRow(content, label, value);
        content = content.replace(/^\|[ \t]*UC-\.\.\.[ \t]*\|[^\n]*$/mu, () => poc.useCases
            .map((item) => `| ${escapeCell(item.id)} | ${escapeCell(item.actor)} | ${escapeCell(item.goal)} |`)
            .join("\n"));
        content = content.replace(/^\|[ \t]*SCN-\.\.\.[ \t]*\|[^\n]*$/mu, () => poc.scenarios
            .map((item) => `| ${escapeCell(item.id)} | ${escapeCell(item.useCaseId)} | ${escapeCell(item.given)} | ${escapeCell(item.when)} | ${escapeCell(item.then)} | ${escapeCell(JSON.stringify(item.argv))} |`)
            .join("\n"));
        content = content.replace(/^\|[ \t]*OBS-\.\.\.[ \t]*\|[^\n]*$/mu, () => poc.observables
            .map((item) => `| ${escapeCell(item.id)} | ${escapeCell(item.scenarioId)} | ${escapeCell(item.kind)} | ${escapeCell(item.target ?? "-")} | ${escapeCell(String(item.expected))} |`)
            .join("\n"));
        for (const risk of poc.highRisk) {
            content = content.replace(new RegExp(`^\\|[ \\t]*${escapeRegExp(risk.id)}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`, "m"), () => `| ${risk.id} | ${risk.present ? "あり" : "なし"} | ${escapeCell(risk.evidence)} |`);
        }
    }
    content = prefillDevelopmentConsiderations(content, projectChoices);
    return content;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function replaceTwoColumnRow(content, label, value) {
    return content.replace(new RegExp(`^\\|[ \\t]*${escapeRegExp(label)}[ \\t]*\\|[^\\n|]+\\|[ \\t]*$`, "m"), () => `| ${label} | ${value} |`);
}
function escapeCell(value) {
    return String(value)
        .replaceAll("|", "｜")
        .replace(/[\r\n]+/g, " ")
        .trim();
}
function replaceFiveColumnRow(content, id, values) {
    return content.replace(new RegExp(`^\\|[ \\t]*${escapeRegExp(id)}[ \\t]*\\|[^\\n]*$`, "mu"), `| ${id} | ${values.map(escapeCell).join(" | ")} |`);
}
function prefillRoutingRows(content, choices, kind) {
    if (typeof choices?.modelMapping !== "object")
        return content;
    const roles = choices.modelMapping.roles;
    const fallback = `${choices.modelMapping.fallback.when}: ${choices.modelMapping.fallback.role}/${choices.modelMapping.fallback.modelSelection}`;
    const row = (role, task) => {
        const selected = roles[role];
        return kind === "design"
            ? `| ${role} | project choiceのrole contract | ${role === "reviewer" ? "肯定・敵対review、finding分類" : "failing test、test result"} | critical | ${escapeCell(selected.provider)} | ${escapeCell(`${selected.logicalTier}/${selected.reasoningEffort}/${selected.speed}`)} | ${escapeCell(fallback)} | implementerとreviewerのprovider・context差を記録 |`
            : `| ${task} | ${role} | project choiceのrole contract | ${role === "reviewer" ? "肯定・敵対review、finding分類" : "failing test、test result"} | critical | ${escapeCell(selected.provider)} | ${escapeCell(`${selected.logicalTier}/${selected.reasoningEffort}/${selected.speed}`)} | ${escapeCell(fallback)} | implementerとreviewerのprovider・context差を記録 |`;
    };
    const replacement = [
        row("implementer", "実装・検証"),
        row("reviewer", "独立review"),
    ].join("\n");
    return content
        .replace(/^\| （6 roleのいずれか） \|[^\n]*$/mu, replacement)
        .replace(/^\| T01 \| （6 roleのいずれか） \|[^\n]*$/mu, replacement);
}
function prefillDevelopmentConsiderations(content, choices) {
    if (!choices)
        return content;
    const decisions = [
        ["DC-PRIVACY", choices.capabilities.privacySecurity],
        ["DC-OBSERVABILITY", choices.capabilities.observability],
        ["DC-UX", choices.capabilities.humanCenteredUi],
        ["DC-TOKENS", choices.capabilities.designTokens],
    ];
    for (const [id, decision] of decisions) {
        const current = new RegExp(`^\\|[ \\t]*${id}[ \\t]*\\|[^\\n]*$`, "mu").exec(content)?.[0];
        if (!current)
            continue;
        const cells = current.split("|").map((cell) => cell.trim());
        const evidence = decision.status === "not-applicable"
            ? decision.evidence
            : (cells[5] ?? "タスク固有証拠を記入する");
        content = replaceFiveColumnRow(content, id, [
            cells[2] ?? id,
            decision.status,
            decision.reason,
            evidence,
        ]);
    }
    return content;
}
function prefillFullArtifacts(directory, input) {
    const tracker = "未同期";
    const createdAt = input.now.toISOString();
    const common = {
        件名: escapeCell(input.title),
        正本: tracker,
        "作成・更新日": createdAt,
    };
    for (const name of Object.keys(FULL_FILES)) {
        const file = path.join(directory, name);
        let content = fs.readFileSync(file, "utf8");
        for (const [label, value] of Object.entries(common))
            content = replaceTwoColumnRow(content, label, value);
        content = replaceTwoColumnRow(content, "件名・正本", `${escapeCell(input.title)} / ${tracker}`);
        if (name === "02_設計.md")
            content = prefillRoutingRows(content, input.projectChoices, "design");
        if (name === "03_実装計画.md") {
            content = replaceTwoColumnRow(content, "専用ブランチ・worktree", path.resolve(input.root));
            content = prefillRoutingRows(content, input.projectChoices, "plan");
        }
        content = prefillDevelopmentConsiderations(content, input.projectChoices);
        fs.writeFileSync(file, content, { flag: "w" });
    }
}
export function createIssueStaging(root, options) {
    const slug = safeSlug(options.title);
    const decision = classifyMode(options.answers, {
        requestedMode: options.requestedMode,
        poc: options.poc,
        changedFiles: options.changedFiles,
    });
    const finalPath = path.join(root, ".agent-skill-chain", "tmp", "issues", `${jstTimestamp(options.now)}_${slug}`);
    publishDirectoryAtomic(finalPath, (temporary) => {
        const decidedAt = options.now.toISOString();
        fs.writeFileSync(path.join(temporary, "00_要求定義.md"), requirementDocument(decision.mode, options.title, options.answers, options.poc, options.now, options.projectChoices), { flag: "wx" });
        const requestedMode = options.requestedMode === "quick" ||
            options.requestedMode === "full" ||
            options.requestedMode === "poc"
            ? options.requestedMode
            : decision.mode;
        fs.writeFileSync(path.join(temporary, MODE_DECISION_FILE), renderModeDecision({
            requestedMode,
            answers: options.answers,
            decidedAt,
            ...(decision.mode === "poc"
                ? {
                    baselineHeadSha: git(["rev-parse", "--verify", "HEAD^{commit}"], root).stdout.trim(),
                }
                : {}),
            poc: options.poc,
            changedFiles: options.changedFiles,
        }), { flag: "wx", mode: 0o600 });
        const step = WORKFLOW_STEPS[0];
        if (!step)
            throw new Error("Step 0定義がありません");
        const initialEntry = {
            step: step.step,
            skillId: step.skillId,
            mode: decision.mode,
            recordedAt: decidedAt,
            artifacts: [MODE_DECISION_FILE],
            evidence: "モード判定成果物と一時stagingを原子的に生成した",
        };
        fs.mkdirSync(path.join(temporary, WORKFLOW_JOURNAL_DIRECTORY), {
            mode: 0o700,
        });
        fs.writeFileSync(path.join(temporary, STEP_JOURNAL_FILE), `${JSON.stringify(initialEntry)}\n`, { flag: "wx", mode: 0o600 });
        if (decision.mode === "full") {
            for (const [name, template] of Object.entries(FULL_FILES))
                fs.copyFileSync(path.join(templateRoot, template), path.join(temporary, name), fs.constants.COPYFILE_EXCL);
            prefillFullArtifacts(temporary, {
                title: options.title,
                now: options.now,
                root,
                projectChoices: options.projectChoices,
            });
        }
        const artifacts = listStagingArtifacts(temporary);
        const record = {
            schemaVersion: "agent-skill-chain/staging-record/v1",
            mode: decision.mode,
            artifacts,
            digest: calculateStagingDigest(temporary, artifacts),
            owner: "runtime・project owner",
            createdAt: decidedAt,
            state: "local-active",
            tracker: null,
            checkpoint: null,
            syncedAt: null,
            syncDigest: null,
            readBackDigest: null,
        };
        fs.writeFileSync(path.join(temporary, STAGING_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    });
    return {
        path: finalPath,
        mode: decision.mode,
        reasons: decision.reasons,
        durable: false,
        synced: false,
    };
}
/** 検証済みstaging成果物をmode/checkpointの規定順で連結する。外部副作用は持たない。 */
export function buildIssueSyncBody(stagingInput, checkpoint, gherkinDialect) {
    const staging = path.resolve(stagingInput);
    const record = readStoredStagingRecord(staging);
    const observedArtifacts = listStagingArtifacts(staging);
    if (JSON.stringify(record.artifacts) !== JSON.stringify(observedArtifacts) ||
        record.digest !== calculateStagingDigest(staging, observedArtifacts))
        throw new Error("同期本文生成前のstaging成果物一覧またはdigestが一致しません。最新Stepをworkflow recordで再記録してください");
    if (record.mode === "full" ? ![4, 8].includes(checkpoint) : checkpoint !== 4)
        throw new Error(`同期本文のcheckpointがmode=${record.mode}と一致しません: ${checkpoint}`);
    const validation = validateIssue(staging, {
        stage: record.mode === "full"
            ? checkpoint === 8
                ? "design"
                : "requirements"
            : undefined,
        gherkinDialect,
    });
    if (!validation.valid)
        throw new Error(`同期本文の成果物が未検証です: ${validation.errors.join("; ")}`);
    const artifacts = issueSyncArtifactNames(record.mode, checkpoint);
    const body = `${artifacts
        .map((name) => fs.readFileSync(path.join(staging, name), "utf8").trimEnd())
        .join("\n\n---\n\n")}\n`;
    return Object.freeze({
        body,
        bodySha256: crypto
            .createHash("sha256")
            .update(body.trimEnd())
            .digest("hex"),
        artifacts: Object.freeze(artifacts),
        mode: record.mode,
        checkpoint,
    });
}
/**
 * 同期記録の書き込み可否を、**同期の副作用より前に**判定できる部分だけで確かめる。
 *
 * **不整合を後で拒否すると、Issueは同期済みなのにcommandが失敗する**（Issue #994）。
 * 配置・symlink・modeとcheckpointの対応に加え、`promotion-active`は
 * 昇格前のabsolute trackerと再同期対象の完全一致まで判定する。body digestは
 * 同期後にしか確かめられない。呼び出し側が事前検査に使い、`recordStagingSync`も
 * 同じ関数を通るため、trackerの抜け道を作らない。
 */
export function assertStagingSyncTarget(stagingPath, checkpoint, target, options = {}) {
    const resolved = path.resolve(stagingPath);
    const repositoryRoot = path.dirname(path.dirname(path.dirname(path.dirname(resolved))));
    const expected = path.join(repositoryRoot, ".agent-skill-chain", "tmp", "issues", path.basename(resolved));
    if (resolved !== expected || path.basename(resolved).includes(".."))
        throw new Error("同期記録は.agent-skill-chain/tmp/issues/直下のstagingだけに書き込めます");
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("同期記録の対象はsymlinkでない通常directoryが必要です");
    if (fs.realpathSync(resolved) !== resolved)
        throw new Error("同期記録の対象にsymlink祖先を使用できません");
    const current = readStoredStagingRecord(resolved);
    const expectedCheckpoint = current.mode === "full" ? 8 : 4;
    const promotionStep4 = options.allowPromotionStep4 === true &&
        current.mode === "full" &&
        current.state === "promotion-active" &&
        checkpoint === 4;
    if (checkpoint !== expectedCheckpoint && !promotionStep4)
        throw new Error(`mode=${current.mode}の最終同期checkpointはStep ${expectedCheckpoint}です`);
    if (current.state === "promotion-active") {
        if (target === undefined ||
            !/^[^/\s]+\/[^/\s]+$/u.test(target.repository) ||
            !Number.isSafeInteger(target.issue) ||
            target.issue <= 0)
            throw new Error("promotion-activeの再同期には元GitHub IssueのrepositoryとIssue番号が必要です");
        const expectedTracker = `https://github.com/${target.repository}/issues/${target.issue}`;
        if (current.tracker !== expectedTracker)
            throw new Error(`promotion-activeは元Issueだけに再同期できます: 記録値=${current.tracker ?? "なし"} 対象=${expectedTracker}`);
    }
    return current;
}
export function recordStagingSync(stagingPath, input) {
    const resolved = path.resolve(stagingPath);
    return withStagingMutationLock(resolved, () => recordStagingSyncLocked(resolved, input));
}
function recordStagingSyncLocked(resolved, input) {
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*$/u.test(input.tracker))
        throw new Error("trackerはabsolute GitHub Issue URLが必要です");
    const absoluteTracker = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/([1-9]\d*)$/u.exec(input.tracker);
    const target = absoluteTracker
        ? {
            repository: absoluteTracker[1],
            issue: Number(absoluteTracker[2]),
        }
        : undefined;
    const current = assertStagingSyncTarget(resolved, input.checkpoint, target);
    if (current.state === "promotion-active" && input.tracker !== current.tracker)
        throw new Error("promotion-activeの同期結果trackerが元Issueと一致しません");
    const expectedCheckpoint = current.mode === "full" ? 8 : 4;
    if (!/^[a-f0-9]{64}$/u.test(input.bodyDigest))
        throw new Error("bodyDigestは64桁SHA-256でなければなりません");
    if (!/^[a-f0-9]{64}$/u.test(input.readBackDigest) ||
        input.bodyDigest !== input.readBackDigest)
        throw new Error("書き込み後読み取りbody digestが同期内容と一致しません");
    const syncedAt = Date.parse(input.syncedAt);
    if (!Number.isFinite(syncedAt) ||
        new Date(syncedAt).toISOString() !== input.syncedAt)
        throw new Error("syncedAtはISO 8601 UTC日時でなければなりません");
    const artifacts = listStagingArtifacts(resolved);
    const required = current.mode === "full"
        ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
        : ["00_要求定義.md"];
    const missing = required.filter((artifact) => !artifacts.includes(artifact));
    if (missing.length > 0)
        throw new Error(`mode別の必要成果物が不足しています: ${missing.join(", ")}`);
    const updated = {
        ...current,
        artifacts,
        digest: calculateStagingDigest(resolved, artifacts),
        state: "sync-verified",
        tracker: input.tracker,
        checkpoint: expectedCheckpoint,
        syncedAt: input.syncedAt,
        syncDigest: input.bodyDigest,
        readBackDigest: input.readBackDigest,
    };
    writeFileAtomic(path.join(resolved, STAGING_RECORD_FILE), `${JSON.stringify(updated, null, 2)}\n`, { temporaryDirectory: path.dirname(resolved) });
    const reread = readStoredStagingRecord(resolved);
    if (JSON.stringify(reread) !== JSON.stringify(updated))
        throw new Error("同期記録の書き込み後読み取り確認に失敗しました");
    return reread;
}
export function validateIssue(issuePath, options = {}) {
    const errors = [];
    const gherkinDialect = options.gherkinDialect ?? DEFAULT_GHERKIN_DIALECT;
    const scenarioId = scenarioIdPattern(gherkinDialect);
    const requirementPath = path.join(issuePath, "00_要求定義.md");
    if (!fs.existsSync(requirementPath))
        return {
            valid: false,
            mode: "full",
            errors: ["00_要求定義.mdがありません"],
            blockedOperations: [],
        };
    const text = fs.readFileSync(requirementPath, "utf8");
    const declaredValue = /^\|\s*モード\s*\|\s*`?(quick|full|poc)`?\s*\|\s*$/m.exec(text)?.[1];
    const declared = declaredValue === "quick" || declaredValue === "poc"
        ? declaredValue
        : "full";
    let mode = declared;
    const requiredHeadings = issueRequiredHeadings(declared);
    for (const heading of requiredHeadings) {
        if (!text.includes(`## ${heading}`))
            errors.push(`必須項目がありません: ${heading}`);
    }
    const validatedFullFiles = declared !== "full"
        ? Object.keys(FULL_FILES)
        : options.stage === "request"
            ? []
            : options.stage === "requirements"
                ? ["01_要件定義.md"]
                : options.stage === "design-artifact"
                    ? ["01_要件定義.md", "02_設計.md"]
                    : Object.keys(FULL_FILES);
    const allText = [
        text,
        ...validatedFullFiles
            .filter((name) => fs.existsSync(path.join(issuePath, name)))
            .map((name) => fs.readFileSync(path.join(issuePath, name), "utf8")),
    ].join("\n");
    const documentPlaceholders = unresolvedPlaceholders(allText, gherkinDialect);
    if (documentPlaceholders.length > 0)
        errors.push(unresolvedPlaceholderError("", documentPlaceholders));
    for (let index = 1; index <= 7; index += 1) {
        const id = `P-${String(index).padStart(2, "0")}`;
        if (!text.includes(id))
            errors.push(`${id}の証拠がありません`);
    }
    if (!scenarioId.test(allText))
        errors.push("GherkinシナリオIDがありません");
    const disqualifiers = detectQuickDisqualifiers(options.changedFiles ?? []);
    if ((declared === "quick" || declared === "poc") &&
        disqualifiers.length > 0) {
        mode = "full";
        errors.push(`${declared}からfullへの単調昇格が必要: ${disqualifiers.join(", ")}`);
    }
    if (declared === "poc") {
        for (const label of [
            "PoC目的",
            "隔離fixture ID",
            "fixture root",
            "隔離境界Evidence",
            "初期化Evidence",
            "runner ID",
            "runner path",
            "成功条件",
            "中止条件",
            "非対象",
            "データ・security上の制約",
            "責任者",
            "full昇格条件",
            "廃止条件",
        ]) {
            const value = readTwoColumnValue(text, label);
            if (!value || /不明|未定|未確認|（/u.test(value)) {
                mode = "full";
                errors.push(`PoC宣言の${label}が未記入または不明なためfullへの昇格が必要です`);
            }
        }
        const modeDecisionPath = path.join(issuePath, MODE_DECISION_FILE);
        if (!fs.existsSync(modeDecisionPath)) {
            mode = "full";
            errors.push("PoC宣言を保持する00_モード判定.jsonがありません");
        }
        else {
            const parsed = parseModeDecision(fs.readFileSync(modeDecisionPath, "utf8"));
            if (!parsed.decision ||
                parsed.decision.mode !== "poc" ||
                !parsed.decision.poc) {
                mode = "full";
                errors.push(`PoC即時隔離観測宣言が不正です: ${parsed.errors.join("; ") || "poc宣言なし"}`);
            }
            else {
                const title = readTwoColumnValue(text, "件名") ?? "";
                const expected = requirementDocument("poc", title, parsed.decision.answers, parsed.decision.poc);
                const contractSections = (source) => source.slice(source.indexOf("## 4. PoC宣言（必須）"), source.indexOf("## 6. 要求、受け入れ条件"));
                if (contractSections(text) !== contractSections(expected)) {
                    mode = "full";
                    errors.push("00_要求定義.mdのPoC宣言・high risk確認が00_モード判定.jsonと一致しません");
                }
            }
        }
        for (const id of POC_HIGH_RISK_IDS) {
            const row = new RegExp(`^\\|\\s*${id}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "m").exec(text);
            if (!row) {
                mode = "full";
                errors.push(`PoC high risk条件 ${id} が未確認のためfullへの昇格が必要です`);
            }
            else if (row[1] !== "なし" ||
                !row[2] ||
                row[2].includes("不明") ||
                row[2].includes("（")) {
                mode = "full";
                errors.push(`PoC high risk条件 ${id} が不明または存在するためfullへの昇格が必要です`);
            }
        }
    }
    const requestedOperation = options.requestedOperation ?? options.operation;
    const blockedOperations = declared === "poc"
        ? ["release", "automatic-merge", "production-cleanup"]
        : [];
    if (declared === "poc" &&
        requestedOperation &&
        isPocBlockedOperation(requestedOperation))
        errors.push(`PoCでは${requestedOperation}を要求できません。delivery.stopAt=${options.delivery?.stopAt ?? "pull_request"}で停止し、fullへ昇格してください`);
    if (mode === "full") {
        const requiredFiles = validatedFullFiles;
        for (const name of requiredFiles)
            if (!fs.existsSync(path.join(issuePath, name)))
                errors.push(`fullモードには${name}が必要です`);
    }
    const considerationFiles = mode === "full"
        ? ["00_要求定義.md", ...validatedFullFiles]
        : ["00_要求定義.md"];
    for (const name of considerationFiles) {
        const file = path.join(issuePath, name);
        if (!fs.existsSync(file))
            continue;
        errors.push(...validateDevelopmentConsiderations(fs.readFileSync(file, "utf8"), name, {
            /**
             * **00は参照行を使えない。** 参照先である00自身が参照行になると判定が
             * 空虚になる（INV-02）。quickとpocは00だけを検証するので常に4行必須である。
             */
            allowReference: name !== "00_要求定義.md",
        }).errors);
    }
    if (mode === "full" &&
        options.stage !== "request" &&
        options.stage !== "requirements")
        errors.push(...validateLowRiskShortForms(issuePath, options.stage === "design-artifact"
            ? new Set(validatedFullFiles)
            : undefined));
    return { valid: errors.length === 0, mode, errors, blockedOperations };
}
function readTwoColumnValue(text, label) {
    return new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "m")
        .exec(text)?.[1]
        ?.trim();
}
function isPocBlockedOperation(operation) {
    const normalized = operation.toLowerCase().replaceAll("_", "-");
    return (normalized.includes("release") ||
        (normalized.includes("merge") &&
            (normalized.includes("automatic") ||
                normalized.includes("auto") ||
                normalized.includes("自動"))) ||
        (normalized.includes("cleanup") &&
            (normalized.includes("production") ||
                normalized.includes("prod") ||
                normalized.includes("本番") ||
                normalized === "cleanup")));
}
export function planPocPromotion(issuePath) {
    const missing = Object.keys(FULL_FILES).filter((name) => !fs.existsSync(path.join(issuePath, name)));
    const reasons = missing.map((name) => `${name}はPoCの最小成果物に含まれず、正式開発のfullモードで補完が必要です`);
    const requirementPath = path.join(issuePath, "00_要求定義.md");
    if (!fs.existsSync(requirementPath)) {
        if (!missing.includes("00_要求定義.md"))
            missing.unshift("00_要求定義.md");
        reasons.unshift("PoCから正式開発へ昇格する根拠となる00_要求定義.mdがありません");
    }
    else {
        const text = fs.readFileSync(requirementPath, "utf8");
        if (!/^\|\s*モード\s*\|\s*`?poc`?\s*\|\s*$/m.test(text))
            reasons.push("管理情報のモードがpocではないため、昇格元を確認してください");
        else
            reasons.unshift("PoC宣言の成功・中止条件とhigh risk確認を昇格根拠としてfull成果物へ追跡してください");
    }
    return { missing, reasons };
}
//# sourceMappingURL=issue.js.map