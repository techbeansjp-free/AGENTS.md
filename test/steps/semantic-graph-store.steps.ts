import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  GRAPHQLITE_COMMIT,
  GRAPHQLITE_VERSION,
  GraphQlLiteStore,
  graphQlLiteAsset,
  installGraphQlLiteExtension,
  type GraphQlLiteAsset,
  type GraphQlLiteInstallResult,
} from "../../src/adapters/graphqlite.js";
import { buildRepositorySemanticGraph } from "../../src/adapters/repository-graph.js";
import { main } from "../../src/cli.js";
import {
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  canonicalSemanticGraph,
  semanticGraphContentHash,
  type GraphProjectionManifest,
  type GraphStoreReadResult,
  type SemanticGraphSnapshot,
} from "../../src/domain/semantic-graph.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const ACTUAL_EXTENSION_ENV = "ASC_GRAPHQLITE_TEST_EXTENSION";
const FIXED_BUILT_AT = "2026-08-30T00:00:00.000Z";
const GRAPH_RUNTIME = ".agent-skill-chain/runtime/graph/v1";

interface TransportRequest {
  readonly url: string;
  readonly redirect: RequestRedirect | undefined;
}

interface SemanticGraphStoreWorld extends WorkflowWorld {
  actualAssetBytes?: Buffer;
  asset?: GraphQlLiteAsset;
  cliOutput?: Record<string, unknown>;
  cliStatus?: number;
  extensionTarget?: string;
  fixtureRoot?: string;
  installResult?: GraphQlLiteInstallResult;
  manifest?: GraphProjectionManifest;
  pointerBefore?: string;
  readBack?: GraphStoreReadResult;
  runtimeBefore?: readonly string[];
  snapshot?: SemanticGraphSnapshot;
  sourceBefore?: string;
  transportRequests?: TransportRequest[];
}

const { Given, When, Then } = stepDefinitions<SemanticGraphStoreWorld>();

function fixtureRoot(world: SemanticGraphStoreWorld): string {
  assert.ok(world.fixtureRoot, "隔離projectがありません");
  return world.fixtureRoot;
}

function selectedAsset(world: SemanticGraphStoreWorld): GraphQlLiteAsset {
  assert.ok(world.asset, "GraphQLite assetがありません");
  return world.asset;
}

function createProject(world: SemanticGraphStoreWorld): string {
  const root = world.initRepo();
  world.fixtureRoot = root;
  world.asset = graphQlLiteAsset();
  world.transportRequests = [];
  return root;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(
  root: string,
  relative: string,
  contents: string | Buffer,
): void {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    target,
    contents,
    typeof contents === "string" ? "utf8" : undefined,
  );
}

function commitGraphFixture(root: string): void {
  write(root, ".gitignore", ".agent-skill-chain/runtime/\n");
  write(
    root,
    "src/entry.ts",
    'import "./target.js";\nexport const entry = true;\n',
  );
  write(root, "src/target.ts", "export const target = true;\n");
  git(root, ["add", ".gitignore", "src/entry.ts", "src/target.ts"]);
  git(root, ["commit", "-q", "-m", "add semantic graph store fixture"]);
}

function extensionTarget(root: string, asset: GraphQlLiteAsset): string {
  return path.join(
    root,
    ".agent-skill-chain",
    "runtime",
    "graph",
    "v1",
    "extensions",
    `v${GRAPHQLITE_VERSION}`,
    asset.name,
  );
}

function sha256(contents: Buffer): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function injectedTransport(
  world: SemanticGraphStoreWorld,
  contents: Buffer,
): typeof fetch {
  return async (input, init) => {
    world.transportRequests ??= [];
    world.transportRequests.push({
      url: requestUrl(input),
      redirect: init?.redirect,
    });
    return new Response(new Uint8Array(contents), {
      status: 200,
      headers: { "content-length": String(contents.length) },
    });
  };
}

async function captureFailure(action: () => Promise<unknown>): Promise<Error> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, "operationが失敗しませんでした");
  return caught;
}

function filesBelow(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const current = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesBelow(current)
        : entry.isFile() || entry.isSymbolicLink()
          ? [current]
          : [];
    })
    .sort();
}

function pendingFiles(root: string): string[] {
  return filesBelow(path.join(root, ".agent-skill-chain", "runtime")).filter(
    (file) => path.basename(file).includes("pending"),
  );
}

function runtimeInventory(root: string): string[] {
  const runtime = path.join(root, ".agent-skill-chain", "runtime");
  return filesBelow(runtime).map((file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink())
      return `${relative}\tsymlink\t${fs.readlinkSync(file)}`;
    const contents = fs.readFileSync(file);
    return `${relative}\t${contents.length}\t${sha256(contents)}`;
  });
}

