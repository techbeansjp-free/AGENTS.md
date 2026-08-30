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
import {
  buildRepositorySemanticGraph,
  observeRepositoryGraphSource,
} from "../../src/adapters/repository-graph.js";
import { main } from "../../src/cli.js";
import {
  GraphFreshnessError,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  canonicalSemanticGraph,
  semanticGraphContentHash,
  type GraphDriftReason,
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
  nestedRoot?: string;
  installResult?: GraphQlLiteInstallResult;
  manifest?: GraphProjectionManifest;
  pointerBefore?: string;
  readBack?: GraphStoreReadResult;
  runtimeBefore?: readonly string[];
  snapshot?: SemanticGraphSnapshot;
  sourceBefore?: string;
  transportRequests?: TransportRequest[];
  expectedGeneration?: number;
  generationBefore?: readonly string[];
  generationAfterRenameFault?: readonly string[];
  generationAfterPrePublicationFault?: readonly string[];
  generationAfterPublishedFault?: readonly string[];
  generationAfterDurableFault?: readonly string[];
  pointerAfterPrePublicationFault?: string;
  pointerAfterRenameFault?: string;
  pointerAfterPublishedFault?: string;
  pointerAfterDurableFault?: string;
  prePublicationError?: Error;
  renamePublicationError?: Error;
  publishedPointerError?: Error;
  durablePointerError?: Error;
  publishedReadBack?: GraphStoreReadResult;
  orphanGenerationFile?: string;
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

function generationInventory(root: string): string[] {
  return filesBelow(path.join(root, GRAPH_RUNTIME, "generations")).map((file) =>
    path.basename(file),
  );
}

function assertFreshnessError(
  error: unknown,
  expectedReason: GraphDriftReason,
): asserts error is GraphFreshnessError {
  assert.ok(error instanceof GraphFreshnessError);
  assert.equal(error.code, "GRAPH_FRESHNESS_ERROR");
  assert.equal(error.exactEvidenceAllowed, false);
  assert.equal(error.recovery, "rebuild");
  assert.ok(error.reasons.includes(expectedReason));
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
    world.manifest = await store.replace(snapshot, FIXED_BUILT_AT, async () =>
      observeRepositoryGraphSource(root),
    );
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
    assert.throws(
      () => graphQlLiteAsset("win32", "x64"),
      /win32\/x64を未対応/u,
    );
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
  assert.match(
    JSON.stringify(this.cliOutput?.reasons),
    /一致|再構築|source|projection-drift/iu,
  );
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
      this.manifest = await store.replace(
        snapshot,
        FIXED_BUILT_AT,
        async () => snapshot.source,
      );
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

Given(
  "GraphQLite installにrepository内のsubdirectoryを指定した隔離projectがある",
  function () {
    const root = createProject(this);
    this.nestedRoot = path.join(root, "nested");
    fs.mkdirSync(this.nestedRoot, { mode: 0o700 });
  },
);

When(
  "subdirectory rootからGraphQLite install previewを実行する",
  async function () {
    assert.ok(this.nestedRoot);
    const unusedTransport = (async () => {
      this.transportRequests ??= [];
      this.transportRequests.push({
        url: "unexpected://transport-call",
        redirect: undefined,
      });
      throw new Error("root検証前にtransportが呼ばれました");
    }) as typeof fetch;
    this.error = await captureFailure(() =>
      installGraphQlLiteExtension(this.nestedRoot!, {
        apply: false,
        fetchAsset: unusedTransport,
      }),
    );
  },
);

Then("canonical worktree root違反を副作用前に拒否する", function () {
  assert.match(String(this.error), /canonical Git worktree top-level/u);
  assert.equal(this.transportRequests?.length, 0);
  assert.equal(
    fs.existsSync(
      path.join(fixtureRoot(this), ".agent-skill-chain", "runtime"),
    ),
    false,
  );
});

When(
  "actual storeのreadback後observerで正本sourceを変更する",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    const pointerFile = path.join(root, GRAPH_RUNTIME, "current.json");
    this.pointerBefore = fs.readFileSync(pointerFile, "utf8");
    this.generationBefore = generationInventory(root);
    const snapshot = buildRepositorySemanticGraph(root);
    const store = new GraphQlLiteStore(root);
    try {
      this.error = await captureFailure(() =>
        store.replace(snapshot, "2026-08-30T00:00:01.000Z", async () => {
          fs.appendFileSync(
            path.join(root, "README.md"),
            "source drift during publication\n",
            "utf8",
          );
          return observeRepositoryGraphSource(root);
        }),
      );
    } finally {
      await store.close();
    }
  },
);

Then(
  "source driftを型付きで拒否しpointer bytesとgeneration集合を維持する",
  function () {
    assertFreshnessError(this.error, "source-ahead");
    const root = fixtureRoot(this);
    assert.equal(
      fs.readFileSync(path.join(root, GRAPH_RUNTIME, "current.json"), "utf8"),
      this.pointerBefore,
    );
    assert.deepEqual(generationInventory(root), this.generationBefore);
    assert.deepEqual(pendingFiles(root), []);
  },
);

When(
  "privateなcurrent pointerをmalformed JSONにして完全再構築する",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    assert.ok(this.manifest);
    this.expectedGeneration = this.manifest.generation + 1;
    fs.writeFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "{malformed-private-pointer\n",
      { mode: 0o600 },
    );
    const snapshot = buildRepositorySemanticGraph(root);
    const store = new GraphQlLiteStore(root);
    try {
      this.manifest = await store.replace(
        snapshot,
        "2026-08-30T00:00:01.000Z",
        async () => observeRepositoryGraphSource(root),
      );
      this.readBack = await store.read();
    } finally {
      await store.close();
    }
  },
);

