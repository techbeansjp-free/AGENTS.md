import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  GraphFreshnessError,
  MAX_SEMANTIC_GRAPH_EDGES,
  MAX_SEMANTIC_GRAPH_NODES,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  assessGraphFreshness,
  canonicalSemanticGraph,
  semanticGraphCardinalityErrors,
  semanticGraphContentHash,
  validateSemanticGraphSnapshot,
  type GraphDriftReason,
  type GraphProjectionManifest,
  type GraphScalar,
  type GraphSourceObserver,
  type GraphStorePort,
  type GraphStoreReadResult,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSnapshot,
} from "../domain/semantic-graph.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import {
  parseJsonStrict,
  resolveContained,
  stableJson,
  type JsonValue,
} from "../lib/security.js";
import { isRecord } from "../types.js";

export const GRAPHQLITE_VERSION = "0.6.1" as const;
export const GRAPHQLITE_COMMIT =
  "a1c65adcc1cc261f9bf9fd0a059f2cfb4b955d13" as const;
const GRAPHQLITE_ENTRYPOINT = "sqlite3_graphqlite_init";
const GRAPH_RUNTIME_DIRECTORY = ".agent-skill-chain/runtime/graph/v1";
const CURRENT_POINTER = `${GRAPH_RUNTIME_DIRECTORY}/current.json`;
const REBUILD_LOCK = `${GRAPH_RUNTIME_DIRECTORY}/rebuild.lock`;
const MAX_GRAPH_DATABASE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_GRAPH_QUERY_RESULT_BYTES = 512 * 1024 * 1024;
const MAX_CURRENT_POINTER_BYTES = 1024 * 1024;
const GENERATION_DATABASE_PATTERN =
  /^generation-([1-9]\d*)-[a-f0-9]{16}-[a-f0-9]{16}\.db$/u;

export interface GraphQlLiteAsset {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

const ASSETS = Object.freeze([
  {
    platform: "linux",
    arch: "x64",
    name: "graphqlite-linux-x86_64.so",
    sha256: "50c795208c7aa1e6650b50b4a89cdd00de4025d56369c7e6e3189f2b2c078a7e",
    size: 820_712,
  },
  {
    platform: "linux",
    arch: "arm64",
    name: "graphqlite-linux-aarch64.so",
    sha256: "4b4d1effdf15aab9286b88231919a0dd2e2f39ba69cf56b4adf91c7d5f0518e1",
    size: 845_592,
  },
  {
    platform: "darwin",
    arch: "arm64",
    name: "graphqlite-macos-arm64.dylib",
    sha256: "2157250ddc0784830d5e7aef62dc354a350a93fe191b2a1acb555f7c9181fdbc",
    size: 627_248,
  },
  {
    platform: "darwin",
    arch: "x64",
    name: "graphqlite-macos-x86_64.dylib",
    sha256: "ca7b44adc2debe1a919cd0cb5e6c75e9c162b60f7f5045fa83e1e9953af88541",
    size: 659_136,
  },
  {
    platform: "win32",
    arch: "x64",
    name: "graphqlite-windows-x86_64.dll",
    sha256: "418bc867cb936e8b24c3c0c812bd89cbba216c566a82e8dc56f0461e9c407cbb",
    size: 2_657_513,
  },
] as const).map((asset): GraphQlLiteAsset => ({
  ...asset,
  url: `https://github.com/colliery-io/graphqlite/releases/download/v${GRAPHQLITE_VERSION}/${asset.name}`,
}));

interface CurrentPointer {
  readonly schemaVersion: "agent-skill-chain/graphqlite-current/v1";
  readonly databaseFile: string;
  readonly manifest: GraphProjectionManifest;
}

const CREATE_NODE =
  "CREATE (n:ASCNode {id: $id, kind: $kind, certainty: $certainty, confidence: $confidence, sourcePath: $sourcePath, sourceLine: $sourceLine, propertiesJson: $propertiesJson}) RETURN n";
const CREATE_EDGE =
  "MATCH (a:ASCNode {id: $from}), (b:ASCNode {id: $to}) CREATE (a)-[r:ASC_EDGE {id: $id, kind: $kind, certainty: $certainty, confidence: $confidence, weight: $weight, sourcePath: $sourcePath, sourceLine: $sourceLine, propertiesJson: $propertiesJson}]->(b) RETURN r";
const READ_NODES = "MATCH (n:ASCNode) RETURN n ORDER BY n.id";
const READ_EDGES =
  "MATCH (a:ASCNode)-[r:ASC_EDGE]->(b:ASCNode) RETURN a, b, r ORDER BY r.id";
const COUNT_NODES = "MATCH (n:ASCNode) RETURN count(n) AS count";
const COUNT_EDGES =
  "MATCH (a:ASCNode)-[r:ASC_EDGE]->(b:ASCNode) RETURN count(r) AS count";

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function canonicalUtcInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  return canonical === value || canonical === value.replace(/Z$/u, ".000Z");
}