async function installActualAsset(
  world: SemanticGraphStoreWorld,
): Promise<GraphQlLiteInstallResult> {
  const bytes = world.actualAssetBytes;
  assert.ok(bytes, "明示注入されたnative assetがありません");
  const result = await installGraphQlLiteExtension(fixtureRoot(world), {
    apply: true,
    fetchAsset: injectedTransport(world, bytes),
  });
  world.installResult = result;
  world.extensionTarget = result.path;
  return result;
}

async function prepareActualProjection(
  world: SemanticGraphStoreWorld,
): Promise<void> {
  const root = fixtureRoot(world);
  commitGraphFixture(root);
  await installActualAsset(world);
  const snapshot = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  try {
    world.manifest = await store.replace(snapshot, FIXED_BUILT_AT);
    world.readBack = await store.read();
  } finally {
    await store.close();
  }
  world.snapshot = snapshot;
}

async function runCli(
  world: SemanticGraphStoreWorld,
  arguments_: readonly string[],
): Promise<void> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    world.cliStatus = await main([...arguments_], {
      now: () => new Date(FIXED_BUILT_AT),
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  world.cliOutput = JSON.parse(output) as Record<string, unknown>;
}

function currentPointer(root: string): {
  readonly databaseFile: string;
} {
  const source = fs.readFileSync(
    path.join(root, GRAPH_RUNTIME, "current.json"),
    "utf8",
  );
  const value = JSON.parse(source) as { databaseFile?: unknown };
  assert.equal(typeof value.databaseFile, "string");
  return { databaseFile: value.databaseFile } as { databaseFile: string };
}

function injectionSnapshot(): SemanticGraphSnapshot {
  const injection = "file:src/input.ts'}) MATCH (pwned) DETACH DELETE pwned //";
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    builderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    source: {
      repositoryId: "semantic-store-injection-fixture",
      worktreeId: "1".repeat(64),
      headSha: "2".repeat(40),
      treeSha: "3".repeat(40),
      contentDigest: "4".repeat(64),
      dirty: false,
    },
    nodes: [
      {
        id: injection,
        kind: "file",
        certainty: "deterministic",
        sourcePath: "src/input.ts",
        properties: {
          payload: "'}) CREATE (pwned:Injected) //",
        },
      },
      {
        id: "file:src/target.ts",
        kind: "file",
        certainty: "deterministic",
        sourcePath: "src/target.ts",
        properties: { safe: true },
      },
    ],
    edges: [
      {
        id: "edge:injection'}) DELETE r //",
        from: injection,
        to: "file:src/target.ts",
        kind: "imports",
        certainty: "deterministic",
        sourcePath: "src/input.ts",
        properties: { payload: "MATCH (n) RETURN n" },
      },
    ],
  };
}

Given("GraphQLite install preview用の隔離projectがある", function () {
  createProject(this);
});

When("transportを失敗させる設定でinstall previewを実行する", async function () {
  const unusedTransport = (async () => {
    this.transportRequests ??= [];
    this.transportRequests.push({
      url: "unexpected://transport-call",
      redirect: undefined,
    });
    throw new Error("previewがtransportを呼びました");
  }) as typeof fetch;
  this.installResult = await installGraphQlLiteExtension(fixtureRoot(this), {
    apply: false,
    fetchAsset: unusedTransport,
  });
  this.extensionTarget = this.installResult.path;
});

Then(
  "固定versionとdigestの計画だけを返しtransportもruntimeも使用しない",
  function () {
    assert.equal(this.installResult?.status, "preview");
    assert.equal(GRAPHQLITE_VERSION, "0.6.1");
    assert.equal(GRAPHQLITE_COMMIT, "a1c65adcc1cc261f9bf9fd0a059f2cfb4b955d13");
    assert.match(
      String(this.installResult?.asset.url),
      /^https:\/\/github\.com\/colliery-io\/graphqlite\/releases\/download\/v0\.6\.1\//u,
    );
    assert.match(String(this.installResult?.asset.sha256), /^[a-f0-9]{64}$/u);
    assert.equal(this.transportRequests?.length, 0);
    assert.equal(
      fs.existsSync(
        path.join(fixtureRoot(this), ".agent-skill-chain", "runtime"),
      ),
      false,
    );
  },
);

Given("固定digestのGraphQLite native assetが明示注入されている", function () {
  const configured = process.env[ACTUAL_EXTENSION_ENV];
  if (configured === undefined || configured === "") return "skipped";
  assert.equal(
    path.isAbsolute(configured),
    true,
    `${ACTUAL_EXTENSION_ENV}にはabsolute pathが必要です`,
  );
  const stat = fs.lstatSync(configured);
  assert.equal(
    stat.isSymbolicLink(),
    false,
    "native asset fixtureをsymlinkにできません",
  );
  assert.equal(stat.isFile(), true, "native asset fixtureは通常fileが必要です");
  const asset = graphQlLiteAsset();
  const bytes = fs.readFileSync(configured);
  assert.equal(
    bytes.length,
    asset.size,
    "native asset fixtureのsizeが固定値と不一致です",
  );
  assert.equal(
    sha256(bytes),
    asset.sha256,
    "native asset fixtureのdigestが固定値と不一致です",
  );
  createProject(this);
  this.asset = asset;
  this.actualAssetBytes = bytes;
});

