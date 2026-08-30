import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  MAX_SEMANTIC_GRAPH_EDGES,
  MAX_SEMANTIC_GRAPH_NODES,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  canonicalSemanticGraph,
  validateSemanticGraphSnapshot,
  type GraphScalar,
  type GraphSourceIdentity,
  type SemanticEdgeKind,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSnapshot,
  type SemanticNodeKind,
} from "../domain/semantic-graph.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";

const MAX_SOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_SET_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_FILES = 200_000;
const MAX_TRACE_IDS_PER_CELL = 1_000;
const SOURCE_EXTENSIONS = new Set([
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
const IMPORT_SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']|\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/gu;
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

/**
 * The schema vocabulary is intentionally broader than this projector. This
 * capability is the exact, machine-observable subset materialized from local
 * repository files by this builder version.
 */
export const REPOSITORY_GRAPH_PROJECTOR_CAPABILITY = Object.freeze({
  capabilityVersion:
    "agent-skill-chain/repository-graph-projector-capability/v1" as const,
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
  ] satisfies readonly SemanticNodeKind[]),
  materializedEdgeKinds: Object.freeze([
    "contains",
    "imports",
    "references",
    "has-acceptance-criteria",
    "verified-by",
    "satisfied-by",
    "supported-by",
  ] satisfies readonly SemanticEdgeKind[]),
});

/** Graph evidence is descriptive and never grants workflow authority. */
export const REPOSITORY_GRAPH_EVIDENCE_AUTHORITY = Object.freeze({
  authority: "none" as const,
  mergeAuthorization: false as const,
  modeAuthorization: false as const,
});

const MATERIALIZED_NODE_KINDS = new Set<SemanticNodeKind>(
  REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedNodeKinds,
);
const MATERIALIZED_EDGE_KINDS = new Set<SemanticEdgeKind>(
  REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedEdgeKinds,
);

interface SourceFile {
  readonly path: string;
  readonly state: "file" | "symlink" | "missing";
  readonly sha256: string;
  readonly size: number;
  readonly text?: string;
}

interface Occurrence {
  readonly file: string;
  readonly line: number;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRepositoryPath(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    candidate === candidate.normalize("NFC") &&
    candidate === path.posix.normalize(candidate) &&
    !path.posix.isAbsolute(candidate) &&
    candidate !== ".." &&
    !candidate.startsWith("../") &&
    !candidate.includes("\\") &&
    !/[\p{Cc}\p{Cf}]/u.test(candidate)
  );
}

function sourcePaths(root: string): string[] {
  const listed = git(
    ["ls-files", "-co", "--exclude-standard", "-z", "--"],
    root,
  ).stdout.split("\0");
  const result = [...new Set(listed)]
    .filter(Boolean)
    .filter(safeRepositoryPath)
    .filter(
      (entry) =>
        SOURCE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase()) ||
        SOURCE_BASENAMES.has(path.posix.basename(entry)),
    )
    .sort(compareText);
  if (result.length > MAX_SOURCE_FILES)
    throw new Error("graph source file件数上限を超えました");
  return result;
}

function observeSourceFile(root: string, relative: string): SourceFile {
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

function observeSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
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

function repositoryIdentifier(remote: string, top: string): string {
  if (remote === "") return `local:${sha256(top).slice(0, 32)}`;
  let canonical = remote.normalize("NFC");
  try {
    const parsed = new URL(canonical);
    parsed.username = "";
    parsed.password = "";
    canonical = parsed.toString();
  } catch {
    canonical = canonical.replace(/^[^/@\s]+@/u, "");
  }
  return `remote:${sha256(canonical)}`;
}

function repositoryIdentity(
  root: string,
  files: readonly SourceFile[],
): GraphSourceIdentity {
  const top = fs.realpathSync(
    git(["rev-parse", "--show-toplevel"], root).stdout.trim(),
  );
  if (top !== fs.realpathSync(root))
    throw new Error("semantic graphはrepository rootから構築してください");
  const gitDirectory = fs.realpathSync(
    git(["rev-parse", "--absolute-git-dir"], root).stdout.trim(),
  );
  const remote = git(["config", "--get", "remote.origin.url"], root, {
    allowFailure: true,
  }).stdout.trim();
  const repositoryId = repositoryIdentifier(remote, top);
  const dirty =
    git(
      ["status", "--porcelain=v1", "--untracked-files=all", "--"],
      root,
    ).stdout.trim().length > 0;
  return {
    repositoryId,
    worktreeId: sha256(stableJson({ gitDirectory, top })),
    headSha: git(["rev-parse", "HEAD"], root).stdout.trim(),
    treeSha: git(["rev-parse", "HEAD^{tree}"], root).stdout.trim(),
    contentDigest: sha256(
      stableJson(
        files.map(({ path: file, sha256: digest, size, state }) => ({
          path: file,
          sha256: digest,
          size,
          state,
        })),
      ),
    ),
    dirty,
  };
}

export function observeRepositoryGraphSource(
  root: string,
): GraphSourceIdentity {
  const resolvedRoot = fs.realpathSync(root);
  const files = observeSourceFiles(resolvedRoot);
  return repositoryIdentity(resolvedRoot, files);
}

function nodeId(kind: SemanticNodeKind, value: string): string {
  return `${kind}:${value}`;
}

function lineOccurrences(text: string, pattern: RegExp): Map<string, number> {
  const occurrences = new Map<string, number>();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern))
      if (match[0] !== undefined && !occurrences.has(match[0]))
        occurrences.set(match[0], index + 1);
  }
  return occurrences;
}

