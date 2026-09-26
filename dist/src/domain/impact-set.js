import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { validateSemanticGraphSnapshot, } from "./semantic-graph.js";
/**
 * **影響集合（Impact Set、TERM-ASC-WR-04）。**
 *
 * 2 commit間の実Git差分から一度だけ導出し、review roundの焦点
 * （`focus.adjacentScope`）・reviewer文脈・検証選択の3用途で共有する
 * （REQ-WF-039、REQ-WF-040）。**影響を証明できない場合は`mode: "full"`へ倒し、
 * 理由を`reasons`へ名指しする。** securityの扱いは縮小しない。
 */
export const IMPACT_SET_SCHEMA_VERSION = "agent-skill-chain/impact-set/v1";
/** 隣接範囲の上限。超えた場合は全体reviewへ倒す（review入力bundleの上限を守る）。 */
export const IMPACT_ADJACENT_LIMIT = 256;
/** 文字列参照の展開回数上限。超えた場合は影響を証明できないとみなす。 */
export const IMPACT_EXPANSION_LIMIT = 32;
/** 影響moduleの件数上限。超えた場合は影響を証明できないとみなす。 */
export const IMPACT_AFFECTED_LIMIT = 20_000;
const ECMASCRIPT_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const TYPESCRIPT_EXTENSION = /\.([cm]?)ts(x?)$/u;
/**
 * **全体に効く設定・基盤。** 変更されると個別featureへの影響を証明できない。
 * step定義はCucumberの大域表へ読み込まれるため、1 fileの変更が全featureへ効く。
 */
const INFRASTRUCTURE_PATTERNS = Object.freeze([
    /^package\.json$/u,
    /^package-lock\.json$/u,
    /^npm-shrinkwrap\.json$/u,
    /^cucumber\.[a-z]+$/u,
    /^tsconfig[^/]*\.json$/u,
    /^eslint\.config\.[a-z]+$/u,
    /^\.eslintrc/u,
    /^\.prettierrc/u,
    /^\.prettierignore$/u,
    /^prettier\.config\.[a-z]+$/u,
    /^test\/support\//u,
    /^test\/steps\//u,
    /^scripts\/compile\.ts$/u,
    /^scripts\/build\.ts$/u,
    /^\.github\//u,
    /^\.agent-skill-chain\/schemas\//u,
    /^bin\//u,
]);
const SECURITY_EXACT = new Set([
    "src/lib/security.ts",
    "src/lib/process.ts",
    "src/lib/atomic.ts",
    "src/lib/entrypoint.ts",
]);
const SECURITY_NAME = /auth|trust|secret|permission|policy|merge|delivery|release|reanchor|evidence|review-convergence|jev-/u;
export function isInfrastructurePath(changedPath) {
    return INFRASTRUCTURE_PATTERNS.some((pattern) => pattern.test(changedPath));
}
/**
 * **security上の注意を要するpath。** 判定はreviewerの注意を促すためだけに使い、
 * 単独ではfull検証へ倒さない（基盤でもある場合は基盤として倒れる）。
 */
