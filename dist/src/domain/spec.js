import fs from "node:fs";
import path from "node:path";
import { publishDirectoryAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
const templateRoot = path.join(findPackageRoot(import.meta.url), ".agent-skill-chain", "templates", "specs");
const UI_CATEGORIES = new Set(["05_画面", "17_デザイン", "18_レイアウト"]);
const UI_PROJECT_KINDS = new Set([
    "ui",
    "theme",
    "responsive",
    "design-system",
]);
const PROJECT_KINDS = new Set([
    "cli",
    "api",
    "service",
    "library",
    "batch",
    "data",
    ...UI_PROJECT_KINDS,
]);
const REQUIRED = [
    "00_利用案内.md",
    "00_仕様書構成/00_仕様書索引.md",
    "01_システム概要/00_概要.md",
    "01_システム概要/02_用語・略語.md",
    "02_要件/00_要件一覧.md",
    "03_アーキテクチャ/00_全体構成.md",
    "04_機能/00_機能一覧.md",
    "06_外部インターフェース/00_インターフェース一覧.md",
    "07_データ/00_データ一覧.md",
    "08_バッチ・ジョブ/00_ジョブ一覧.md",
    "09_基盤・ネットワーク/00_環境・基盤一覧.md",
    "10_セキュリティ/00_セキュリティ方針・資産.md",
    "11_非機能/00_非機能要件一覧.md",
    "12_運用保守/00_運用設計.md",
    "13_移行・廃止/00_移行計画.md",
    "14_開発・品質/00_ディレクトリ構成.md",
    "14_開発・品質/01_コーディング標準.md",
    "14_開発・品質/02_テスト標準.md",
    "15_要件追跡/00_追跡表.md",
    "16_参照資料/00_官公庁一次資料台帳.md",
];
const GLOSSARY = "01_システム概要/02_用語・略語.md";
const SPEC_CHANGE_LOG = "15_要件追跡/01_変更履歴.md";
/** 仕様変更履歴の用語ID列（0起点で3列目）。 */
const CHANGE_LOG_TERM_COLUMN = 3;
const GLOSSARY_HEADER = "| 用語ID | 標準語 | 定義 | 種別 | 境界づけられたコンテキスト | 成立例・反例 | 類義語・禁止表現 | 根拠ID・資料 | owner | 状態・適用版・置換先 |";
const GLOSSARY_TYPES = new Set(["business", "system", "acronym"]);
function tableCells(line) {
    return line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
}
/**
 * 仕様変更履歴の用語ID列が名指しする用語IDと、範囲記法の有無を取り出す。
 *
 * **範囲記法を許さない。** `TERM-ASC-089〜091`は走査で089と091しか拾えず、
 * **中間の090が検査を素通りする。** 個別列挙へ限定すれば走査結果が名指しの全体と一致する。
 */
function changeLogTermCitations(file) {
    const ids = [];
    const ranges = [];
    if (!fs.existsSync(file))
        return { ids, ranges };
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
        const cells = tableCells(line);
        const column = cells[CHANGE_LOG_TERM_COLUMN];
        if (column === undefined)
            continue;
        const cited = [...column.matchAll(/TERM-[A-Z0-9][A-Z0-9-]*/gu)].map((match) => match[0]);
        if (cited.length === 0)
            continue;
        ids.push(...cited);
        if (/TERM-[A-Z0-9][A-Z0-9-]*\s*[〜~]/u.test(column))
            ranges.push(column);
    }
    return { ids, ranges };
}
function validateDomainGlossary(file) {
    if (!fs.existsSync(file))
        return [];
    const errors = [];
    const markdown = fs.readFileSync(file, "utf8");
    if (!markdown.includes(GLOSSARY_HEADER))
        errors.push("ドメイン用語台帳の必須列がありません");
    const ids = new Set();
    const termsByContext = new Set();
    for (const line of markdown.split(/\r?\n/u)) {
        const cells = tableCells(line);
        const id = cells[0] ?? "";
        if (!id.startsWith("TERM-"))
            continue;
        if (cells.length !== 10) {
            errors.push(`ドメイン用語台帳の列数が不正です: ${id}`);
            continue;
        }
        if (!/^TERM-[A-Z0-9][A-Z0-9-]*$/u.test(id))
            errors.push(`ドメイン用語IDが不正です: ${id}`);
        if (ids.has(id))
            errors.push(`ドメイン用語IDが重複しています: ${id}`);
        ids.add(id);
        if (cells.some((cell) => cell.length === 0 || cell === "-"))
            errors.push(`ドメイン用語台帳に空欄があります: ${id}`);
        const type = cells[3] ?? "";
        if (!GLOSSARY_TYPES.has(type))
            errors.push(`ドメイン用語の種別が不正です: ${id}`);
        const term = cells[1] ?? "";
        const context = cells[4] ?? "";
        const termKey = `${context}\u0000${term}`;
        if (termsByContext.has(termKey))
            errors.push(`同一コンテキストの標準語が重複しています: ${context}/${term}`);
        termsByContext.add(termKey);
        const lifecycle = cells[9] ?? "";
        if (!/^(?:active|deprecated)(?:、|$)/u.test(lifecycle))
            errors.push(`耐久用語台帳にcandidateまたは未知状態を置けません: ${id}`);
        if (lifecycle.startsWith("deprecated") &&
            !/TERM-[A-Z0-9][A-Z0-9-]*/u.test(lifecycle))
            errors.push(`deprecated用語に置換先がありません: ${id}`);
    }
    /**
     * **仕様変更履歴が名指しした用語IDは台帳に存在しなければならない。**
     *
     * 片方だけを更新した状態を外部reviewerの指摘を待たずに検出する（Issue #1129）。
     * **逆方向は要求しない。** 台帳の全用語が変更履歴に載ることは不変条件ではなく、
     * 実測で台帳59件に対し用語ID列が埋まるのは68行中8行であり、要求すると既存が
     * 即座に不合格になる。**永久に塞がる門を作らない。**
     *
     * **両方を更新し忘れた場合は検出できない。** 版管理下に比較対象が残らないためで、
     * これがIssue #965の事象である。**本検査はその再発を検出しない。**
     */
    const citations = changeLogTermCitations(path.join(path.dirname(path.dirname(file)), SPEC_CHANGE_LOG));
    for (const range of citations.ranges)
        errors.push(`仕様変更履歴の用語ID列へ範囲記法を置けません: ${range}`);
    for (const cited of citations.ids)
        if (!ids.has(cited))
            errors.push(`仕様変更履歴が名指しする用語IDが台帳にありません: ${cited}`);
    return errors;
}
function listTemplateFiles(root, relative = "") {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory))
        throw new Error("system specification templateがpackage内にありません");
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        .flatMap((entry) => {
        if (entry.isSymbolicLink())
            throw new Error(`system specification templateにsymbolic linkは使用できません: ${path.join(relative, entry.name)}`);
        const child = path.join(relative, entry.name);
        if (entry.isDirectory())
            return listTemplateFiles(root, child);
        if (!entry.isFile())
            throw new Error(`system specification templateに未対応のentryがあります: ${child}`);
        return [child];
    });
}
function selectedTemplateFiles(projectKind) {
    if (!PROJECT_KINDS.has(projectKind))
        throw new Error("project kindが不正です");
    const withUi = UI_PROJECT_KINDS.has(projectKind);
    return listTemplateFiles(templateRoot).filter((relative) => withUi || !UI_CATEGORIES.has(relative.split(path.sep)[0]));
}
export function bootstrapProject(root, options) {
    const meaningfulEntries = fs.existsSync(root)
        ? fs.readdirSync(root).filter((name) => name !== ".git")
        : [];
    if (!options.newProject && !options.onboardExisting)
        throw new Error("初期生成には--new-projectまたは明示的な--onboard-existing承認が必要です");
    if (options.newProject &&
        meaningfulEntries.length > 0 &&
        !options.onboardExisting)
        throw new Error("既存内容があるため--new-projectとして扱えません。明示的な導入承認が必要です");
    const specs = path.join(root, "docs", "specs");
    const planned = selectedTemplateFiles(options.projectKind);
    const withTokens = UI_PROJECT_KINDS.has(options.projectKind);
    const policyNotice = {
        generatedScope: options.apply ? ["docs/specs/"] : [],
        projectPolicyStatus: "not-generated-not-validated",
        projectPolicyNotice: "docs/specs/だけを生成対象とし、project policyは生成も検証もしていません",
        nextSafeOperation: ".agent-skill-chain/project-policy.jsonと列挙するproject資産をproject ownerが作成し、policy validateとconformance validateを実行してください",
    };
    if (!options.apply)
        return {
            applied: false,
            planned,
            tokenSpecs: withTokens,
            ...policyNotice,
        };
    if (fs.existsSync(specs))
        throw new Error("docs/specsは既に存在します。利用側所有資産を上書きしません");
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    publishDirectoryAtomic(specs, (temporary) => {
        for (const relative of planned) {
            const destination = path.join(temporary, relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(templateRoot, relative), destination, fs.constants.COPYFILE_EXCL);
        }
    });
    return { applied: true, planned, tokenSpecs: withTokens, ...policyNotice };
}
export function validateSpecs(root, options = {}) {
    const errors = [];
    const specs = path.join(root, "docs", "specs");
    for (const name of REQUIRED) {
        const file = path.join(specs, name);
        if (!fs.existsSync(file) || fs.statSync(file).size === 0)
            errors.push(`必須仕様がありません: ${name}`);
    }
    errors.push(...validateDomainGlossary(path.join(specs, GLOSSARY)));
    const registry = path.join(specs, "16_参照資料", "00_官公庁一次資料台帳.md");
    if (fs.existsSync(registry)) {
        const registryText = fs.readFileSync(registry, "utf8");
        for (const field of [
            "文書名",
            "公開者",
            "公式URL",
            "位置づけ",
            "採否",
            "取得日",
            "版・更新日",
            "ライセンス",
            "帰属表示",
            "加工内容",
            "採否理由",
        ]) {
            if (!registryText.includes(field))
                errors.push(`一次資料台帳の項目がありません: ${field}`);
        }
    }
    const changes = options.changedFiles ?? [];
    const requiresSpecUpdate = changes.some((file) => {
        const normalized = file.replaceAll("\\", "/");
        return (/^(?:src|bin)\//.test(normalized) ||
            /^(?:package(?:-lock)?\.json|\.github\/workflows\/)/.test(normalized) ||
            /^\.agent-skill-chain\/(?:docs|skills|templates|schemas|policy)\//.test(normalized) ||
            /(^|\/)architecture(\/|\.|$)/i.test(normalized));
    });
    if (changes.length > 0 && !options.review?.specImpact)
        errors.push("仕様影響が不明です");
    if (requiresSpecUpdate && options.review?.specImpact !== "updated")
        errors.push("振る舞い・構造・安全・policyへ影響する変更には仕様更新が必要です");
    if (options.review?.specImpact === "updated") {
        const trace = options.review.trace;
        if (!trace?.requirements?.length ||
            !trace?.scenarios?.length ||
            !trace?.tests?.length)
            errors.push("更新した仕様には要件・シナリオ・テストの追跡が必要です");
    }
    if (options.review?.specImpact === "no-spec-impact" &&
        (!options.review.rationale || options.review.rationale.trim().length < 12)) {
        errors.push("no-spec-impactには対象範囲を限定した根拠が必要です");
    }
    return { valid: errors.length === 0, errors };
}
export { REQUIRED as requiredSpecFiles };
//# sourceMappingURL=spec.js.map