Then(
  "generation directoryの最大値から次世代を公開してreadbackできる",
  function () {
    assert.equal(this.manifest?.generation, this.expectedGeneration);
    assert.equal(this.readBack?.manifest.generation, this.expectedGeneration);
    assert.ok(this.readBack);
    assert.equal(
      semanticGraphContentHash(this.readBack.snapshot),
      this.manifest?.graphContentHash,
    );
    assert.deepEqual(pendingFiles(fixtureRoot(this)), []);
  },
);

When("current databaseを破損させて正本から完全再構築する", async function () {
  await prepareActualProjection(this);
  const root = fixtureRoot(this);
  assert.ok(this.manifest);
  this.expectedGeneration = this.manifest.generation + 1;
  const current = currentPointer(root);
  fs.writeFileSync(path.resolve(root, current.databaseFile), "corrupt", {
    mode: 0o600,
  });
  const snapshot = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  try {
    this.manifest = await store.replace(
      snapshot,
      "2026-08-30T00:00:01.000Z",
      async () => observeRepositoryGraphSource(root),
    );
    this.readBack = await store.read();
  } finally {
    await store.close();
  }
});

Then("corrupt databaseを参照せず次世代を公開してreadbackできる", function () {
  assert.equal(this.manifest?.generation, this.expectedGeneration);
  assert.equal(this.readBack?.manifest.generation, this.expectedGeneration);
  assert.ok(this.readBack);
  assert.equal(
    semanticGraphContentHash(this.readBack.snapshot),
    this.manifest?.graphContentHash,
  );
});

When("current pointerをsymlinkへ置換して完全再構築する", async function () {
  if (process.platform === "win32") return "skipped";
  await prepareActualProjection(this);
  const root = fixtureRoot(this);
  const pointerFile = path.join(root, GRAPH_RUNTIME, "current.json");
  const outside = path.join(this.temp("asc-pointer-outside-"), "current.json");
  fs.writeFileSync(outside, fs.readFileSync(pointerFile), { mode: 0o600 });
  fs.unlinkSync(pointerFile);
  fs.symlinkSync(outside, pointerFile);
  this.generationBefore = generationInventory(root);
  const snapshot = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  try {
    this.error = await captureFailure(() =>
      store.replace(snapshot, "2026-08-30T00:00:01.000Z", async () =>
        observeRepositoryGraphSource(root),
      ),
    );
  } finally {
    await store.close();
  }
});

Then(
  "unsafe current pointerを拒否しgeneration candidateを作らない",
  function () {
    assert.match(
      String(this.error),
      /symlinkでない通常file|シンボリックリンクによる境界外移動/u,
    );
    const root = fixtureRoot(this);
    assert.equal(
      fs
        .lstatSync(path.join(root, GRAPH_RUNTIME, "current.json"))
        .isSymbolicLink(),
      true,
    );
    assert.deepEqual(generationInventory(root), this.generationBefore);
    assert.deepEqual(pendingFiles(root), []);
  },
);

When("current pointerをgroup writableにして完全再構築する", async function () {
  if (process.platform === "win32" || process.getuid === undefined)
    return "skipped";
  await prepareActualProjection(this);
  const root = fixtureRoot(this);
  const pointerFile = path.join(root, GRAPH_RUNTIME, "current.json");
  fs.chmodSync(pointerFile, 0o660);
  this.generationBefore = generationInventory(root);
  const snapshot = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  try {
    this.error = await captureFailure(() =>
      store.replace(snapshot, "2026-08-30T00:00:01.000Z", async () =>
        observeRepositoryGraphSource(root),
      ),
    );
  } finally {
    await store.close();
  }
});