export function isSecuritySensitivePath(candidate) {
    if (SECURITY_EXACT.has(candidate))
        return true;
    if (candidate.startsWith(".github/"))
        return true;
    return candidate.startsWith("src/") && SECURITY_NAME.test(candidate.slice(4));
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
function basename(candidate) {
    return candidate.slice(candidate.lastIndexOf("/") + 1);
}
/** fileを字面で参照するときに現れ得るbasename。TypeScriptは出力後の名前も含める。 */
export function referenceNames(candidate) {
    const name = basename(candidate);
    const typed = TYPESCRIPT_EXTENSION.exec(name);
    if (typed === null)
        return [name];
    const stem = name.slice(0, typed.index);
    return sortedUnique([name, `${stem}.${typed[1]}js${typed[2]}`]);
}
function pushTo(map, key, value) {
    const values = map.get(key);
    if (values === undefined)
        map.set(key, [value]);
    else
        values.push(value);
}
function indexGraph(snapshot) {
    const files = new Set();
    for (const node of snapshot.nodes)
        if (node.kind === "file")
            files.add(node.id.slice("file:".length));
    const importers = new Map();
    const imports = new Map();
    const scenariosBySatisfyingFile = new Map();
    const featuresByScenario = new Map();
    for (const edge of snapshot.edges) {
        if (edge.certainty !== "deterministic")
            continue;
        if (edge.kind === "imports" &&
            edge.from.startsWith("file:") &&
            edge.to.startsWith("file:")) {
            const from = edge.from.slice(5);
            const to = edge.to.slice(5);
            pushTo(importers, to, from);
            pushTo(imports, from, to);
        }
        if (edge.kind === "satisfied-by" &&
            edge.from.startsWith("scenario:") &&
            edge.to.startsWith("file:"))
            pushTo(scenariosBySatisfyingFile, edge.to.slice(5), edge.from.slice("scenario:".length));
        if (edge.kind === "verified-by" &&
            edge.from.startsWith("scenario:") &&
            edge.to.startsWith("file:") &&
            edge.to.endsWith(".feature"))
            pushTo(featuresByScenario, edge.from.slice("scenario:".length), edge.to.slice(5));
    }
    return {
        files,
        importers,
        imports,
        scenariosBySatisfyingFile,
        featuresByScenario,
    };
}
function classifyChangedPath(changedPath, context) {
    if (isInfrastructurePath(changedPath))
        return {
            kind: "fallback",
            reason: `全体に効く設定・基盤が変更されました: ${changedPath}`,
        };
    if (context.stepDefinitionFiles.has(changedPath))
        return {
            kind: "fallback",
            reason: `step定義は全featureで共有されるため個別に絞れません: ${changedPath}`,
        };
    if (changedPath.startsWith("dist/")) {
        const counterpart = changedPath
            .slice("dist/".length)
            .replace(/\.([cm]?)js(x?)$/u, ".$1ts$2");
        return context.changed.has(counterpart)
            ? { kind: "derived" }
            : {
                kind: "fallback",
                reason: `build成果物だけが変化し対応するsourceの変更がありません: ${changedPath}`,
            };
    }
    if (changedPath.endsWith(".feature"))
        return { kind: "feature" };
    if (changedPath.endsWith(".md"))
        return { kind: "document" };
    if (ECMASCRIPT_EXTENSION.test(changedPath)) {
        if (context.index?.files.has(changedPath))
            return { kind: "source" };
        return {
            kind: "fallback",
            reason: `削除・改名されたsource、またはGraphへ投影されないsourceです: ${changedPath}`,
        };
    }
    return {
        kind: "fallback",
        reason: `影響を導出できない種別のfileです: ${changedPath}`,
    };
}
/**
 * **seedから影響moduleの閉包を求める。**
 *
 * 1. import元を推移的に辿る（seedを使うmoduleはseedの変更に影響される）
 * 2. path指定で起動される入口（import元を持たないfile、`src/`外のfile）と
 *    seed自身については、basenameを字面で含む`src/`外のfile（test・script）も
 *    影響を受けるとみなす（`node dist/bin/x.js`の起動や文書の機械読み取りは
 *    import edgeを持たない）。`src/`内の字面参照は利用projectのfile名を指すことが
 *    多く、辿ると無関係な製品moduleへ連鎖するため辿らない
 * 3. 追加が止まるまで繰り返す
 */
function affectedClosure(seeds, index, literalReferences) {
    const affected = new Set();
    const literalExpanded = new Set();
    let frontier = [...seeds];
    const seedSet = new Set(seeds);
    for (let round = 0; round < IMPACT_EXPANSION_LIMIT; round += 1) {
        const queue = [...frontier];
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            if (affected.has(current))
                continue;
            affected.add(current);
            if (affected.size > IMPACT_AFFECTED_LIMIT)
                return { affected, complete: false };
            for (const importer of index.importers.get(current) ?? [])
                if (!affected.has(importer))
                    queue.push(importer);
        }
        const next = [];
        for (const file of affected) {
            if (literalExpanded.has(file))
                continue;
            const entry = seedSet.has(file) ||
                (index.importers.get(file) ?? []).length === 0 ||
                !file.startsWith("src/");
            if (!entry)
                continue;
            literalExpanded.add(file);
            for (const name of referenceNames(file))
                for (const referrer of literalReferences[name] ?? [])
                    if (!affected.has(referrer) && !referrer.startsWith("src/"))
                        next.push(referrer);
        }
        if (next.length === 0)
            return { affected, complete: true };
        frontier = next;
    }
    return { affected, complete: false };
}
function selectFromClosure(closure, index, input, stepDefinitionFiles) {
    const features = new Set();
    const scenarios = new Set();
    const reasons = [];
    if (!closure.complete)
        reasons.push("影響moduleの閉包が上限内で確定しませんでした");
    const affectedSteps = new Set();
    for (const file of closure.affected) {
        for (const scenario of index.scenariosBySatisfyingFile.get(file) ?? []) {
            scenarios.add(scenario);
            for (const feature of index.featuresByScenario.get(scenario) ?? [])
                features.add(feature);
        }
        const summary = stepDefinitionFiles.get(file);
        if (summary === undefined)
            continue;
        if (!summary.complete)
            reasons.push(`影響を受けるstep定義fileが字面から取り出せない登録を含みます: ${file}`);
        if (summary.global)
            reasons.push(`影響を受けるfileがhookまたはWorldとして全scenarioへ効きます: ${file}`);
        affectedSteps.add(file);
    }
    if (affectedSteps.size > 0) {
        for (const [feature, steps] of Object.entries(input.featureBinding.byFeature))
            if (steps.some((step) => affectedSteps.has(step)))
                features.add(feature);
        /** どのstep定義を使うか分からないfeatureは、影響を受け得るとして含める */
        for (const feature of input.featureBinding.unmatchedFeatures)
            features.add(feature);
        if (input.featureBinding.unparsedFeatures.length > 0)
            reasons.push(`step本文を解釈できないfeatureがあります: ${input.featureBinding.unparsedFeatures.join(", ")}`);
    }
    return { features, scenarios, reasons };
}
function scriptsReferencing(scripts, files) {
    const names = [];
    const candidates = [...files].filter((file) => !file.startsWith("dist/"));
    for (const [name, command] of Object.entries(scripts))
        if (candidates.some((file) => command.includes(file)))
            names.push(name);
    return names;
}
function withDigest(body) {
    const digest = crypto
        .createHash("sha256")
        .update(stableJson(body))
        .digest("hex");
    return Object.freeze({
        ...body,
        adjacent: Object.freeze(body.adjacent.map((path) => Object.freeze({ path, graphEvidence: digest }))),
        digest,
    });
}
/**
 * **影響集合を純粋に導出する。** 入力は実Gitの差分とcommitから構築した
 * 意味Graphだけであり、呼び出し側の申告を含まない。
 */