function boundedIdentity(value: unknown, maximum = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.normalize("NFC") &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function sha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function gitObjectId(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)
  );
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function supportedNodeRuntime(): boolean {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  return major > 22 || (major === 22 && minor >= 13);
}

function canonicalGitWorktreeRoot(root: string): string {
  const resolvedRoot = fs.realpathSync(root);
  const topLevel = fs.realpathSync(
    git(["rev-parse", "--show-toplevel"], resolvedRoot).stdout.trim(),
  );
  if (topLevel !== resolvedRoot)
    throw new Error(
      "GraphQLite runtimeはcanonical Git worktree top-levelからのみ操作できます",
    );
  return resolvedRoot;
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isCorruptSqliteError(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    code === "SQLITE_SCHEMA"
  )
    return true;
  const message = error instanceof Error ? error.message : "";
  return /database disk image is malformed|file is not a database|malformed database schema/iu.test(
    message,
  );
}

export function graphQlLiteAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GraphQlLiteAsset {
  const asset = ASSETS.find(
    (candidate) => candidate.platform === platform && candidate.arch === arch,
  );
  if (asset === undefined)
    throw new Error(
      `GraphQLite v${GRAPHQLITE_VERSION}は${platform}/${arch}を未対応です`,
    );
  return asset;
}

function extensionRelativePath(asset: GraphQlLiteAsset): string {
  return `${GRAPH_RUNTIME_DIRECTORY}/extensions/v${GRAPHQLITE_VERSION}/${asset.name}`;
}

function ensureDirectory(root: string, relative: string): string {
  const resolvedRoot = fs.realpathSync(root);
  const target = resolveContained(resolvedRoot, relative, {
    allowMissingLeaf: true,
  });
  let current = resolvedRoot;
  for (const component of path.relative(resolvedRoot, target).split(path.sep)) {
    if (!component) continue;
    current = path.join(current, component);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          `graph runtimeの親にsymlinkまたは非directoryがあります: ${relative}`,
        );
      if (isPrivateRuntimeDescendant(resolvedRoot, current))
        assertPrivateRuntimeEntry(current, stat);
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
      if (isPrivateRuntimeDescendant(resolvedRoot, current))
        assertPrivateRuntimeEntry(current, fs.lstatSync(current));
    }
  }
  return target;
}

function assertPrivateRuntimeEntry(file: string, stat: fs.Stats): void {
  if (process.platform === "win32" || process.getuid === undefined) return;
  if (stat.uid !== process.getuid())
    throw new Error(`graph runtimeは現在user所有でなければなりません: ${file}`);
  if ((stat.mode & 0o022) !== 0)
    throw new Error(`graph runtimeはgroup/world writableにできません: ${file}`);
}

function isPrivateRuntimeDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === ".agent-skill-chain/runtime" ||
    relative.startsWith(`.agent-skill-chain/runtime${path.sep}`)
  );
}

function assertPrivateParentChain(root: string, target: string): void {
  const resolvedRoot = fs.realpathSync(root);
  const relative = path.relative(resolvedRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("graph runtime pathがworktree root外です");
  let current = resolvedRoot;
  for (const component of path.dirname(relative).split(path.sep)) {
    if (!component || component === ".") continue;
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("graph runtimeの親にsymlinkまたは非directoryがあります");
    if (isPrivateRuntimeDescendant(resolvedRoot, current))
      assertPrivateRuntimeEntry(current, stat);
  }
}

function assertPinnedExtension(file: string, asset: GraphQlLiteAsset): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("GraphQLite extensionはsymlinkでない通常fileが必要です");
  assertPrivateRuntimeEntry(file, stat);
  if (stat.size !== asset.size)
    throw new Error("GraphQLite extensionが固定sizeと一致しません");
  const contents = fs.readFileSync(file);
  if (contents.length !== asset.size || sha256(contents) !== asset.sha256)
    throw new Error("GraphQLite extensionが固定size・SHA-256と一致しません");
}

function assertBoundedDatabaseFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("graph databaseはsymlinkでない通常fileが必要です");
  assertPrivateRuntimeEntry(file, stat);
  if (stat.size > MAX_GRAPH_DATABASE_BYTES)
    throw new Error("graph databaseのbyte上限を超えています");
}

async function readFixedSizeResponse(
  response: Response,
  expectedSize: number,
): Promise<Buffer> {
  if (response.body === null)
    throw new Error("GraphQLite extensionのresponse bodyがありません");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize)
        throw new Error("GraphQLite extensionが固定sizeを超えました");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedSize)
    throw new Error("GraphQLite extensionが固定sizeと一致しません");
  return Buffer.concat(chunks, size);
}

export interface GraphQlLiteInstallResult {
  readonly status: "preview" | "present" | "installed";
  readonly asset: GraphQlLiteAsset;
  readonly path: string;
}