Then("unsafe permissionを拒否しgeneration candidateを作らない", function () {
  assert.match(String(this.error), /group\/world writable/u);
  const root = fixtureRoot(this);
  assert.notEqual(
    fs.lstatSync(path.join(root, GRAPH_RUNTIME, "current.json")).mode & 0o020,
    0,
  );
  assert.deepEqual(generationInventory(root), this.generationBefore);
  assert.deepEqual(pendingFiles(root), []);
});

When(
  "actual storeのgeneration公開直後・耐久化後とcurrent pointer公開直後・耐久化後にfaultを注入する",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    this.pointerBefore = fs.readFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "utf8",
    );
    this.generationBefore = generationInventory(root);

    const renameSnapshot = buildRepositorySemanticGraph(root);
    const renameStore = new GraphQlLiteStore(root, {
      faultCheckpoint: (checkpoint) => {
        this.calls.push(checkpoint);
        if (checkpoint === "after-generation-published")
          throw new Error(
            "injected crash after generation publication before directory sync",
          );
      },
    });
    try {
      this.renamePublicationError = await captureFailure(() =>
        renameStore.replace(
          renameSnapshot,
          "2026-08-30T00:00:01.000Z",
          async () => observeRepositoryGraphSource(root),
        ),
      );
    } finally {
      await renameStore.close();
    }
    this.pointerAfterRenameFault = fs.readFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "utf8",
    );
    this.generationAfterRenameFault = generationInventory(root);

    const current = currentPointer(root);
    const currentGeneration = Number(
      /^generation-(\d+)-/u.exec(path.basename(current.databaseFile))?.[1],
    );
    assert.equal(Number.isSafeInteger(currentGeneration), true);
    this.orphanGenerationFile = `generation-${currentGeneration + 1}-${"a".repeat(16)}-${"b".repeat(16)}.db`;
    const orphanGenerationPath = path.join(
      root,
      GRAPH_RUNTIME,
      "generations",
      this.orphanGenerationFile,
    );
    fs.copyFileSync(
      path.resolve(root, current.databaseFile),
      orphanGenerationPath,
    );
    fs.chmodSync(orphanGenerationPath, 0o600);

    const prePublicationSnapshot = buildRepositorySemanticGraph(root);
    const prePublicationStore = new GraphQlLiteStore(root, {
      faultCheckpoint: (checkpoint) => {
        this.calls.push(checkpoint);
        if (checkpoint === "after-generation-directory-sync")
          throw new Error("injected crash before current pointer publication");
      },
    });
    try {
      this.prePublicationError = await captureFailure(() =>
        prePublicationStore.replace(
          prePublicationSnapshot,
          "2026-08-30T00:00:01.000Z",
          async () => observeRepositoryGraphSource(root),
        ),
      );
    } finally {
      await prePublicationStore.close();
    }
    this.pointerAfterPrePublicationFault = fs.readFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "utf8",
    );
    this.generationAfterPrePublicationFault = generationInventory(root);

    const publishedSnapshot = buildRepositorySemanticGraph(root);
    const publishedStore = new GraphQlLiteStore(root, {
      faultCheckpoint: (checkpoint) => {
        this.calls.push(checkpoint);
        if (checkpoint === "after-current-pointer-published")
          throw new Error(
            "injected crash after current pointer publication before directory sync",
          );
      },
    });
    try {
      this.publishedPointerError = await captureFailure(() =>
        publishedStore.replace(
          publishedSnapshot,
          "2026-08-30T00:00:01.000Z",
          async () => observeRepositoryGraphSource(root),
        ),
      );
      this.publishedReadBack = await publishedStore.read();
    } finally {
      await publishedStore.close();
    }
    this.pointerAfterPublishedFault = fs.readFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "utf8",
    );
    this.generationAfterPublishedFault = generationInventory(root);

    const durableSnapshot = buildRepositorySemanticGraph(root);
    const durableStore = new GraphQlLiteStore(root, {
      faultCheckpoint: (checkpoint) => {
        this.calls.push(checkpoint);
        if (checkpoint === "after-current-pointer-durable")
          throw new Error(
            "injected crash after current pointer durable commit",
          );
      },
    });
    try {
      this.durablePointerError = await captureFailure(() =>
        durableStore.replace(
          durableSnapshot,
          "2026-08-30T00:00:02.000Z",
          async () => observeRepositoryGraphSource(root),
        ),
      );
      this.readBack = await durableStore.read();
    } finally {
      await durableStore.close();
    }
    this.pointerAfterDurableFault = fs.readFileSync(
      path.join(root, GRAPH_RUNTIME, "current.json"),
      "utf8",
    );
    this.generationAfterDurableFault = generationInventory(root);
  },
);