When("注入transportからGraphQLite install applyを実行する", async function () {
  await installActualAsset(this);
});

Then("固定URLを1回だけ取得し検証済み通常fileだけを公開する", function () {
  const asset = selectedAsset(this);
  assert.equal(this.installResult?.status, "installed");
  assert.deepEqual(this.transportRequests, [
    { url: asset.url, redirect: "follow" },
  ]);
  assert.ok(this.extensionTarget);
  const stat = fs.lstatSync(this.extensionTarget);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.size, asset.size);
  assert.equal(sha256(fs.readFileSync(this.extensionTarget)), asset.sha256);
  assert.deepEqual(pendingFiles(fixtureRoot(this)), []);
});

When(
  "repository graphをactual storeへ完全再構築してpath queryする",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    await runCli(this, [
      "graph",
      "path",
      `--root=${root}`,
      "--from=file:src/entry.ts",
      "--to=file:src/target.ts",
      "--edge-kinds=imports",
    ]);
  },
);

Then("actual databaseのreadbackとqueryは正本snapshotに一致する", function () {
  assert.ok(this.snapshot);
  assert.ok(this.readBack);
  assert.equal(
    semanticGraphContentHash(this.readBack.snapshot),
    semanticGraphContentHash(this.snapshot),
  );
  assert.equal(
    this.readBack.manifest.graphContentHash,
    this.manifest?.graphContentHash,
  );
  assert.equal(this.cliStatus, 0);
  assert.equal(this.cliOutput?.status, "complete");
  assert.deepEqual(this.cliOutput?.path, [
    "file:src/entry.ts",
    "file:src/target.ts",
  ]);
  assert.equal(this.cliOutput?.exactEvidence, true);
});

Given("digest不一致のGraphQLite transportを持つ隔離projectがある", function () {
  createProject(this);
  const asset = selectedAsset(this);
  this.actualAssetBytes = Buffer.alloc(asset.size, 0x41);
});

When(
  "digest不一致assetでGraphQLite install applyを実行する",
  async function () {
    const bytes = this.actualAssetBytes;
    assert.ok(bytes);
    this.error = await captureFailure(() =>
      installGraphQlLiteExtension(fixtureRoot(this), {
        apply: true,
        fetchAsset: injectedTransport(this, bytes),
      }),
    );
    this.extensionTarget = extensionTarget(
      fixtureRoot(this),
      selectedAsset(this),
    );
  },
);

Then("digest不一致を理由にextensionもpending fileも公開しない", function () {
  assert.match(String(this.error), /SHA-256/u);
  assert.equal(this.transportRequests?.length, 1);
  assert.ok(this.extensionTarget);
  assert.equal(fs.existsSync(this.extensionTarget), false);
  assert.deepEqual(pendingFiles(fixtureRoot(this)), []);
});

Given(
  "GraphQLite extension配置先がsymlinkである隔離projectがある",
  function () {
    if (process.platform === "win32") return "skipped";
    const root = createProject(this);
    const target = extensionTarget(root, selectedAsset(this));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const outside = this.temp("asc-graphqlite-outside-");
    const outsideFile = path.join(outside, "extension.so");
    fs.writeFileSync(outsideFile, "not a trusted extension", { mode: 0o600 });
    fs.symlinkSync(outsideFile, target);
    this.extensionTarget = target;
  },
);

When("symlink配置済みprojectでGraphQLite installを検証する", async function () {
  this.error = await captureFailure(() =>
    installGraphQlLiteExtension(fixtureRoot(this), { apply: false }),
  );
});

Then("symlinkを理由にextensionを信頼しない", function () {
  assert.match(
    String(this.error),
    /symlinkでない通常file|シンボリックリンクによる境界外移動/u,
  );
  assert.ok(this.extensionTarget);
  assert.equal(fs.lstatSync(this.extensionTarget).isSymbolicLink(), true);
});

Given(
  "GraphQLite extension配置先がgroup writableである隔離projectがある",
  function () {
    if (process.platform === "win32" || process.getuid === undefined)
      return "skipped";
    const root = createProject(this);
    const target = extensionTarget(root, selectedAsset(this));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, "unsafe extension", { mode: 0o600 });
    fs.chmodSync(target, 0o660);
    this.extensionTarget = target;
  },
);

When(
  "unsafe permission配置済みprojectでGraphQLite installを検証する",
  async function () {
    this.error = await captureFailure(() =>
      installGraphQlLiteExtension(fixtureRoot(this), { apply: false }),
    );
  },
);