function preferredOccurrence(occurrences: readonly Occurrence[]): Occurrence {
  const priority = (file: string): number =>
    file.startsWith("docs/specs/02_要件/")
      ? 0
      : file.startsWith("docs/specs/")
        ? 1
        : file.startsWith(".agent-skill-chain/docs/")
          ? 2
          : file.startsWith("test/features/")
            ? 3
            : 4;
  return [...occurrences].sort(
    (left, right) =>
      priority(left.file) - priority(right.file) ||
      compareText(left.file, right.file) ||
      left.line - right.line,
  )[0]!;
}

function resolveImport(
  from: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  if (!safeRepositoryPath(base)) return undefined;
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
  for (const extension of extensions) candidates.push(`${base}${extension}`);
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

function projectionDiagnostic(
  code: "edge-endpoint-missing" | "trace-endpoint-missing",
  sourcePath: string,
  sourceLine: number,
  detail: string,
): Error {
  return new Error(
    `semantic graph projection診断 ${code}: ${sourcePath}:${sourceLine}: ${detail}`,
  );
}

export function buildRepositorySemanticGraph(
  root: string,
): SemanticGraphSnapshot {
  const resolvedRoot = fs.realpathSync(root);
  const files = observeSourceFiles(resolvedRoot);
  const source = repositoryIdentity(resolvedRoot, files);
  const knownFiles = new Set(files.map(({ path: file }) => file));
  const existingRegularFiles = new Set(
    files.filter(({ state }) => state === "file").map(({ path: file }) => file),
  );
  const nodes = new Map<string, SemanticGraphNode>();
  const edges = new Map<string, SemanticGraphEdge>();
  const occurrences = new Map<
    "requirement" | "acceptance-criteria" | "scenario",
    Map<string, Occurrence[]>
  >([
    ["requirement", new Map()],
    ["acceptance-criteria", new Map()],
    ["scenario", new Map()],
  ]);
  const addNode = (
    id: string,
    kind: SemanticNodeKind,
    sourcePath: string,
    sourceLine: number | undefined,
    properties: Readonly<Record<string, GraphScalar>>,
  ): void => {
    if (!MATERIALIZED_NODE_KINDS.has(kind))
      throw new Error(
        `repository projector capability外のnode kindです: ${kind}`,
      );
    if (nodes.has(id)) return;
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
  const addEdge = (
    from: string,
    to: string,
    kind: SemanticEdgeKind,
    sourcePath: string,
    sourceLine: number | undefined,
    properties: Readonly<Record<string, GraphScalar>> = {},
  ): void => {
    if (!MATERIALIZED_EDGE_KINDS.has(kind))
      throw new Error(
        `repository projector capability外のedge kindです: ${kind}`,
      );
    if (!nodes.has(from) || !nodes.has(to))
      throw projectionDiagnostic(
        "edge-endpoint-missing",
        sourcePath,
        sourceLine ?? 1,
        `kind=${kind} from=${from}(${nodes.has(from) ? "present" : "missing"}) to=${to}(${nodes.has(to) ? "present" : "missing"})`,
      );
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
    if (file.text === undefined) continue;
    const groups = [
      ["requirement", REQUIREMENT_ID],
      ["acceptance-criteria", ACCEPTANCE_ID],
      ["scenario", SCENARIO_ID],
    ] as const;
    for (const [kind, pattern] of groups)
      for (const [id, line] of lineOccurrences(file.text, pattern)) {
        const byId = occurrences.get(kind)!;
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
    if (file.text === undefined) continue;
    const fileNode = nodeId("file", file.path);
    const groups = [
      ["requirement", REQUIREMENT_ID],
      ["acceptance-criteria", ACCEPTANCE_ID],
      ["scenario", SCENARIO_ID],
    ] as const;
    for (const [kind, pattern] of groups)
      for (const [id, line] of lineOccurrences(file.text, pattern))
        addEdge(nodeId(kind, id), fileNode, "supported-by", file.path, line);
    if (
      ECMASCRIPT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())
    ) {
      IMPORT_SPECIFIER.lastIndex = 0;
      for (const match of file.text.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1] ?? match[2];
        if (specifier === undefined) continue;
        const target = resolveImport(file.path, specifier, knownFiles);
        if (target !== undefined)
          addEdge(
            fileNode,
            nodeId("file", target),
            "imports",
            file.path,
            undefined,
            {
              specifier,
            },
          );
      }
    }
  }

  for (const requirementId of occurrences.get("requirement")!.keys()) {
    const acceptanceId = requirementId.replace(/^REQ-/u, "AC-");
    if (occurrences.get("acceptance-criteria")!.has(acceptanceId)) {
      const occurrence = preferredOccurrence(
        occurrences.get("requirement")!.get(requirementId)!,
      );
      addEdge(
        nodeId("requirement", requirementId),
        nodeId("acceptance-criteria", acceptanceId),
        "has-acceptance-criteria",
        occurrence.file,
        occurrence.line,
      );
    }
  }

  const trace = files.find(
    ({ path: file }) => file === "docs/specs/15_要件追跡/00_追跡表.md",
  );
  if (trace?.text !== undefined)
    for (const [index, line] of trace.text.split(/\r?\n/u).entries()) {
      if (!line.trimStart().startsWith("|")) continue;
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length < 7) continue;
      const requirements = [...cells[1]!.matchAll(REQUIREMENT_ID)].map(
        ([id]) => id,
      );
      const acceptance = [...cells[2]!.matchAll(ACCEPTANCE_ID)].map(
        ([id]) => id,
      );
      const scenarios = [...cells[3]!.matchAll(SCENARIO_ID)].map(([id]) => id);
      if (
        requirements.length > MAX_TRACE_IDS_PER_CELL ||
        acceptance.length > MAX_TRACE_IDS_PER_CELL ||
        scenarios.length > MAX_TRACE_IDS_PER_CELL
      )
        throw new Error(`trace rowのID件数上限を超えました: ${index + 1}`);
      const featureCell = cells.length >= 9 ? cells[5] : cells[4];
      const implementationCell = cells.length >= 9 ? cells[6] : cells[5];
      const referencedPaths = [
        ...`${featureCell} ${implementationCell}`.matchAll(/`([^`]+)`/gu),
      ].map((match) => match[1]!);
      const missingPaths = referencedPaths.filter(
        (candidate) => !existingRegularFiles.has(candidate),
      );
      if (missingPaths.length > 0)
        throw projectionDiagnostic(
          "trace-endpoint-missing",
          trace.path,
          index + 1,
          `存在しないrepository path=${[...new Set(missingPaths)].sort(compareText).join(",")}`,
        );
      const featurePaths = referencedPaths.filter((candidate) =>
        candidate.endsWith(".feature"),
      );
      const implementationPaths = referencedPaths.filter(
        (candidate) =>
          !candidate.endsWith(".feature") &&
          (candidate.startsWith("src/") ||
            candidate.startsWith("bin/") ||
            candidate.startsWith("scripts/")),
      );
      for (const requirement of requirements) {
        const expectedCriterion = requirement.replace(/^REQ-/u, "AC-");
        for (const criterion of acceptance.filter(
          (candidate) => candidate === expectedCriterion,
        ))
          addEdge(
            nodeId("requirement", requirement),
            nodeId("acceptance-criteria", criterion),
            "has-acceptance-criteria",
            trace.path,
            index + 1,
          );
      }
      if (acceptance.length === 1)
        for (const criterion of acceptance)
          for (const scenario of scenarios)
            addEdge(
              nodeId("acceptance-criteria", criterion),
              nodeId("scenario", scenario),
              "verified-by",
              trace.path,
              index + 1,
            );
      for (const scenario of scenarios) {
        for (const feature of featurePaths)
          addEdge(
            nodeId("scenario", scenario),
            nodeId("file", feature),
            "verified-by",
            trace.path,
            index + 1,
          );
        for (const implementation of implementationPaths)
          addEdge(
            nodeId("scenario", scenario),
            nodeId("file", implementation),
            "satisfied-by",
            trace.path,
            index + 1,
          );
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
    throw new Error(
      `semantic graph projectionを構築できません: ${errors.join("; ")}`,
    );
  const afterFiles = observeSourceFiles(resolvedRoot);
  const afterSource = repositoryIdentity(resolvedRoot, afterFiles);
  if (stableJson(afterSource) !== stableJson(source))
    throw new Error(
      "semantic graph構築中にsourceが変化しました。再実行してください",
    );
  return snapshot;
}
