import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_SEMANTIC_GRAPH_EDGES, MAX_SEMANTIC_GRAPH_NODES, SEMANTIC_GRAPH_BUILDER_VERSION, SEMANTIC_GRAPH_SCHEMA_VERSION, canonicalSemanticGraph, validateSemanticGraphSnapshot, } from "../domain/semantic-graph.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { loadTypeScriptCompiler, } from "../lib/typescript-vendor.js";
const MAX_SOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_SET_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_FILES = 200_000;
const MAX_TRACE_IDS_PER_CELL = 1_000;
const MAX_ECMASCRIPT_IMPORT_SCAN_TOKENS = 250_000;
const SOURCE_EXTENSIONS = new Set([
    ".astro",
    ".c",
    ".cc",
    ".cjs",
    ".clj",
    ".cljs",
    ".cmake",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".cts",
    ".dart",
    ".ex",
    ".exs",
    ".feature",
    ".fish",
    ".fs",
    ".fsx",
    ".go",
    ".gql",
    ".graphql",
    ".h",
    ".hpp",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".kts",
    ".less",
    ".lock",
    ".lua",
    ".md",
    ".mjs",
    ".mts",
    ".php",
    ".pl",
    ".pm",
    ".proto",
    ".ps1",
    ".py",
    ".rb",
    ".rs",
    ".rst",
    ".sass",
    ".scala",
    ".scss",
    ".sh",
    ".sql",
    ".svelte",
    ".swift",
    ".tf",
    ".tfvars",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
]);
const SOURCE_BASENAMES = new Set([
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    ".nvmrc",
    ".tool-versions",
    "CMakeLists.txt",
    "Containerfile",
    "Dockerfile",
    "Gemfile",
    "Jenkinsfile",
    "Makefile",
    "Procfile",
    "Rakefile",
    "go.mod",
    "go.sum",
]);
const REQUIREMENT_ID = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;
const ACCEPTANCE_ID = /\bAC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;
const SCENARIO_ID = /\bSCN-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;
const ECMASCRIPT_EXTENSIONS = new Set([
    ".cjs",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".mts",
    ".ts",
    ".tsx",
]);
function scriptKindFor(compiler, sourcePath) {
    const extension = path.posix.extname(sourcePath).toLowerCase();
    if (extension === ".tsx")
        return compiler.ScriptKind.TSX;
    if (extension === ".jsx")
        return compiler.ScriptKind.JSX;
    if (extension === ".ts" || extension === ".mts" || extension === ".cts")
        return compiler.ScriptKind.TS;
    return compiler.ScriptKind.JS;
}
function assertBoundedEcmaScriptTokens(compiler, source, sourcePath, scriptKind) {
    const languageVariant = scriptKind === compiler.ScriptKind.JSX ||
        scriptKind === compiler.ScriptKind.TSX
        ? compiler.LanguageVariant.JSX
        : compiler.LanguageVariant.Standard;
    const scanner = compiler.createScanner(compiler.ScriptTarget.Latest, true, languageVariant, source);
    let tokenCount = 0;
    while (scanner.scan() !== compiler.SyntaxKind.EndOfFileToken) {
        tokenCount += 1;
        if (tokenCount > MAX_ECMASCRIPT_IMPORT_SCAN_TOKENS)
            throw new Error(`ECMAScript import scanのtoken件数上限を超えました: ${sourcePath}`);
    }
}
function parseEcmaScriptSource(compiler, source, sourcePath) {
    const scriptKind = scriptKindFor(compiler, sourcePath);
    try {
        assertBoundedEcmaScriptTokens(compiler, source, sourcePath, scriptKind);
        const sourceFile = compiler.createSourceFile(sourcePath, source, compiler.ScriptTarget.Latest, true, scriptKind);
        const diagnostic = sourceFile.parseDiagnostics?.[0];
        if (diagnostic !== undefined) {
            const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
            throw new Error(`ECMAScript sourceの構文解析に失敗しました: ${sourcePath}:${position.line + 1}:${position.character + 1} (TS${diagnostic.code})`);
        }
        return sourceFile;
    }
    catch (error) {
        if (error instanceof Error &&
            (error.message.startsWith("ECMAScript import scanのtoken件数上限") ||
                error.message.startsWith("ECMAScript sourceの構文解析に失敗")))
            throw error;
        throw new Error(`ECMAScript sourceの解析resource境界を超えました: ${sourcePath}`, { cause: error });
    }
}
function literalImportSpecifier(compiler, node, requireIsShadowed) {
    if (compiler.isImportDeclaration(node))
        return compiler.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
    if (compiler.isExportDeclaration(node))
        return node.moduleSpecifier !== undefined &&
            compiler.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
    if (compiler.isExternalModuleReference(node))
        return node.expression !== undefined &&
            compiler.isStringLiteralLike(node.expression)
            ? node.expression.text
            : undefined;
    if (compiler.isImportTypeNode(node))
        return compiler.isLiteralTypeNode(node.argument) &&
            compiler.isStringLiteralLike(node.argument.literal)
            ? node.argument.literal.text
            : undefined;
    if (!compiler.isCallExpression(node))
        return undefined;
    if (node.expression.kind === compiler.SyntaxKind.ImportKeyword &&
        (node.arguments.length === 1 || node.arguments.length === 2) &&
        compiler.isStringLiteralLike(node.arguments[0]))
        return node.arguments[0].text;
    if (node.arguments.length !== 1 || requireIsShadowed)
        return undefined;
    if (!compiler.isStringLiteralLike(node.arguments[0]))
        return undefined;
    if (node.questionDotToken === undefined &&
        compiler.isIdentifier(node.expression) &&
        node.expression.text === "require")
        return node.arguments[0].text;
    return undefined;
}
function opensEcmaScriptScope(compiler, node) {
    return (compiler.isFunctionLike(node) ||
        compiler.isClassLike(node) ||
        compiler.isClassStaticBlockDeclaration(node) ||
        compiler.isBlock(node) ||
        compiler.isModuleBlock(node) ||
        compiler.isCatchClause(node) ||
        compiler.isForStatement(node) ||
        compiler.isForInStatement(node) ||
        compiler.isForOfStatement(node) ||
        compiler.isCaseBlock(node));
}
function bindingShadowsRequire(compiler, name) {
    const stack = [name];
    while (stack.length > 0) {
        const binding = stack.pop();
        if (compiler.isIdentifier(binding)) {
            if (binding.text === "require")
                return true;
            continue;
        }
        for (const element of binding.elements)
            if (!compiler.isOmittedExpression(element))
                stack.push(element.name);
    }
    return false;
}
function addRequireBinding(compiler, node, current, nested, ambient) {
    if (ambient)
        return;
    if (compiler.isVariableDeclaration(node)) {
        if (!bindingShadowsRequire(compiler, node.name))
            return;
        const declarationList = compiler.isVariableDeclarationList(node.parent)
            ? node.parent
            : undefined;
        const blockScoped = declarationList === undefined ||
            (declarationList.flags & compiler.NodeFlags.BlockScoped) !== 0;
        (blockScoped ? current : current.varScope).shadowsRequire = true;
        return;
    }
    if (compiler.isParameter(node)) {
        if (bindingShadowsRequire(compiler, node.name))
            current.shadowsRequire = true;
        return;
    }
    if (compiler.isFunctionDeclaration(node)) {
        if (node.name?.text === "require")
            current.shadowsRequire = true;
        return;
    }
    if (compiler.isFunctionExpression(node)) {
        if (node.name?.text === "require")
            nested.shadowsRequire = true;
        return;
    }
    if (compiler.isClassDeclaration(node)) {
        if (node.name?.text === "require") {
            current.shadowsRequire = true;
            nested.shadowsRequire = true;
        }
        return;
    }
    if (compiler.isClassExpression(node)) {
        if (node.name?.text === "require")
            nested.shadowsRequire = true;
        return;
    }
    if ((compiler.isEnumDeclaration(node) ||
        compiler.isImportEqualsDeclaration(node)) &&
        node.name?.text === "require" &&
        (!compiler.isImportEqualsDeclaration(node) || !node.isTypeOnly)) {
        current.shadowsRequire = true;
        return;
    }
    if (compiler.isModuleDeclaration(node) &&
        compiler.isIdentifier(node.name) &&
        node.name.text === "require") {
        current.shadowsRequire = true;
        return;
    }
    if ((compiler.isImportClause(node) ||
        compiler.isImportSpecifier(node) ||
        compiler.isNamespaceImport(node)) &&
        node.name?.text === "require" &&
        !isTypeOnlyImportBinding(compiler, node))
        current.shadowsRequire = true;
}
function isTypeOnlyImportBinding(compiler, node) {
    if (compiler.isImportClause(node))
        return node.isTypeOnly;
    if (compiler.isImportSpecifier(node))
        return node.isTypeOnly || node.parent.parent.isTypeOnly;
    return node.parent.isTypeOnly;
}
function startsAmbientContext(compiler, node) {
    return (compiler.canHaveModifiers(node) &&
        (compiler
            .getModifiers(node)
            ?.some((modifier) => modifier.kind === compiler.SyntaxKind.DeclareKeyword) ??
            false));
}
function writesRequireBinding(compiler, node) {
    if (compiler.isBinaryExpression(node) &&
        node.operatorToken.kind >= compiler.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= compiler.SyntaxKind.LastAssignment)
        return assignmentTargetContainsRequire(compiler, node.left);
    if ((compiler.isPrefixUnaryExpression(node) ||
        compiler.isPostfixUnaryExpression(node)) &&
        (node.operator === compiler.SyntaxKind.PlusPlusToken ||
            node.operator === compiler.SyntaxKind.MinusMinusToken))
        return (compiler.isIdentifier(node.operand) && node.operand.text === "require");
    if ((compiler.isForInStatement(node) || compiler.isForOfStatement(node)) &&
        !compiler.isVariableDeclarationList(node.initializer))
        return assignmentTargetContainsRequire(compiler, node.initializer);
    return false;
}
function assignmentTargetContainsRequire(compiler, target) {
    const stack = [target];
    while (stack.length > 0) {
        const current = stack.pop();
        if (compiler.isIdentifier(current)) {
            if (current.text === "require")
                return true;
            continue;
        }
        if (compiler.isParenthesizedExpression(current) ||
            compiler.isAsExpression(current) ||
            compiler.isTypeAssertionExpression(current) ||
            compiler.isNonNullExpression(current) ||
            compiler.isSatisfiesExpression(current) ||
            compiler.isSpreadElement(current) ||
            compiler.isSpreadAssignment(current)) {
            stack.push(current.expression);
            continue;
        }
        if (compiler.isArrayLiteralExpression(current)) {
            for (const element of current.elements)
                if (!compiler.isOmittedExpression(element))
                    stack.push(element);
            continue;
        }
        if (compiler.isObjectLiteralExpression(current)) {
            for (const property of current.properties) {
                if (compiler.isPropertyAssignment(property))
                    stack.push(property.initializer);
                else if (compiler.isShorthandPropertyAssignment(property))
                    stack.push(property.name);
                else if (compiler.isSpreadAssignment(property))
                    stack.push(property.expression);
            }
            continue;
        }
        if (compiler.isBinaryExpression(current) &&
            current.operatorToken.kind === compiler.SyntaxKind.EqualsToken)
            stack.push(current.left);
    }
    return false;
}
function containsDirectEval(compiler, node) {
    return (compiler.isCallExpression(node) &&
        node.questionDotToken === undefined &&
        compiler.isIdentifier(node.expression) &&
        node.expression.text === "eval");
}
function collectEcmaScriptScopes(compiler, sourceFile, sourcePath) {
    const root = {
        parent: undefined,
        varScope: undefined,
        shadowsRequire: false,
        effectiveRequireShadow: false,
        ambiguousRequireResolution: false,
        effectiveRequireAmbiguity: false,
    };
    root.varScope = root;
    const scopes = new Map([[sourceFile, root]]);
    const allScopes = [root];
    const stack = [
        { ambient: sourceFile.isDeclarationFile, node: sourceFile, scope: root },
    ];
    const assignmentScopes = [];
    let nodeCount = 0;
    while (stack.length > 0) {
        const { ambient: inheritedAmbient, node, scope: inherited } = stack.pop();
        nodeCount += 1;
        if (nodeCount > MAX_ECMASCRIPT_IMPORT_SCAN_TOKENS)
            throw new Error(`ECMAScript import scanのAST node件数上限を超えました: ${sourcePath}`);
        let current = inherited;
        if (node !== sourceFile && opensEcmaScriptScope(compiler, node)) {
            current = {
                parent: inherited,
                varScope: inherited.varScope,
                shadowsRequire: false,
                effectiveRequireShadow: false,
                ambiguousRequireResolution: false,
                effectiveRequireAmbiguity: false,
            };
            if (compiler.isFunctionLike(node) ||
                compiler.isModuleBlock(node) ||
                compiler.isClassStaticBlockDeclaration(node))
                current.varScope = current;
            scopes.set(node, current);
            allScopes.push(current);
        }
        const ambient = inheritedAmbient || startsAmbientContext(compiler, node);
        addRequireBinding(compiler, node, inherited, current, ambient);
        if (containsDirectEval(compiler, node))
            current.varScope.ambiguousRequireResolution = true;
        if (writesRequireBinding(compiler, node))
            assignmentScopes.push(current);
        if (compiler.isWithStatement(node)) {
            const dynamicScope = {
                parent: current,
                varScope: current.varScope,
                shadowsRequire: false,
                effectiveRequireShadow: false,
                ambiguousRequireResolution: true,
                effectiveRequireAmbiguity: false,
            };
            allScopes.push(dynamicScope);
            scopes.set(node.statement, dynamicScope);
            stack.push({ ambient, node: node.statement, scope: dynamicScope });
            stack.push({ ambient, node: node.expression, scope: current });
            continue;
        }
        const children = [];
        compiler.forEachChild(node, (child) => {
            children.push(child);
        });
        for (let index = children.length - 1; index >= 0; index -= 1)
            stack.push({ ambient, node: children[index], scope: current });
    }
    let resolutionSteps = 0;
    for (const assignmentScope of assignmentScopes) {
        let target = assignmentScope;
        while (target !== undefined && !target.shadowsRequire) {
            resolutionSteps += 1;
            if (resolutionSteps > MAX_ECMASCRIPT_IMPORT_SCAN_TOKENS)
                throw new Error(`ECMAScript require binding解決上限を超えました: ${sourcePath}`);
            target = target.parent;
        }
        (target ?? root).ambiguousRequireResolution = true;
    }
    for (const scope of allScopes) {
        scope.effectiveRequireShadow =
            scope.shadowsRequire || (scope.parent?.effectiveRequireShadow ?? false);
        scope.effectiveRequireAmbiguity =
            scope.ambiguousRequireResolution ||
                (scope.parent?.effectiveRequireAmbiguity ?? false);
    }
    return scopes;
}
function requireIsShadowed(scope) {
    return scope.effectiveRequireShadow || scope.effectiveRequireAmbiguity;
}
function ecmaScriptImportSpecifiers(source, sourcePath) {
    const compiler = loadTypeScriptCompiler();
    const sourceFile = parseEcmaScriptSource(compiler, source, sourcePath);
    const scopes = collectEcmaScriptScopes(compiler, sourceFile, sourcePath);
    const located = [];
    const stack = [{ node: sourceFile, scope: scopes.get(sourceFile) }];
    let nodeCount = 0;
    while (stack.length > 0) {
        const { node, scope: inherited } = stack.pop();
        nodeCount += 1;
        if (nodeCount > MAX_ECMASCRIPT_IMPORT_SCAN_TOKENS)
            throw new Error(`ECMAScript import scanのAST node件数上限を超えました: ${sourcePath}`);
        const current = scopes.get(node) ?? inherited;
        const value = literalImportSpecifier(compiler, node, requireIsShadowed(current));
        if (value !== undefined)
            located.push({ position: node.pos, value });
        const children = [];
        compiler.forEachChild(node, (child) => {
            children.push(child);
        });
        for (let index = children.length - 1; index >= 0; index -= 1)
            stack.push({ node: children[index], scope: current });
    }
    return located
        .sort((left, right) => left.position - right.position || left.value.localeCompare(right.value))
        .map(({ value }) => value);
}
/**
 * The schema vocabulary is intentionally broader than this projector. This
 * capability is the exact, machine-observable subset materialized from local
 * repository files by this builder version.
 */