export async function installGraphQlLiteExtension(
  root: string,
  options: {
    readonly apply: boolean;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly fetchAsset?: typeof fetch;
  },
): Promise<GraphQlLiteInstallResult> {
  if (!supportedNodeRuntime())
    throw new Error("GraphQLite adapterにはNode.js 22.13以上が必要です");
  const resolvedRoot = canonicalGitWorktreeRoot(root);
  const asset = graphQlLiteAsset(options.platform, options.arch);
  const relative = extensionRelativePath(asset);
  const target = resolveContained(resolvedRoot, relative, {
    allowMissingLeaf: true,
  });
  if (fs.existsSync(target)) {
    assertPrivateParentChain(resolvedRoot, target);
    assertPinnedExtension(target, asset);
    return { status: "present", asset, path: target };
  }
  if (!options.apply) return { status: "preview", asset, path: target };
  ensureDirectory(resolvedRoot, path.posix.dirname(relative));
  const fetchAsset = options.fetchAsset ?? fetch;
  const response = await fetchAsset(asset.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `GraphQLite extension取得に失敗しました: HTTP ${response.status}`,
    );
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) !== asset.size)
    throw new Error(
      "GraphQLite extensionのContent-Lengthが固定値と一致しません",
    );
  const contents = await readFixedSizeResponse(response, asset.size);
  if (contents.length !== asset.size || sha256(contents) !== asset.sha256)
    throw new Error(
      "GraphQLite extensionの取得内容が固定size・SHA-256と一致しません",
    );
  const temporary = `${target}.pending-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  fs.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  assertPrivateParentChain(resolvedRoot, target);
  assertPinnedExtension(target, asset);
  return { status: "installed", asset, path: target };
}

function openDatabase(
  root: string,
  databaseFile: string,
  extensionFile: string,
  asset: GraphQlLiteAsset,
  readOnly = false,
): DatabaseSync {
  assertPrivateParentChain(root, extensionFile);
  assertPinnedExtension(extensionFile, asset);
  if (readOnly) {
    assertPrivateParentChain(root, databaseFile);
    assertBoundedDatabaseFile(databaseFile);
  }
  const database = new DatabaseSync(databaseFile, {
    allowExtension: true,
    ...(readOnly ? { readOnly: true } : {}),
  });
  try {
    const loadExtension = database.loadExtension.bind(database) as (
      file: string,
      entryPoint: string,
    ) => void;
    assertPrivateParentChain(root, extensionFile);
    assertPinnedExtension(extensionFile, asset);
    loadExtension(extensionFile, GRAPHQLITE_ENTRYPOINT);
    assertPrivateParentChain(root, extensionFile);
    assertPinnedExtension(extensionFile, asset);
    database.enableLoadExtension(false);
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    if (readOnly) database.exec("PRAGMA query_only=ON;");
    else database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function cypher(
  database: DatabaseSync,
  statement: string,
  parameters: Readonly<Record<string, JsonValue>> = {},
): JsonValue[] {
  const row = database
    .prepare("SELECT cypher(?, ?) AS result")
    .get(statement, stableJson(parameters));
  if (!isRecord(row) || typeof row.result !== "string")
    throw new Error("GraphQLiteがJSON resultを返しませんでした");
  if (Buffer.byteLength(row.result, "utf8") > MAX_GRAPH_QUERY_RESULT_BYTES)
    throw new Error("GraphQLite resultのbyte上限を超えています");
  const parsed = parseJsonStrict(row.result, "GraphQLite result");
  if (!Array.isArray(parsed))
    throw new Error("GraphQLite resultは配列が必要です");
  return parsed;
}

function countGraphRows(
  database: DatabaseSync,
  statement: string,
  label: string,
): number {
  const rows = cypher(database, statement);
  if (rows.length !== 1 || !isRecord(rows[0]))
    throw new Error(`GraphQLite ${label} countが不正です`);
  const values = Object.values(rows[0]);
  if (
    values.length !== 1 ||
    !Number.isSafeInteger(values[0]) ||
    (values[0] as number) < 0
  )
    throw new Error(`GraphQLite ${label} countが安全な整数ではありません`);
  return values[0] as number;
}

function scalarProperties(
  value: unknown,
): Readonly<Record<string, GraphScalar>> {
  if (!isRecord(value))
    throw new Error("graph propertiesがobjectではありません");
  const result: Record<string, GraphScalar> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      candidate !== null &&
      typeof candidate !== "string" &&
      typeof candidate !== "number" &&
      typeof candidate !== "boolean"
    )
      throw new Error(`graph propertyがscalarではありません: ${key}`);
    result[key] = candidate;
  }
  return result;
}

function graphValue(
  value: unknown,
  kind: "node" | "edge",
): Record<string, JsonValue> {
  if (!isRecord(value) || !isRecord(value.properties))
    throw new Error(`GraphQLite ${kind} resultが不正です`);
  return value.properties as Record<string, JsonValue>;
}

function optionalNumber(
  properties: Readonly<Record<string, JsonValue>>,
  key: string,
): number | undefined {
  const value = properties[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`GraphQLite property ${key}が有限numberではありません`);
  return value;
}

function requiredString(
  properties: Readonly<Record<string, JsonValue>>,
  key: string,
): string {
  const value = properties[key];
  if (typeof value !== "string")
    throw new Error(`GraphQLite property ${key}がstringではありません`);
  return value;
}

function parseStoredProperties(
  properties: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, GraphScalar>> {
  const text = requiredString(properties, "propertiesJson");
  return scalarProperties(parseJsonStrict(text, "GraphQLite propertiesJson"));
}

function parseNodeRow(value: unknown): SemanticGraphNode {
  if (!isRecord(value)) throw new Error("GraphQLite node rowが不正です");
  const properties = graphValue(value.n, "node");
  const certainty = requiredString(properties, "certainty");
  return {
    id: requiredString(properties, "id"),
    kind: requiredString(properties, "kind") as SemanticGraphNode["kind"],
    certainty: certainty as SemanticGraphNode["certainty"],
    ...(properties.confidence === undefined
      ? {}
      : { confidence: optionalNumber(properties, "confidence") }),
    sourcePath: requiredString(properties, "sourcePath"),
    ...(properties.sourceLine === undefined
      ? {}
      : { sourceLine: optionalNumber(properties, "sourceLine") }),
    properties: parseStoredProperties(properties),
  };
}

function parseEdgeRow(value: unknown): SemanticGraphEdge {
  if (!isRecord(value)) throw new Error("GraphQLite edge rowが不正です");
  const from = graphValue(value.a, "node");
  const to = graphValue(value.b, "node");
  const properties = graphValue(value.r, "edge");
  const certainty = requiredString(properties, "certainty");
  return {
    id: requiredString(properties, "id"),
    from: requiredString(from, "id"),
    to: requiredString(to, "id"),
    kind: requiredString(properties, "kind") as SemanticGraphEdge["kind"],
    certainty: certainty as SemanticGraphEdge["certainty"],
    ...(properties.confidence === undefined
      ? {}
      : { confidence: optionalNumber(properties, "confidence") }),
    ...(properties.weight === undefined
      ? {}
      : { weight: optionalNumber(properties, "weight") }),
    sourcePath: requiredString(properties, "sourcePath"),
    ...(properties.sourceLine === undefined
      ? {}
      : { sourceLine: optionalNumber(properties, "sourceLine") }),
    properties: parseStoredProperties(properties),
  };
}

function parseManifest(
  value: unknown,
  asset: GraphQlLiteAsset,
): GraphProjectionManifest {
  const manifestKeys = [
    "manifestVersion",
    "graphSchemaVersion",
    "graphBuilderVersion",
    "extensionVersion",
    "extensionSha256",
    "source",
    "graphContentHash",
    "nodeCount",
    "edgeCount",
    "generation",
    "status",
    "builtAt",
  ] as const;
  const sourceKeys = [
    "repositoryId",
    "worktreeId",
    "headSha",
    "treeSha",
    "contentDigest",
    "dirty",
  ] as const;
  if (
    !isRecord(value) ||
    !exactKeys(value, manifestKeys) ||
    !isRecord(value.source) ||
    !exactKeys(value.source, sourceKeys)
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph manifestのfield集合が不正です",
    );
  const source = value.source;
  if (
    !boundedIdentity(source.repositoryId) ||
    !sha256Digest(source.worktreeId) ||
    !gitObjectId(source.headSha) ||
    !gitObjectId(source.treeSha) ||
    !sha256Digest(source.contentDigest) ||
    typeof source.dirty !== "boolean"
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph manifestのsource identityが不正です",
    );
  if (
    value.manifestVersion !==
      "agent-skill-chain/graph-projection-manifest/v1" ||
    !boundedIdentity(value.graphSchemaVersion, 128) ||
    !boundedIdentity(value.graphBuilderVersion, 128) ||
    !boundedIdentity(value.extensionVersion, 128) ||
    !sha256Digest(value.extensionSha256) ||
    !sha256Digest(value.graphContentHash) ||
    !Number.isSafeInteger(value.nodeCount) ||
    (value.nodeCount as number) < 0 ||
    !Number.isSafeInteger(value.edgeCount) ||
    (value.edgeCount as number) < 0 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    (value.status !== "building" && value.status !== "complete") ||
    !canonicalUtcInstant(value.builtAt)
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph manifestの値または型が不正です",
    );
  const manifest = value as unknown as GraphProjectionManifest;
  const reasons: GraphDriftReason[] = [];
  if (manifest.status !== "complete") reasons.push("incomplete");
  if (manifest.graphSchemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION)
    reasons.push("schema-mismatch");
  if (manifest.graphBuilderVersion !== SEMANTIC_GRAPH_BUILDER_VERSION)
    reasons.push("builder-mismatch");
  if (
    manifest.extensionVersion !== GRAPHQLITE_VERSION ||
    manifest.extensionSha256 !== asset.sha256
  )
    reasons.push("extension-mismatch");
  if (reasons.length > 0)
    throw new GraphFreshnessError(
      reasons,
      `graph manifestが固定catalogまたは現行schemaと一致しません: ${reasons.join(", ")}`,
    );
  return manifest;
}

function readManifest(
  database: DatabaseSync,
  asset: GraphQlLiteAsset,
): GraphProjectionManifest {
  let row: unknown;
  try {
    row = database
      .prepare("SELECT json FROM asc_graph_manifest WHERE id=1")
      .get();
  } catch (error) {
    if (
      error instanceof Error &&
      /no such table: asc_graph_manifest/iu.test(error.message)
    )
      throw new GraphFreshnessError(
        ["incomplete"],
        "graph databaseのmanifest tableがありません",
      );
    throw error;
  }
  if (!isRecord(row) || typeof row.json !== "string")
    throw new GraphFreshnessError(
      ["incomplete"],
      "graph databaseにmanifestがありません",
    );
  let value: unknown;
  try {
    value = parseJsonStrict(row.json, "graph database manifest");
  } catch {
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph database manifestが妥当なJSONではありません",
    );
  }
  return parseManifest(value, asset);
}

function readSnapshot(
  database: DatabaseSync,
  manifest: GraphProjectionManifest,
  asset: GraphQlLiteAsset,
): SemanticGraphSnapshot {
  if (
    manifest.nodeCount > MAX_SEMANTIC_GRAPH_NODES ||
    manifest.edgeCount > MAX_SEMANTIC_GRAPH_EDGES
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph projectionが読取上限を超えています",
    );
  const storedNodeCount = countGraphRows(database, COUNT_NODES, "node");
  const storedEdgeCount = countGraphRows(database, COUNT_EDGES, "edge");
  if (
    storedNodeCount > MAX_SEMANTIC_GRAPH_NODES ||
    storedEdgeCount > MAX_SEMANTIC_GRAPH_EDGES
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph databaseの実件数が読取上限を超えています",
    );
  if (
    storedNodeCount !== manifest.nodeCount ||
    storedEdgeCount !== manifest.edgeCount
  )
    throw new GraphFreshnessError(
      ["projection-drift"],
      "graph databaseの実件数とmanifestが一致しません",
    );
  const nodes = cypher(database, READ_NODES).map(parseNodeRow);
  const edges = cypher(database, READ_EDGES).map(parseEdgeRow);
  const snapshot = canonicalSemanticGraph({
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    builderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    source: manifest.source,
    nodes,
    edges,
  });
  const errors = validateSemanticGraphSnapshot(snapshot);
  if (errors.length > 0)
    throw new GraphFreshnessError(
      ["corrupt"],
      `GraphQLite projectionが不正です: ${errors.join("; ")}`,
    );
  const contentHash = semanticGraphContentHash(snapshot);
  const freshness = assessGraphFreshness({
    expectedSource: manifest.source,
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: asset.sha256,
    manifest,
    observedGraphContentHash: contentHash,
    observedNodeCount: nodes.length,
    observedEdgeCount: edges.length,
  });
  if (!freshness.fresh || !freshness.exactEvidenceAllowed)
    throw new GraphFreshnessError(
      freshness.reasons,
      `GraphQLite projection driftを検出しました: ${freshness.reasons.join(", ")}`,
    );
  return snapshot;
}

function readSafeCurrentPointerBytes(root: string): Buffer | undefined {
  const pointerFile = resolveContained(root, CURRENT_POINTER, {
    allowMissingLeaf: true,
  });
  assertPrivateParentChain(root, pointerFile);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(pointerFile);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph current pointerはsymlinkでない通常fileが必要です",
    );
  try {
    assertPrivateRuntimeEntry(pointerFile, stat);
  } catch (error) {
    if (
      error instanceof Error &&
      /現在user所有|group\/world writable/u.test(error.message)
    )
      throw new GraphFreshnessError(["corrupt"], error.message);
    throw error;
  }
  if (stat.size > MAX_CURRENT_POINTER_BYTES)
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph current pointerのbyte上限を超えています",
    );
  return fs.readFileSync(pointerFile);
}

function parsePointer(root: string, asset: GraphQlLiteAsset): CurrentPointer {
  const pointerFile = resolveContained(root, CURRENT_POINTER, {
    allowMissingLeaf: true,
  });
  const contents = readSafeCurrentPointerBytes(root);
  if (contents === undefined)
    throw new GraphFreshnessError(
      ["missing"],
      "graph current pointerがありません",
    );
  let value: unknown;
  try {
    value = parseJsonStrict(contents.toString("utf8"), pointerFile);
  } catch {
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph current pointerが妥当なJSONではありません",
    );
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== "agent-skill-chain/graphqlite-current/v1" ||
    typeof value.databaseFile !== "string" ||
    !isRecord(value.manifest) ||
    Object.keys(value).length !== 3
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph current pointerが不正です",
    );
  if (
    !/^\.agent-skill-chain\/runtime\/graph\/v1\/generations\/generation-[1-9]\d*-[a-f0-9]{16}-[a-f0-9]{16}\.db$/u.test(
      value.databaseFile,
    )
  )
    throw new GraphFreshnessError(
      ["corrupt"],
      "graph current pointerのdatabase pathが不正です",
    );
  return {
    schemaVersion: value.schemaVersion,
    databaseFile: value.databaseFile,
    manifest: parseManifest(value.manifest, asset),
  };
}

interface RebuildLockRecord {
  readonly schemaVersion: "agent-skill-chain/graphqlite-rebuild-lock/v1";
  readonly pid: number;
  readonly nonce: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      isRecord(error) &&
      typeof error.code === "string" &&
      error.code === "ESRCH"
    );
  }
}

function parseRebuildLock(file: string): RebuildLockRecord {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("graph rebuild lockはsymlinkでない通常fileが必要です");
  assertPrivateRuntimeEntry(file, stat);
  const value = parseJsonStrict(fs.readFileSync(file, "utf8"), file);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "agent-skill-chain/graphqlite-rebuild-lock/v1" ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) < 1 ||
    typeof value.nonce !== "string" ||
    !/^[a-f0-9]{32}$/u.test(value.nonce) ||
    Object.keys(value).length !== 3
  )
    throw new Error("graph rebuild lockが不正です");
  return value as unknown as RebuildLockRecord;
}

function acquireRebuildLock(root: string): () => void {
  ensureDirectory(root, GRAPH_RUNTIME_DIRECTORY);
  const lockFile = resolveContained(root, REBUILD_LOCK, {
    allowMissingLeaf: true,
  });
  const nonce = crypto.randomBytes(16).toString("hex");
  const record: RebuildLockRecord = {
    schemaVersion: "agent-skill-chain/graphqlite-rebuild-lock/v1",
    pid: process.pid,
    nonce,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (fs.existsSync(lockFile)) {
      const existing = parseRebuildLock(lockFile);
      if (processIsAlive(existing.pid))
        throw new Error("別processがsemantic graphを再構築中です");
      fs.unlinkSync(lockFile);
    }
    const temporary = `${lockFile}.candidate-${process.pid}-${nonce}`;
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${stableJson(record)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(temporary, lockFile);
      fs.unlinkSync(temporary);
      return () => {
        if (!fs.existsSync(lockFile)) return;
        const current = parseRebuildLock(lockFile);
        if (current.pid !== process.pid || current.nonce !== nonce)
          throw new Error("graph rebuild lockの所有権が変化しました");
        fs.unlinkSync(lockFile);
      };
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (
        !isRecord(error) ||
        typeof error.code !== "string" ||
        error.code !== "EEXIST" ||
        attempt > 0
      )
        throw error;
    }
  }
  throw new Error("graph rebuild lockを取得できませんでした");
}

function removeDatabaseFamily(databaseFile: string): void {
  for (const suffix of ["", "-wal", "-shm"])
    fs.rmSync(`${databaseFile}${suffix}`, { force: true });
}

function cleanupPendingGenerations(root: string): void {
  const relative = `${GRAPH_RUNTIME_DIRECTORY}/generations`;
  const directory = resolveContained(root, relative, {
    allowMissingLeaf: true,
  });
  if (!fs.existsSync(directory)) return;
  assertPrivateParentChain(root, path.join(directory, "candidate"));
  for (const entry of fs.readdirSync(directory).sort()) {
    if (
      !/^\.pending-generation-[1-9]\d*-[a-f0-9]{16}-[a-f0-9]{16}\.db(?:-wal|-shm)?$/u.test(
        entry,
      )
    )
      continue;
    const candidate = path.join(directory, entry);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("stale graph pending artifactが通常fileではありません");
    assertPrivateRuntimeEntry(candidate, stat);
    fs.unlinkSync(candidate);
  }
}

function nextGenerationNumber(root: string): number {
  const directory = ensureDirectory(
    root,
    `${GRAPH_RUNTIME_DIRECTORY}/generations`,
  );
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
    throw new Error("graph generationsはsymlinkでないdirectoryが必要です");
  assertPrivateRuntimeEntry(directory, directoryStat);
  let maximum = 0;
  for (const entry of fs.readdirSync(directory).sort()) {
    const candidate = path.join(directory, entry);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("graph generation artifactは通常fileが必要です");
    assertPrivateRuntimeEntry(candidate, stat);
    const match = GENERATION_DATABASE_PATTERN.exec(entry);
    if (match === null)
      throw new Error(
        `未知のgraph generation artifactを拒否しました: ${entry}`,
      );
    const generation = Number(match[1]);
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error("graph projection generationが安全な整数ではありません");
    maximum = Math.max(maximum, generation);
  }
  if (maximum >= Number.MAX_SAFE_INTEGER)
    throw new Error("graph projection generationが安全な整数範囲を超えました");
  return maximum + 1;
}

function assertCurrentPointerUnchanged(
  root: string,
  expected: Buffer | undefined,
): void {
  const observed = readSafeCurrentPointerBytes(root);
  if (
    (expected === undefined) !== (observed === undefined) ||
    (expected !== undefined &&
      observed !== undefined &&
      !expected.equals(observed))
  )
    throw new GraphFreshnessError(
      ["projection-drift"],
      "graph current pointerが再構築中に変化しました",
    );
}

function databaseManifestJson(manifest: GraphProjectionManifest): string {
  return stableJson(manifest);
}

function buildDatabase(
  root: string,
  databaseFile: string,
  extensionFile: string,
  asset: GraphQlLiteAsset,
  snapshot: SemanticGraphSnapshot,
  manifest: GraphProjectionManifest,
): void {
  const database = openDatabase(root, databaseFile, extensionFile, asset);
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(
        "CREATE TABLE asc_graph_manifest (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)",
      );
      for (const node of snapshot.nodes)
        cypher(database, CREATE_NODE, {
          id: node.id,
          kind: node.kind,
          certainty: node.certainty,
          confidence: node.confidence ?? null,
          sourcePath: node.sourcePath,
          sourceLine: node.sourceLine ?? null,
          propertiesJson: stableJson(node.properties),
        });
      for (const edge of snapshot.edges)
        cypher(database, CREATE_EDGE, {
          from: edge.from,
          to: edge.to,
          id: edge.id,
          kind: edge.kind,
          certainty: edge.certainty,
          confidence: edge.confidence ?? null,
          weight: edge.weight ?? null,
          sourcePath: edge.sourcePath,
          sourceLine: edge.sourceLine ?? null,
          propertiesJson: stableJson(edge.properties),
        });
      database
        .prepare("INSERT INTO asc_graph_manifest (id, json) VALUES (1, ?)")
        .run(databaseManifestJson(manifest));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const quickCheck = database.prepare("PRAGMA quick_check").all();
    if (
      quickCheck.length !== 1 ||
      !isRecord(quickCheck[0]) ||
      Object.values(quickCheck[0]).some((value) => value !== "ok")
    )
      throw new Error("GraphQLite databaseのquick_checkに失敗しました");
    database.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
    );
  } finally {
    database.close();
    if (fs.existsSync(databaseFile)) fs.chmodSync(databaseFile, 0o600);
  }
}

type GraphQlLiteFaultCheckpoint = "after-candidate-readback";

export class GraphQlLiteStore implements GraphStorePort {
  readonly #root: string;
  readonly #asset: GraphQlLiteAsset;
  readonly #extensionFile: string;
  readonly #faultCheckpoint:
    | ((checkpoint: GraphQlLiteFaultCheckpoint) => void | Promise<void>)
    | undefined;
  #closed = false;

  constructor(
    root: string,
    options: {
      readonly platform?: NodeJS.Platform;
      readonly arch?: string;
      /** @internal Deterministic crash-boundary verification only. */
      readonly faultCheckpoint?: (
        checkpoint: GraphQlLiteFaultCheckpoint,
      ) => void | Promise<void>;
    } = {},
  ) {
    if (!supportedNodeRuntime())
      throw new Error("GraphQLite adapterにはNode.js 22.13以上が必要です");
    this.#root = canonicalGitWorktreeRoot(root);
    this.#asset = graphQlLiteAsset(options.platform, options.arch);
    this.#faultCheckpoint = options.faultCheckpoint;
    this.#extensionFile = resolveContained(
      this.#root,
      extensionRelativePath(this.#asset),
      { allowMissingLeaf: true },
    );
    if (!fs.existsSync(this.#extensionFile))
      throw new GraphFreshnessError(
        ["missing"],
        "固定catalogのGraphQLite extensionがinstallされていません",
      );
    assertPrivateParentChain(this.#root, this.#extensionFile);
    assertPinnedExtension(this.#extensionFile, this.#asset);
  }

  async replace(
    input: SemanticGraphSnapshot,
    builtAt: string,
    observeSourceBeforePublish: GraphSourceObserver,
  ): Promise<GraphProjectionManifest> {
    if (this.#closed) throw new Error("GraphQlLiteStoreはclose済みです");
    const cardinalityErrors = semanticGraphCardinalityErrors(input);
    if (cardinalityErrors.length > 0)
      throw new Error(
        `semantic graphがprojection上限を超えています: ${cardinalityErrors.join("; ")}`,
      );
    const errors = validateSemanticGraphSnapshot(input);
    if (errors.length > 0)
      throw new Error(
        `semantic graph snapshotが不正です: ${errors.join("; ")}`,
      );
    const snapshot = canonicalSemanticGraph(input);
    if (!canonicalUtcInstant(builtAt))
      throw new Error("builtAtはcanonical UTC RFC3339が必要です");
    const releaseRebuildLock = acquireRebuildLock(this.#root);
    try {
      const pointerBefore = readSafeCurrentPointerBytes(this.#root);
      cleanupPendingGenerations(this.#root);
      const generation = nextGenerationNumber(this.#root);
      const graphContentHash = semanticGraphContentHash(snapshot);
      const manifest: GraphProjectionManifest = {
        manifestVersion: "agent-skill-chain/graph-projection-manifest/v1",
        graphSchemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
        graphBuilderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
        extensionVersion: GRAPHQLITE_VERSION,
        extensionSha256: this.#asset.sha256,
        source: snapshot.source,
        graphContentHash,
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        generation,
        status: "complete",
        builtAt,
      };
      const generations = ensureDirectory(
        this.#root,
        `${GRAPH_RUNTIME_DIRECTORY}/generations`,
      );
      const nonce = crypto.randomBytes(8).toString("hex");
      const databaseName = `generation-${generation}-${graphContentHash.slice(0, 16)}-${nonce}.db`;
      const relativeDatabase = `${GRAPH_RUNTIME_DIRECTORY}/generations/${databaseName}`;
      const finalDatabase = resolveContained(this.#root, relativeDatabase, {
        allowMissingLeaf: true,
      });
      const temporary = path.join(generations, `.pending-${databaseName}`);
      let published = false;
      try {
        buildDatabase(
          this.#root,
          temporary,
          this.#extensionFile,
          this.#asset,
          snapshot,
          manifest,
        );
        const verification = openDatabase(
          this.#root,
          temporary,
          this.#extensionFile,
          this.#asset,
          true,
        );
        try {
          const storedManifest = readManifest(verification, this.#asset);
          if (stableJson(storedManifest) !== stableJson(manifest))
            throw new Error(
              "GraphQLite database manifestのread-backが一致しません",
            );
          readSnapshot(verification, storedManifest, this.#asset);
        } finally {
          verification.close();
        }
        fs.renameSync(temporary, finalDatabase);
        await this.#faultCheckpoint?.("after-candidate-readback");
        const observedSource = await observeSourceBeforePublish();
        const sourceFreshness = assessGraphFreshness({
          expectedSource: observedSource,
          expectedExtensionVersion: GRAPHQLITE_VERSION,
          expectedExtensionSha256: this.#asset.sha256,
          manifest,
          observedGraphContentHash: graphContentHash,
          observedNodeCount: snapshot.nodes.length,
          observedEdgeCount: snapshot.edges.length,
        });
        if (!sourceFreshness.fresh || !sourceFreshness.exactEvidenceAllowed)
          throw new GraphFreshnessError(
            sourceFreshness.reasons,
            `semantic graph構築中のsource driftを検出しました: ${sourceFreshness.reasons.join(", ")}`,
          );
        assertCurrentPointerUnchanged(this.#root, pointerBefore);
        const pointer: CurrentPointer = {
          schemaVersion: "agent-skill-chain/graphqlite-current/v1",
          databaseFile: relativeDatabase,
          manifest,
        };
        writeFileAtomic(
          resolveContained(this.#root, CURRENT_POINTER, {
            allowMissingLeaf: true,
          }),
          `${stableJson(pointer)}\n`,
        );
        published = true;
        return manifest;
      } catch (error) {
        removeDatabaseFamily(temporary);
        if (!published) removeDatabaseFamily(finalDatabase);
        throw error;
      }
    } finally {
      releaseRebuildLock();
    }
  }

  async read(): Promise<GraphStoreReadResult> {
    if (this.#closed) throw new Error("GraphQlLiteStoreはclose済みです");
    const pointer = parsePointer(this.#root, this.#asset);
    try {
      const databaseFile = resolveContained(this.#root, pointer.databaseFile, {
        allowMissingLeaf: true,
      });
      assertBoundedDatabaseFile(databaseFile);
      const database = openDatabase(
        this.#root,
        databaseFile,
        this.#extensionFile,
        this.#asset,
        true,
      );
      try {
        const manifest = readManifest(database, this.#asset);
        if (stableJson(manifest) !== stableJson(pointer.manifest))
          throw new GraphFreshnessError(
            ["projection-drift"],
            "graph pointerとdatabase manifestが一致しません",
          );
        return {
          manifest,
          snapshot: readSnapshot(database, manifest, this.#asset),
        };
      } finally {
        database.close();
      }
    } catch (error) {
      if (error instanceof GraphFreshnessError) throw error;
      if (isMissingFileError(error))
        throw new GraphFreshnessError(
          ["missing"],
          "graph current generationがありません",
        );
      if (isCorruptSqliteError(error) || errorCode(error) === undefined)
        throw new GraphFreshnessError(
          ["corrupt"],
          error instanceof Error
            ? `graph current generationが破損しています: ${error.message}`
            : "graph current generationが破損しています",
        );
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}