Then(
  "通常faultは公開前状態へ戻りhard crash残存世代をcurrentにせずpointer公開後も有効な参照を維持する",
  function () {
    assert.match(
      String(this.renamePublicationError),
      /injected crash after generation publication before directory sync/u,
    );
    assert.match(String(this.prePublicationError), /injected crash/u);
    assert.match(
      String(this.publishedPointerError),
      /injected crash after current pointer publication before directory sync/u,
    );
    assert.match(
      String(this.durablePointerError),
      /injected crash after current pointer durable commit/u,
    );
    assert.deepEqual(this.calls, [
      "after-generation-published",
      "after-generation-published",
      "after-generation-directory-sync",
      "after-generation-published",
      "after-generation-directory-sync",
      "after-current-pointer-published",
      "after-generation-published",
      "after-generation-directory-sync",
      "after-current-pointer-published",
      "after-current-pointer-durable",
    ]);
    assert.equal(this.pointerAfterRenameFault, this.pointerBefore);
    assert.deepEqual(this.generationAfterRenameFault, this.generationBefore);
    assert.equal(this.pointerAfterPrePublicationFault, this.pointerBefore);
    assert.equal(
      this.generationAfterPrePublicationFault?.length,
      (this.generationBefore?.length ?? 0) + 1,
    );
    assert.ok(this.orphanGenerationFile);
    assert.ok(
      this.generationAfterPrePublicationFault?.includes(
        this.orphanGenerationFile,
      ),
    );
    assert.notEqual(this.pointerAfterPublishedFault, this.pointerBefore);
    assert.equal(
      this.generationAfterPublishedFault?.length,
      (this.generationBefore?.length ?? 0) + 2,
    );
    assert.ok(this.publishedReadBack);
    assert.ok(this.pointerAfterPublishedFault);
    const root = fixtureRoot(this);
    const publishedPointer = JSON.parse(this.pointerAfterPublishedFault) as {
      databaseFile: string;
    };
    assert.notEqual(
      path.basename(publishedPointer.databaseFile),
      this.orphanGenerationFile,
    );
    assert.equal(
      fs.existsSync(path.resolve(root, publishedPointer.databaseFile)),
      true,
    );
    assert.equal(
      this.publishedReadBack.manifest.generation,
      Number(
        /^generation-(\d+)-/u.exec(
          path.basename(publishedPointer.databaseFile),
        )?.[1],
      ),
    );
    assert.notEqual(
      this.pointerAfterDurableFault,
      this.pointerAfterPublishedFault,
    );
    assert.equal(
      this.generationAfterDurableFault?.length,
      (this.generationBefore?.length ?? 0) + 3,
    );
    assert.ok(this.readBack);
    const current = currentPointer(root);
    assert.equal(fs.existsSync(path.resolve(root, current.databaseFile)), true);
    assert.equal(
      this.readBack.manifest.generation,
      Number(
        /^generation-(\d+)-/u.exec(path.basename(current.databaseFile))?.[1],
      ),
    );
    assert.deepEqual(pendingFiles(root), []);
  },
);

When(
  "current pointerのextension versionを未知versionへ改変して読む",
  async function () {
    await prepareActualProjection(this);
    const root = fixtureRoot(this);
    const pointerFile = path.join(root, GRAPH_RUNTIME, "current.json");
    const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8")) as {
      manifest: { extensionVersion: string };
    };
    pointer.manifest.extensionVersion = "99.0.0-untrusted";
    fs.writeFileSync(pointerFile, `${JSON.stringify(pointer)}\n`, {
      mode: 0o600,
    });
    const store = new GraphQlLiteStore(root);
    try {
      this.error = await captureFailure(() => store.read());
    } finally {
      await store.close();
    }
  },
);

Then("extension mismatchを型付きdrift reasonとして返す", function () {
  assertFreshnessError(this.error, "extension-mismatch");
});

When(
  "extensionだけinstallしたstoreからcurrent generationを読む",
  async function () {
    await installActualAsset(this);
    const store = new GraphQlLiteStore(fixtureRoot(this));
    try {
      this.error = await captureFailure(() => store.read());
    } finally {
      await store.close();
    }
  },
);

Then("missingを型付きdrift reasonとして返す", function () {
  assertFreshnessError(this.error, "missing");
});

When(
  "install後にsubdirectory rootからactual storeを構築する",
  async function () {
    await installActualAsset(this);
    const root = fixtureRoot(this);
    this.runtimeBefore = runtimeInventory(root);
    this.nestedRoot = path.join(root, "nested");
    fs.mkdirSync(this.nestedRoot, { mode: 0o700 });
    this.error = await captureFailure(async () => {
      const store = new GraphQlLiteStore(this.nestedRoot!);
      await store.close();
    });
  },
);

Then("storeはcanonical worktree root違反を副作用前に拒否する", function () {
  assert.match(String(this.error), /canonical Git worktree top-level/u);
  assert.deepEqual(runtimeInventory(fixtureRoot(this)), this.runtimeBefore);
});