export const REPOSITORY_GRAPH_PROJECTOR_CAPABILITY = Object.freeze({
    capabilityVersion: "agent-skill-chain/repository-graph-projector-capability/v1",
    materializedNodeKinds: Object.freeze([
        "repository",
        "commit",
        "requirement",
        "acceptance-criteria",
        "design",
        "file",
        "scenario",
        "review",
        "worktree",
    ]),
    materializedEdgeKinds: Object.freeze([
        "contains",
        "imports",
        "references",
        "has-acceptance-criteria",
        "verified-by",
        "satisfied-by",
        "supported-by",
    ]),
});
/** Graph evidence is descriptive and never grants workflow authority. */
export const REPOSITORY_GRAPH_EVIDENCE_AUTHORITY = Object.freeze({
    authority: "none",
    mergeAuthorization: false,
    modeAuthorization: false,
});
const MATERIALIZED_NODE_KINDS = new Set(REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedNodeKinds);
const MATERIALIZED_EDGE_KINDS = new Set(REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedEdgeKinds);
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function safeRepositoryPath(candidate) {
    return (candidate.length > 0 &&
        candidate === candidate.normalize("NFC") &&
        candidate === path.posix.normalize(candidate) &&
        !path.posix.isAbsolute(candidate) &&
        candidate !== ".." &&
        !candidate.startsWith("../") &&
        !candidate.includes("\\") &&
        !/[\p{Cc}\p{Cf}]/u.test(candidate));
}
function isTraceEndpointCandidate(candidate) {
    if (/[*?[\]{}]/u.test(candidate))
        return false;
    if (candidate.endsWith("/"))
        return false;
    if (candidate.includes("/"))
        return true;
    return (SOURCE_BASENAMES.has(candidate) ||
        SOURCE_EXTENSIONS.has(path.posix.extname(candidate).toLowerCase()));
}
function sourcePaths(root) {
    const listed = git(["ls-files", "-co", "--exclude-standard", "-z", "--"], root).stdout.split("\0");
    const result = [...new Set(listed)]
        .filter(Boolean)
        .filter(safeRepositoryPath)
        .filter((entry) => SOURCE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase()) ||
        SOURCE_BASENAMES.has(path.posix.basename(entry)))
        .sort(compareText);
    if (result.length > MAX_SOURCE_FILES)
        throw new Error("graph source file件数上限を超えました");
    return result;
}
function observeSourceFile(root, relative) {
    const absolute = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(absolute))
        return {
            path: relative,
            state: "missing",
            sha256: sha256("missing"),
            size: 0,
        };
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        return {
            path: relative,
            state: "symlink",
            sha256: sha256(target),
            size: Buffer.byteLength(target),
        };
    }
    if (!stat.isFile())
        throw new Error(`graph sourceは通常fileでなければなりません: ${relative}`);
    if (stat.size > MAX_SOURCE_FILE_BYTES)
        throw new Error(`graph source file上限を超えました: ${relative}`);
    const contents = fs.readFileSync(absolute);
    return {
        path: relative,
        state: "file",
        sha256: sha256(contents),
        size: contents.length,
        ...(contents.includes(0) ? {} : { text: contents.toString("utf8") }),
    };
}
function observeSourceFiles(root) {
    const files = [];
    let totalBytes = 0;
    for (const relative of sourcePaths(root)) {
        const absolute = path.join(root, ...relative.split("/"));
        if (fs.existsSync(absolute)) {
            const stat = fs.lstatSync(absolute);
            const nextSize = stat.isSymbolicLink()
                ? Buffer.byteLength(fs.readlinkSync(absolute))
                : stat.isFile()
                    ? stat.size
                    : 0;
            if (nextSize > MAX_SOURCE_FILE_BYTES)
                throw new Error(`graph source file上限を超えました: ${relative}`);
            if (totalBytes + nextSize > MAX_SOURCE_SET_BYTES)
                throw new Error("graph source集合のbyte上限を超えました");
        }
        const observed = observeSourceFile(root, relative);
        totalBytes += observed.size;
        if (totalBytes > MAX_SOURCE_SET_BYTES)
            throw new Error("graph source集合のbyte上限を超えました");
        files.push(observed);
    }
    return files;
}
function repositoryIdentifier(remote, top) {
    if (remote === "")
        return `local:${sha256(top).slice(0, 32)}`;
    let canonical = remote.normalize("NFC");
    try {
        const parsed = new URL(canonical);
        parsed.username = "";
        parsed.password = "";
        canonical = parsed.toString();
    }
    catch {
        canonical = canonical.replace(/^[^/@\s]+@/u, "");
    }
    return `remote:${sha256(canonical)}`;
}
function repositoryIdentity(root, files) {
    const top = fs.realpathSync(git(["rev-parse", "--show-toplevel"], root).stdout.trim());
    if (top !== fs.realpathSync(root))
        throw new Error("semantic graphはrepository rootから構築してください");
    const gitDirectory = fs.realpathSync(git(["rev-parse", "--absolute-git-dir"], root).stdout.trim());
    const remote = git(["config", "--get", "remote.origin.url"], root, {
        allowFailure: true,
    }).stdout.trim();
    const repositoryId = repositoryIdentifier(remote, top);
    const dirty = git(["status", "--porcelain=v1", "--untracked-files=all", "--"], root).stdout.trim().length > 0;
    return {
        repositoryId,
        worktreeId: sha256(stableJson({ gitDirectory, top })),
        headSha: git(["rev-parse", "HEAD"], root).stdout.trim(),
        treeSha: git(["rev-parse", "HEAD^{tree}"], root).stdout.trim(),
        contentDigest: sha256(stableJson(files.map(({ path: file, sha256: digest, size, state }) => ({
            path: file,
            sha256: digest,
            size,
            state,
        })))),
        dirty,
    };
}
export function observeRepositoryGraphSource(root) {
    const resolvedRoot = fs.realpathSync(root);
    const files = observeSourceFiles(resolvedRoot);
    return repositoryIdentity(resolvedRoot, files);
}
function nodeId(kind, value) {
    return `${kind}:${value}`;
}
function lineOccurrences(text, pattern) {
    const occurrences = new Map();
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern))
            if (match[0] !== undefined && !occurrences.has(match[0]))
                occurrences.set(match[0], index + 1);
    }
    return occurrences;
}
function preferredOccurrence(occurrences) {
    const priority = (file) => file.startsWith("docs/specs/02_要件/")
        ? 0
        : file.startsWith("docs/specs/")
            ? 1
            : file.startsWith(".agent-skill-chain/docs/")
                ? 2
                : file.startsWith("test/features/")
                    ? 3
                    : 4;
    return [...occurrences].sort((left, right) => priority(left.file) - priority(right.file) ||
        compareText(left.file, right.file) ||
        left.line - right.line)[0];
}
function resolveImport(from, specifier, knownFiles) {
    if (!specifier.startsWith("."))
        return undefined;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (!safeRepositoryPath(base))
        return undefined;
    const extensions = [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
    ];
    const candidates = [base];
    for (const extension of extensions)
        candidates.push(`${base}${extension}`);
    for (const extension of extensions)
        candidates.push(`${base}/index${extension}`);
    const explicitExtension = path.posix.extname(base).toLowerCase();
    if (ECMASCRIPT_EXTENSIONS.has(explicitExtension)) {
        const withoutExtension = base.slice(0, -explicitExtension.length);
        for (const extension of extensions)
            candidates.push(`${withoutExtension}${extension}`);
    }
    return candidates.find((candidate) => knownFiles.has(candidate));
}
function projectionDiagnostic(code, sourcePath, sourceLine, detail) {
    return new Error(`semantic graph projection診断 ${code}: ${sourcePath}:${sourceLine}: ${detail}`);
}
export function buildRepositorySemanticGraph(root) {
    const resolvedRoot = fs.realpathSync(root);
    const files = observeSourceFiles(resolvedRoot);
    const source = repositoryIdentity(resolvedRoot, files);
    const knownFiles = new Set(files.map(({ path: file }) => file));
    const existingRegularFiles = new Set(files.filter(({ state }) => state === "file").map(({ path: file }) => file));
    const nodes = new Map();
    const edges = new Map();
    const occurrences = new Map([
        ["requirement", new Map()],
        ["acceptance-criteria", new Map()],
        ["scenario", new Map()],
    ]);
    const addNode = (id, kind, sourcePath, sourceLine, properties) => {
        if (!MATERIALIZED_NODE_KINDS.has(kind))
            throw new Error(`repository projector capability外のnode kindです: ${kind}`);
        if (nodes.has(id))
            return;
        if (nodes.size >= MAX_SEMANTIC_GRAPH_NODES)
            throw new Error("semantic graphのnode上限を超えました");
        nodes.set(id, {
            id,
            kind,
            certainty: "deterministic",
            sourcePath,
            ...(sourceLine === undefined ? {} : { sourceLine }),
            properties,
        });
    };
    const addEdge = (from, to, kind, sourcePath, sourceLine, properties = {}) => {
        if (!MATERIALIZED_EDGE_KINDS.has(kind))
            throw new Error(`repository projector capability外のedge kindです: ${kind}`);
        if (!nodes.has(from) || !nodes.has(to))
            throw projectionDiagnostic("edge-endpoint-missing", sourcePath, sourceLine ?? 1, `kind=${kind} from=${from}(${nodes.has(from) ? "present" : "missing"}) to=${to}(${nodes.has(to) ? "present" : "missing"})`);
        const id = `edge:${sha256(stableJson({ from, kind, sourceLine, sourcePath, to })).slice(0, 40)}`;
        if (!edges.has(id) && edges.size >= MAX_SEMANTIC_GRAPH_EDGES)
            throw new Error("semantic graphのedge上限を超えました");
        edges.set(id, {
            id,
            from,
            to,
            kind,
            certainty: "deterministic",
            sourcePath,
            ...(sourceLine === undefined ? {} : { sourceLine }),
            properties,
        });
    };
    // Source identity belongs to snapshot.source/manifest. Content nodes use
    // logical identities so an identical projection hashes identically in a
    // different worktree while freshness can still reject the wrong worktree.
    const repositoryNode = nodeId("repository", "current");
    const worktreeNode = nodeId("worktree", "current");
    const commitNode = nodeId("commit", "current");
    addNode(repositoryNode, "repository", "package.json", undefined, {
        identityAuthority: "manifest",
    });
    addNode(worktreeNode, "worktree", "package.json", undefined, {
        identityAuthority: "manifest",
    });
    addNode(commitNode, "commit", "package.json", undefined, {
        identityAuthority: "manifest",
    });
    for (const file of files) {
        const fileNode = nodeId("file", file.path);
        addNode(fileNode, "file", file.path, undefined, {
            sha256: file.sha256,
            size: file.size,
            state: file.state,
        });
        addEdge(repositoryNode, fileNode, "contains", file.path, undefined);
        if (file.path.startsWith("docs/reviews/")) {
            const reviewNode = nodeId("review", file.path);
            addNode(reviewNode, "review", file.path, undefined, { path: file.path });
            addEdge(fileNode, reviewNode, "references", file.path, undefined);
        }
        if (file.path.startsWith("docs/specs/03_アーキテクチャ/")) {
            const designNode = nodeId("design", file.path);
            addNode(designNode, "design", file.path, undefined, { path: file.path });
            addEdge(fileNode, designNode, "references", file.path, undefined);
        }
        if (file.text === undefined)
            continue;
        const groups = [
            ["requirement", REQUIREMENT_ID],
            ["acceptance-criteria", ACCEPTANCE_ID],
            ["scenario", SCENARIO_ID],
        ];
        for (const [kind, pattern] of groups)
            for (const [id, line] of lineOccurrences(file.text, pattern)) {
                const byId = occurrences.get(kind);
                const values = byId.get(id) ?? [];
                values.push({ file: file.path, line });
                byId.set(id, values);
            }
    }
    addEdge(repositoryNode, worktreeNode, "contains", "package.json", undefined);
    addEdge(repositoryNode, commitNode, "contains", "package.json", undefined);
    for (const [kind, byId] of occurrences)
        for (const [id, values] of byId) {
            const occurrence = preferredOccurrence(values);
            addNode(nodeId(kind, id), kind, occurrence.file, occurrence.line, {
                externalId: id,
            });
        }
    for (const file of files) {
        if (file.text === undefined)
            continue;
        const fileNode = nodeId("file", file.path);
        const groups = [
            ["requirement", REQUIREMENT_ID],
            ["acceptance-criteria", ACCEPTANCE_ID],
            ["scenario", SCENARIO_ID],
        ];
        for (const [kind, pattern] of groups)
            for (const [id, line] of lineOccurrences(file.text, pattern))
                addEdge(nodeId(kind, id), fileNode, "supported-by", file.path, line);
        if (ECMASCRIPT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())) {
            for (const specifier of ecmaScriptImportSpecifiers(file.text, file.path)) {
                const target = resolveImport(file.path, specifier, knownFiles);
                if (target !== undefined)
                    addEdge(fileNode, nodeId("file", target), "imports", file.path, undefined, {
                        specifier,
                    });
            }
        }
    }
    for (const requirementId of occurrences.get("requirement").keys()) {
        const acceptanceId = requirementId.replace(/^REQ-/u, "AC-");
        if (occurrences.get("acceptance-criteria").has(acceptanceId)) {
            const occurrence = preferredOccurrence(occurrences.get("requirement").get(requirementId));
            addEdge(nodeId("requirement", requirementId), nodeId("acceptance-criteria", acceptanceId), "has-acceptance-criteria", occurrence.file, occurrence.line);
        }
    }
    const trace = files.find(({ path: file }) => file === "docs/specs/15_要件追跡/00_追跡表.md");
    if (trace?.text !== undefined)
        for (const [index, line] of trace.text.split(/\r?\n/u).entries()) {
            if (!line.trimStart().startsWith("|"))
                continue;
            const cells = line.split("|").map((cell) => cell.trim());
            if (cells.length < 7)
                continue;
            const requirements = [...cells[1].matchAll(REQUIREMENT_ID)].map(([id]) => id);
            const acceptance = [...cells[2].matchAll(ACCEPTANCE_ID)].map(([id]) => id);
            const scenarios = [...cells[3].matchAll(SCENARIO_ID)].map(([id]) => id);
            if (requirements.length > MAX_TRACE_IDS_PER_CELL ||
                acceptance.length > MAX_TRACE_IDS_PER_CELL ||
                scenarios.length > MAX_TRACE_IDS_PER_CELL)
                throw new Error(`trace rowのID件数上限を超えました: ${index + 1}`);
            const featureCell = cells.length >= 9 ? cells[5] : cells[4];
            const implementationCell = cells.length >= 9 ? cells[6] : cells[5];
            const referencedPaths = [
                ...`${featureCell} ${implementationCell}`.matchAll(/`([^`]+)`/gu),
            ]
                .map((match) => match[1])
                .filter(isTraceEndpointCandidate);
            const missingPaths = referencedPaths.filter((candidate) => !existingRegularFiles.has(candidate));
            if (missingPaths.length > 0)
                throw projectionDiagnostic("trace-endpoint-missing", trace.path, index + 1, `存在しないrepository path=${[...new Set(missingPaths)].sort(compareText).join(",")}`);
            const featurePaths = referencedPaths.filter((candidate) => candidate.endsWith(".feature"));
            const implementationPaths = referencedPaths.filter((candidate) => !candidate.endsWith(".feature") &&
                (candidate.startsWith("src/") ||
                    candidate.startsWith("bin/") ||
                    candidate.startsWith("scripts/")));
            for (const requirement of requirements) {
                const expectedCriterion = requirement.replace(/^REQ-/u, "AC-");
                for (const criterion of acceptance.filter((candidate) => candidate === expectedCriterion))
                    addEdge(nodeId("requirement", requirement), nodeId("acceptance-criteria", criterion), "has-acceptance-criteria", trace.path, index + 1);
            }
            if (acceptance.length === 1)
                for (const criterion of acceptance)
                    for (const scenario of scenarios)
                        addEdge(nodeId("acceptance-criteria", criterion), nodeId("scenario", scenario), "verified-by", trace.path, index + 1);
            for (const scenario of scenarios) {
                for (const feature of featurePaths)
                    addEdge(nodeId("scenario", scenario), nodeId("file", feature), "verified-by", trace.path, index + 1);
                for (const implementation of implementationPaths)
                    addEdge(nodeId("scenario", scenario), nodeId("file", implementation), "satisfied-by", trace.path, index + 1);
            }
        }
    const snapshot = canonicalSemanticGraph({
        schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
        builderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
        source,
        nodes: [...nodes.values()],
        edges: [...edges.values()],
    });
    const errors = validateSemanticGraphSnapshot(snapshot);
    if (errors.length > 0)
        throw new Error(`semantic graph projectionを構築できません: ${errors.join("; ")}`);
    const afterFiles = observeSourceFiles(resolvedRoot);
    const afterSource = repositoryIdentity(resolvedRoot, afterFiles);
    if (stableJson(afterSource) !== stableJson(source))
        throw new Error("semantic graph構築中にsourceが変化しました。再実行してください");
    return snapshot;
}
//# sourceMappingURL=repository-graph.js.map