Then("private runtime permission違反としてextensionを信頼しない", function () {
  assert.match(String(this.error), /group\/world writable/u);
  assert.ok(this.extensionTarget);
  assert.notEqual(fs.lstatSync(this.extensionTarget).mode & 0o020, 0);
});

Given(
  "GraphQLite extensionのownerが現在userと異なる検証seamがある",
  function () {
    if (process.platform === "win32" || process.getuid === undefined)
      return "skipped";
    const root = createProject(this);
    const target = extensionTarget(root, selectedAsset(this));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, "owner mismatch extension", { mode: 0o600 });
    this.extensionTarget = target;
  },
);

When("owner不一致としてGraphQLite installを検証する", async function () {
  assert.ok(process.getuid);
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  assert.ok(descriptor);
  const actualUid = process.getuid();
  Object.defineProperty(process, "getuid", {
    ...descriptor,
    value: () => actualUid + 1,
  });
  try {
    this.error = await captureFailure(() =>
      installGraphQlLiteExtension(fixtureRoot(this), { apply: false }),
    );
  } finally {
    Object.defineProperty(process, "getuid", descriptor);
  }
});

Then("現在userの所有でないextensionを拒否する", function () {
  assert.match(String(this.error), /現在user所有/u);
  assert.ok(this.extensionTarget);
  assert.equal(fs.lstatSync(this.extensionTarget).isFile(), true);
});

When("complete generationを破損させてactual storeから読む", async function () {
  await prepareActualProjection(this);
  const root = fixtureRoot(this);
  const pointerFile = path.join(root, GRAPH_RUNTIME, "current.json");
  this.pointerBefore = fs.readFileSync(pointerFile, "utf8");
  this.sourceBefore = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const pointer = currentPointer(root);
  const databaseFile = path.resolve(root, pointer.databaseFile);
  fs.writeFileSync(databaseFile, "corrupt graph generation", { mode: 0o600 });
  const store = new GraphQlLiteStore(root);
  try {
    this.error = await captureFailure(() => store.read());
  } finally {
    await store.close();
  }
});

Then(
  "corrupt generationを拒否しcurrent pointerと正本を変更しない",
  function () {
    assert.match(String(this.error), /database|SQLite|GraphQLite|malformed/iu);
    const root = fixtureRoot(this);
    assert.equal(
      fs.readFileSync(path.join(root, GRAPH_RUNTIME, "current.json"), "utf8"),
      this.pointerBefore,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "README.md"), "utf8"),
      this.sourceBefore,
    );
  },
);

When(
  "complete generationの後で正本sourceを変更してstatusを読む",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    this.runtimeBefore = runtimeInventory(root);
    fs.appendFileSync(
      path.join(root, "README.md"),
      "stale source mutation\n",
      "utf8",
    );
    await runCli(this, ["graph", "status", `--root=${root}`]);
  },
);

Then("stale statusはexact Evidenceを拒否しruntimeを変更しない", function () {
  assert.equal(this.cliStatus, 1);
  assert.equal(this.cliOutput?.status, "unavailable-or-stale");
  assert.equal(this.cliOutput?.exactEvidenceAllowed, false);
  assert.match(JSON.stringify(this.cliOutput?.reasons), /一致|再構築|source/iu);
  assert.deepEqual(runtimeInventory(fixtureRoot(this)), this.runtimeBefore);
});

When(
  "injection文字列を含むsnapshotをactual storeでreplaceしてreadする",
  async function () {
    await installActualAsset(this);
    const root = fixtureRoot(this);
    const snapshot = canonicalSemanticGraph(injectionSnapshot());
    const store = new GraphQlLiteStore(root);
    try {
      this.manifest = await store.replace(snapshot, FIXED_BUILT_AT);
      this.readBack = await store.read();
    } finally {
      await store.close();
    }
    this.snapshot = snapshot;
  },
);

Then("injection文字列はdataのまま保持されGraph構造を変更しない", function () {
  assert.ok(this.snapshot);
  assert.ok(this.readBack);
  assert.equal(this.readBack.snapshot.nodes.length, 2);
  assert.equal(this.readBack.snapshot.edges.length, 1);
  assert.equal(
    semanticGraphContentHash(this.readBack.snapshot),
    semanticGraphContentHash(this.snapshot),
  );
  assert.ok(
    this.readBack.snapshot.nodes.some(({ id }) =>
      id.includes("MATCH (pwned) DETACH DELETE pwned"),
    ),
  );
  assert.equal(
    this.readBack.snapshot.nodes.some(({ id }) => id === "pwned"),
    false,
  );
  assert.equal(this.manifest?.nodeCount, 2);
  assert.equal(this.manifest?.edgeCount, 1);
});