export function deriveImpactSet(input) {
    const changedPaths = sortedUnique(input.changedPaths);
    const changed = new Set(changedPaths);
    const reasons = [];
    let index;
    let graphContentHash = null;
    if (input.graph.status === "unavailable")
        reasons.push(`意味Graphを構築できません: ${input.graph.reason}`);
    else {
        const errors = validateSemanticGraphSnapshot(input.graph.snapshot);
        if (errors.length > 0)
            reasons.push(`意味Graphが不正です: ${errors.slice(0, 3).join("; ")}`);
        else {
            index = indexGraph(input.graph.snapshot);
            graphContentHash = input.graph.contentHash;
        }
    }
    const stepDefinitionFiles = new Map(input.stepDefinitionFiles.map((summary) => [summary.path, summary]));
    const sources = [];
    const features = new Set();
    const scenarios = new Set();
    const checks = new Set();
    const documents = [];
    for (const changedPath of changedPaths) {
        const classified = classifyChangedPath(changedPath, {
            changed,
            index,
            stepDefinitionFiles: new Set(stepDefinitionFiles.keys()),
        });
        if (classified.kind === "fallback")
            reasons.push(classified.reason);
        if (classified.kind === "source")
            sources.push(changedPath);
        if (classified.kind === "document")
            documents.push(changedPath);
        if (classified.kind === "feature") {
            if (index?.files.has(changedPath))
                features.add(changedPath);
            if (input.scripts["test:format"] !== undefined)
                checks.add("test:format");
        }
    }
    if (documents.length > 0 && input.scripts["docs:format"] !== undefined)
        checks.add("docs:format");
    if (documents.some((file) => file.startsWith("docs/specs/")) &&
        input.scripts["trace:check"] !== undefined)
        checks.add("trace:check");
    const adjacent = new Set();
    if (index !== undefined) {
        for (const source of sources) {
            for (const importer of index.importers.get(source) ?? [])
                if (!changed.has(importer))
                    adjacent.add(importer);
            for (const imported of index.imports.get(source) ?? [])
                if (!changed.has(imported))
                    adjacent.add(imported);
        }
        if (adjacent.size > IMPACT_ADJACENT_LIMIT)
            reasons.push(`隣接範囲が上限${IMPACT_ADJACENT_LIMIT}件を超えました: ${adjacent.size}件`);
        /**
         * **変更source fileごとに到達featureを確かめる。** 和集合だけを見ると、
         * どのfeatureにも到達しないsourceが他fileの選択に紛れて検証されずに通る。
         */
        for (const source of sources) {
            const closure = affectedClosure([source], index, input.literalReferences);
            const selection = selectFromClosure(closure, index, input, stepDefinitionFiles);
            reasons.push(...selection.reasons);
            if (selection.features.size === 0)
                reasons.push(`変更sourceから検証featureへ到達できません: ${source}`);
            for (const feature of selection.features)
                features.add(feature);
            for (const scenario of selection.scenarios)
                scenarios.add(scenario);
            for (const name of scriptsReferencing(input.scripts, closure.affected))
                checks.add(name);
        }
        /** 文書は字面で読むfileだけを影響元にする。読まれない文書は形式検査だけでよい */
        if (documents.length > 0) {
            const closure = affectedClosure(documents, index, input.literalReferences);
            const selection = selectFromClosure(closure, index, input, stepDefinitionFiles);
            reasons.push(...selection.reasons);
            for (const feature of selection.features)
                features.add(feature);
            for (const scenario of selection.scenarios)
                scenarios.add(scenario);
            for (const name of scriptsReferencing(input.scripts, closure.affected))
                checks.add(name);
            /**
             * **`src/`が字面で読む文書は製品の挙動を変える。** 閉包は`src/`の字面参照を
             * 辿らないため、その文書から検証featureを選べなければ形式検査だけで
             * targetedにせず全体へ倒す。
             */
            for (const document of documents) {
                const readBySource = referenceNames(document).some((name) => (input.literalReferences[name] ?? []).some((referrer) => referrer.startsWith("src/")));
                if (!readBySource)
                    continue;
                const own = selectFromClosure(affectedClosure([document], index, input.literalReferences), index, input, stepDefinitionFiles);
                if (own.features.size === 0)
                    reasons.push(`src/が字面で読む文書から検証featureへ到達できません: ${document}`);
            }
        }
    }
    const adjacentPaths = sortedUnique(adjacent);
    const securityPaths = sortedUnique([...changedPaths, ...adjacentPaths].filter(isSecuritySensitivePath));
    const finalReasons = sortedUnique(reasons);
    const mode = finalReasons.length === 0 ? "targeted" : "full";
    return withDigest({
        schemaVersion: IMPACT_SET_SCHEMA_VERSION,
        baseSha: input.baseSha,
        headSha: input.headSha,
        changeDigest: input.changeDigest,
        changedPaths,
        graphContentHash,
        adjacent: adjacentPaths,
        securitySensitive: securityPaths.length > 0,
        securityPaths,
        features: mode === "targeted" ? sortedUnique(features) : [],
        scenarios: mode === "targeted" ? sortedUnique(scenarios) : [],
        checks: mode === "targeted" ? sortedUnique(checks) : [],
        mode,
        reasons: finalReasons,
    });
}
/**
 * **review roundへ渡す隣接範囲。** targetedのときだけ影響集合の隣接範囲を返し、
 * fullのときは空にする（全体reviewが適用される）。
 */
export function reviewAdjacentScope(impact) {
    return impact.mode === "targeted" ? impact.adjacent : [];
}
//# sourceMappingURL=impact-set.js.map