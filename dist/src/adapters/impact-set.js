import { bindFeaturesToStepDefinitions, } from "../domain/cucumber-binding.js";
import { deriveImpactSet, referenceNames, reviewAdjacentScope, } from "../domain/impact-set.js";
import { semanticGraphContentHash } from "../domain/semantic-graph.js";
import { isRecord } from "../types.js";
import { loadTypeScriptCompiler, } from "../lib/typescript-vendor.js";
import { buildCommitSemanticGraph } from "./repository-graph.js";
import { observeReviewDiff } from "./review-diff.js";
const ECMASCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const STEP_FUNCTIONS = new Set([
    "Given",
    "When",
    "Then",
    "And",
    "But",
    "defineStep",
    "Step",
]);
const GLOBAL_REGISTRATIONS = new Set([
    "Before",
    "After",
    "BeforeAll",
    "AfterAll",
    "BeforeStep",
    "AfterStep",
    "setWorldConstructor",
    "setDefaultTimeout",
    "defineParameterType",
    "setDefinitionFunctionWrapper",
]);
/**
 * 文字列中に現れるfile名らしき字面。path区切りや引用符で切り、
 * 末尾に拡張子を持つ語だけを取り出す。
 */
const FILE_NAME_TOKEN = /[^\s"'`/\\()<>,;:{}[\]|=+*!?&^%$#~@]+\.[A-Za-z][A-Za-z0-9]{0,9}(?![A-Za-z0-9])/gu;
function isScannedSource(file) {
    return (ECMASCRIPT_FILE.test(file) &&
        !file.startsWith("dist/") &&
        !file.startsWith("node_modules/") &&
        !file.includes("/node_modules/"));
}
/**
 * Cucumberのimport名を実名へ解決する表。`import { After as cucumberAfter }`の
 * 別名も登録関数として数える。
 */
function cucumberBindings(compiler, source) {
    const names = new Map();
    for (const statement of source.statements) {
        if (!compiler.isImportDeclaration(statement) ||
            !compiler.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== "@cucumber/cucumber")
            continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings === undefined || !compiler.isNamedImports(bindings))
            continue;
        for (const element of bindings.elements)
            names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
    return names;
}
function calleeName(compiler, expression) {
    if (compiler.isIdentifier(expression))
        return expression.text;
    if (compiler.isPropertyAccessExpression(expression))
        return expression.name.text;
    return undefined;
}
/**
 * **step定義fileを字面から要約する。** step登録関数の第1引数が文字列または
 * regex literalでない登録（動的生成）があれば`complete: false`にする。
 */
function summarizeStepDefinitionFile(compiler, file, text) {
    if (!text.includes("@cucumber/cucumber") &&
        !/\b(?:Given|When|Then|defineStep)\s*\(/u.test(text))
        return undefined;
    const source = compiler.createSourceFile(file, text, compiler.ScriptTarget.Latest, true);
    /** 文字列中の`@cucumber/cucumber`ではなく、実際のimport宣言だけを数える */
    const importsCucumber = source.statements.some((statement) => compiler.isImportDeclaration(statement) &&
        compiler.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@cucumber/cucumber");
    const aliases = cucumberBindings(compiler, source);
    const patterns = [];
    let complete = true;
    let global = false;
    let registrations = 0;
    const visit = (node) => {
        if (compiler.isCallExpression(node)) {
            const local = calleeName(compiler, node.expression);
            const name = local === undefined ? undefined : (aliases.get(local) ?? local);
            if (name !== undefined && GLOBAL_REGISTRATIONS.has(name)) {
                global = true;
                registrations += 1;
            }
            if (name !== undefined && STEP_FUNCTIONS.has(name)) {
                registrations += 1;
                const first = node.arguments[0];
                if (first !== undefined &&
                    (compiler.isStringLiteral(first) ||
                        compiler.isNoSubstitutionTemplateLiteral(first)))
                    patterns.push({ kind: "expression", source: first.text });
                else if (first !== undefined && compiler.isTemplateExpression(first))
                    /** 埋め込み式は任意列（`{}`）として広く一致させる */
                    patterns.push({
                        kind: "expression",
                        source: [
                            first.head.text,
                            ...first.templateSpans.map((span) => `{}${span.literal.text}`),
                        ].join(""),
                    });
                else if (first !== undefined &&
                    compiler.isRegularExpressionLiteral(first)) {
                    const literal = first.text;
                    const end = literal.lastIndexOf("/");
                    patterns.push({
                        kind: "regex",
                        source: literal.slice(1, end),
                        flags: literal.slice(end + 1),
                    });
                }
                else
                    complete = false;
            }
        }
        compiler.forEachChild(node, visit);
    };
    visit(source);
    if (!importsCucumber && registrations === 0)
        return undefined;
    /**
     * **step定義を持たないhook・World登録fileだけを全scenario共通とみなす。**
     * step定義fileに同居するhookは、そのfileのstepが用意したWorld状態を後始末する
     * ものとして、そのfileを使うfeatureへ影響を限る（仕様の前提として明記する）。
     */
    return {
        path: file,
        patterns,
        complete,
        global: global && patterns.length === 0,
    };
}
function literalReferenceIndex(sources, graphFiles) {
    const known = new Set(graphFiles.flatMap(referenceNames));
    const index = new Map();
    for (const [file, text] of sources) {
        if (!isScannedSource(file))
            continue;
        for (const match of text.matchAll(FILE_NAME_TOKEN)) {
            const token = match[0];
            if (!known.has(token))
                continue;
            const files = index.get(token) ?? new Set();
            files.add(file);
            index.set(token, files);
        }
    }
    return Object.fromEntries([...index].map(([token, files]) => [token, [...files].sort()]));
}
function packageScripts(sources) {
    const text = sources.get("package.json");
    if (text === undefined)
        return {};
    try {
        const parsed = JSON.parse(text);
        if (!isRecord(parsed) || !isRecord(parsed.scripts))
            return {};
        return Object.fromEntries(Object.entries(parsed.scripts).filter((entry) => typeof entry[1] === "string"));
    }
    catch {
        return {};
    }
}
/**
 * **2 commit間の影響集合をGitから導出する**（REQ-WF-039、REQ-WF-040）。
 *
 * 差分は`observeReviewDiff`、構造は`headSha`のcommit treeから構築した意味Graphで
 * 観測する。**worktreeを読まない**ため、checkout位置や未commit変更に左右されない。
 * SHAの解決失敗・非ancestorは例外（入力の誤り）、Graph構築の失敗は
 * `mode: "full"`（影響を証明できない）として扱う。
 */
export function computeImpactSet(input) {
    const observed = observeReviewDiff(input.root, input.baseSha, input.headSha);
    let graph;
    let sources = new Map();
    try {
        const built = buildCommitSemanticGraph(input.root, input.headSha);
        graph = {
            status: "built",
            snapshot: built.snapshot,
            contentHash: semanticGraphContentHash(built.snapshot),
        };
        sources = built.sources;
    }
    catch (error) {
        graph = {
            status: "unavailable",
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    const graphFiles = graph.status === "built"
        ? graph.snapshot.nodes
            .filter(({ kind }) => kind === "file")
            .map(({ id }) => id.slice("file:".length))
        : [];
    const definitions = [];
    if (graph.status === "built") {
        const compiler = loadTypeScriptCompiler();
        for (const [file, text] of sources) {
            if (!isScannedSource(file))
                continue;
            const summary = summarizeStepDefinitionFile(compiler, file, text);
            if (summary !== undefined)
                definitions.push(summary);
        }
    }
    const features = [...sources]
        .filter(([file]) => file.endsWith(".feature"))
        .map(([file, text]) => ({ path: file, text }));
    return deriveImpactSet({
        baseSha: input.baseSha,
        headSha: input.headSha,
        changeDigest: observed.digest,
        changedPaths: observed.changedPaths,
        graph,
        literalReferences: literalReferenceIndex(sources, graphFiles),
        stepDefinitionFiles: definitions.map(({ path, complete, global }) => ({
            path,
            complete,
            global,
        })),
        featureBinding: bindFeaturesToStepDefinitions({ features, definitions }),
        scripts: packageScripts(sources),
    });
}
/**
 * **review round 2以降の隣接範囲をGitから導出する**（REQ-WF-039）。
 *
 * 雛形作成（`buildReviewRoundDraft`）と記録前検証（`previewReviewRound`）が
 * 同じ関数を呼ぶ。記録前検証は提出された`adjacentScope`をこの戻り値と照合し、
 * 不一致を拒否する。**呼び出し側が任意のGraph Evidence digestを注入しても
 * 隣接範囲として受理されない。**
 */
export function deriveReviewRoundImpact(input) {
    const impact = computeImpactSet({
        root: input.root,
        baseSha: input.previousHeadSha,
        headSha: input.headSha,
    });
    return {
        impact,
        adjacentScope: reviewAdjacentScope(impact),
        adjacentScopeUnbounded: impact.mode === "full",
    };
}
//# sourceMappingURL=impact-set.js.map