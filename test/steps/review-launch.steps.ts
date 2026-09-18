import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  resolveReviewRouting,
  type ReviewRoutingDecision,
  type ReviewRoutingResolutionInput,
} from "../../src/domain/review-routing.js";
import {
  PROVIDER_AUTONOMOUS_CEILINGS,
  validateProviderSelection,
} from "../../src/domain/role.js";
import {
  executeLocalLlm,
  type LocalLlmExecutionResult,
} from "../../src/adapters/local-llm-execution.js";
import { launchReview } from "../../src/adapters/review-launch.js";
import type {
  LocalLlmReviewerRoleModelChoice,
  ModelMappingChoice,
} from "../../src/types.js";
import { git } from "../../src/lib/process.js";
import { After } from "@cucumber/cucumber";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type ProviderSelectionInput = Parameters<typeof validateProviderSelection>[0];
type ProviderSelectionResult = ReturnType<typeof validateProviderSelection>;

class ReviewLaunchWorld extends WorkflowWorld {
  providerInput: ProviderSelectionInput | undefined;
  providerResult: ProviderSelectionResult | undefined;
  routingInput: ReviewRoutingResolutionInput | undefined;
  routingDecision: ReviewRoutingDecision | undefined;
  launchRoot = "";
  launchResult: Awaited<ReturnType<typeof launchReview>> | undefined;
  executionResult: LocalLlmExecutionResult | undefined;
  fakeServer: http.Server | undefined;
  fakeServerPort = 0;
  cliResult: SpawnSyncReturns<string> | undefined;
}

const { Given, When, Then } = stepDefinitions<ReviewLaunchWorld>();

After<ReviewLaunchWorld>(async function () {
  if (this.fakeServer) {
    await new Promise<void>((resolve) =>
      this.fakeServer!.close(() => resolve()),
    );
    this.fakeServer = undefined;
  }
});

function baseModelMapping(
  reviewer: ModelMappingChoice["roles"]["reviewer"],
): ModelMappingChoice {
  return {
    roles: {
      coordinator: {
        provider: "codex",
        logicalTier: "project_default",
        reasoningEffort: "high",
        speed: "standard",
      },
      implementer: {
        provider: "codex",
        logicalTier: "highest_available",
        reasoningEffort: "high",
        speed: "standard",
      },
      reviewer,
    },
    fallback: {
      when: "implementer_unavailable",
      role: "coordinator",
      modelSelection: "project_default",
    },
    evidenceStoreRoot: ".agent-skill-chain/role-log/",
    retention: {
      retentionDays: 30,
      maxRecordsPerIssue: 64,
      maxRecordBytes: 65536,
      rotationCondition: "oldest_first",
      deletionMethod: "preview_then_explicit",
    },
    tierMapping: {},
    minimumTierByRisk: {},
  };
}

const OLLAMA_MODEL = PROVIDER_AUTONOMOUS_CEILINGS.ollama!.allowed[0]!;

function reviewRoutingInput(
  overrides: Partial<ReviewRoutingResolutionInput> = {},
  reviewerOverrides: Partial<LocalLlmReviewerRoleModelChoice> = {},
): ReviewRoutingResolutionInput {
  const reviewer: LocalLlmReviewerRoleModelChoice = {
    provider: "ollama",
    mode: "supplement",
    endpoint: "http://127.0.0.1:11434",
    model: OLLAMA_MODEL,
    independence: { differentFrom: "implementer" },
    ...reviewerOverrides,
  };
  return {
    scope: "issue-1425",
    coordinatorIdentity: "coord",
    implementerIdentity: "impl",
    reviewerIdentity: "review",
    implementerContext: "impl-context",
    reviewerContext: "review-context",
    modelMapping: baseModelMapping(reviewer),
    ...overrides,
  };
}

// --- Unit: provider ceiling ---

Given("PROVIDER_AUTONOMOUS_CEILINGSにollamaが登録されている", function () {
  assert.ok(PROVIDER_AUTONOMOUS_CEILINGS.ollama);
});

When("allowlist外のmodel名でvalidateProviderSelectionを実行する", function () {
  this.providerInput = {
    provider: "ollama",
    selection: "unapproved-model:999b",
    issue: 1425,
    scope: "issue-1425",
    now: "2026-09-18T00:00:00.000Z",
  };
  this.providerResult = validateProviderSelection(this.providerInput);
});

When("allowlist内のmodel名でvalidateProviderSelectionを実行する", function () {
  this.providerInput = {
    provider: "ollama",
    selection: OLLAMA_MODEL,
    issue: 1425,
    scope: "issue-1425",
    now: "2026-09-18T00:00:00.000Z",
  };
  this.providerResult = validateProviderSelection(this.providerInput);
});

Then(
  "providerの自律選択上限を超えるため人間overrideが必要として拒否される",
  function () {
    assert.ok(this.providerResult);
    assert.equal(this.providerResult.valid, false);
    assert.match(
      this.providerResult.errors.join(" "),
      /未承認の選択値|人間overrideが必要/u,
    );
  },
);

Then("providerの自律選択は許可される", function () {
  assert.ok(this.providerResult);
  assert.equal(this.providerResult.valid, true);
});

// --- Unit: resolveReviewRouting ---

Given("ollamaを正しく構成したreviewer routing入力がある", function () {
  this.routingInput = reviewRoutingInput();
});

Given(
  "implementerとreviewerに同一identityを割り当てたreviewer routing入力がある",
  function () {
    this.routingInput = reviewRoutingInput({ reviewerIdentity: "impl" });
  },
);

Given(
  "implementerとreviewerに同一contextを割り当てたreviewer routing入力がある",
  function () {
    this.routingInput = reviewRoutingInput({
      reviewerContext: "impl-context",
    });
  },
);

Given("modelMappingが未設定のreviewer routing入力がある", function () {
  this.routingInput = reviewRoutingInput({ modelMapping: undefined });
});

Given(
  "ローカルLLM未設定（既存Codex形状）のreviewer routing入力がある",
  function () {
    const agentReviewer = {
      provider: "codex",
      logicalTier: "project_default" as const,
      reasoningEffort: "high" as const,
      speed: "standard" as const,
      independence: { differentFrom: "implementer" as const },
    };
    this.routingInput = {
      scope: "issue-1425",
      coordinatorIdentity: "coord",
      implementerIdentity: "impl",
      reviewerIdentity: "review",
      implementerContext: "impl-context",
      reviewerContext: "review-context",
      modelMapping: baseModelMapping(agentReviewer),
    };
  },
);

Given("allowlist外のmodelを指定したreviewer routing入力がある", function () {
  this.routingInput = reviewRoutingInput(
    {},
    { model: "unapproved-model:999b" },
  );
});

Given("不正なmode文字列を指定したreviewer routing入力がある", function () {
  const input = reviewRoutingInput();
  const reviewer = (input.modelMapping as ModelMappingChoice).roles
    .reviewer as unknown as Record<string, unknown>;
  reviewer.mode = "invalid-mode";
  this.routingInput = input;
});

Given(
  "mode fieldを保有するが未知providerのreviewer routing入力がある",
  function () {
    // schema検証を経ない不正入力を模擬する（独立レビューREV-06: 実行時防御の反例）。
    const input = reviewRoutingInput();
    const reviewer = (input.modelMapping as ModelMappingChoice).roles
      .reviewer as unknown as Record<string, unknown>;
    reviewer.provider = "unknown-local-llm";
    this.routingInput = input;
  },
);

Given(
  "loopback以外のendpointを指定したreviewer routing入力がある",
  function () {
    this.routingInput = reviewRoutingInput(
      {},
      { endpoint: "http://evil.example.invalid:11434" },
    );
  },
);

Given(
  "localhostホストのendpointを指定したreviewer routing入力がある",
  function () {
    this.routingInput = reviewRoutingInput(
      {},
      { endpoint: "http://localhost:11434" },
    );
  },
);

When("resolveReviewRoutingを実行する", function () {
  assert.ok(this.routingInput);
  this.routingDecision = resolveReviewRouting(this.routingInput);
});

Then(
  "reviewer routingはresolved状態でprovider・model・modeを返す",
  function () {
    assert.ok(this.routingDecision);
    assert.equal(this.routingDecision.state, "resolved");
    if (this.routingDecision.state === "resolved") {
      assert.equal(this.routingDecision.provider, "ollama");
      assert.equal(this.routingDecision.model, OLLAMA_MODEL);
      assert.equal(this.routingDecision.mode, "supplement");
    }
  },
);

Then("reviewer routingはrejected状態を返す", function () {
  assert.ok(this.routingDecision);
  assert.equal(this.routingDecision.state, "rejected");
});

Then("reviewer routingはpending状態を返す", function () {
  assert.ok(this.routingDecision);
  assert.equal(this.routingDecision.state, "pending");
});

// --- Integration: executeLocalLlm against a fake HTTP server ---

function startFakeOllama(
  world: ReviewLaunchWorld,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      world.fakeServerPort =
        typeof address === "object" && address !== null ? address.port : 0;
      world.fakeServer = server;
      resolve();
    });
  });
}

Given("正常応答するfake Ollamaサーバーがある", async function () {
  await startFakeOllama(this, (req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: "指摘なし", done: true }));
    });
  });
});

Given("応答しないfake Ollamaサーバーがある", async function () {
  await startFakeOllama(this, () => {
    /* 応答しない: クライアント側のtimeoutを検証する */
  });
});

Given("容量上限を超える応答をするfake Ollamaサーバーがある", async function () {
  await startFakeOllama(this, (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ response: "x".repeat(200), done: true }));
  });
});

Given("redirect応答をするfake Ollamaサーバーがある", async function () {
  await startFakeOllama(this, (req, res) => {
    res.writeHead(302, { location: "http://evil.example.invalid/steal" });
    res.end();
  });
});

When("executeLocalLlmを実行する", async function () {
  assert.ok(this.fakeServer);
  this.executionResult = await executeLocalLlm(
    {
      endpoint: `http://127.0.0.1:${this.fakeServerPort}`,
      model: OLLAMA_MODEL,
      prompt: "review this diff",
    },
    { timeoutMs: 500, maxOutputBytes: 64 },
  );
});

Then("実行結果はsucceededである", function () {
  assert.ok(this.executionResult);
  assert.equal(this.executionResult.state, "succeeded");
});

Then("実行結果はunknownである", function () {
  assert.ok(this.executionResult);
  assert.equal(this.executionResult.state, "unknown");
});

Then("実行結果はfailedである", function () {
  assert.ok(this.executionResult);
  assert.equal(this.executionResult.state, "failed");
});

// --- Integration: launchReview with a trusted policy git fixture ---

function commitTrusted(root: string): void {
  git(["add", ".agent-skill-chain"], root);
  git(["commit", "-q", "-m", "trusted fixture", "--allow-empty"], root);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], root);
  git(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    root,
  );
}

/**
 * macOSでは`os.tmpdir()`が`/var`（`/private/var`のsymlink）配下を返すため、
 * `fs.realpathSync(root) !== root`によるsymlink祖先拒否（`readPrompt`のTOCTOU対策）に
 * 素通りせず引っかかる。fixture生成時点でrealpathへ解決し、既存実装の安全側動作は変えない。
 */
function writeTrustedReviewerFixture(
  root: string,
  reviewer: ModelMappingChoice["roles"]["reviewer"],
): void {
  const namespace = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(namespace, { recursive: true });
  for (const relative of ["project", "policy"])
    fs.cpSync(
      path.resolve(".agent-skill-chain", relative),
      path.join(namespace, relative),
      { recursive: true },
    );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/project-policy.json"),
    path.join(namespace, "project-policy.json"),
  );
  const developmentPath = path.join(
    namespace,
    "project/choices/development.json",
  );
  const development = JSON.parse(
    fs.readFileSync(developmentPath, "utf8"),
  ) as Record<string, unknown>;
  const modelMapping = development.modelMapping as Record<string, unknown>;
  const roles = modelMapping.roles as Record<string, unknown>;
  roles.reviewer = reviewer;
  fs.writeFileSync(
    developmentPath,
    JSON.stringify(development, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "review.txt"),
    "review this diff for cross-file consistency",
  );
  commitTrusted(root);
}

Given("ollamaを正しく構成したtrusted policy fixtureがある", function () {
  this.launchRoot = fs.realpathSync(this.initRepo());
  writeTrustedReviewerFixture(this.launchRoot, {
    provider: "ollama",
    mode: "supplement",
    endpoint: "http://127.0.0.1:11434",
    model: OLLAMA_MODEL,
    independence: { differentFrom: "implementer" },
  });
});

When("DIしたexecutorでlaunchReviewを実行する", async function () {
  this.launchResult = await launchReview(
    {
      root: this.launchRoot,
      scope: "issue-1425",
      coordinator: "a",
      implementer: "b",
      reviewer: "c",
      implementerContext: "b1",
      reviewerContext: "c1",
      promptFile: "review.txt",
    },
    {
      execute: async () => ({
        state: "succeeded",
        reason: "fake executor",
      }),
    },
  );
});

When(
  "trusted policyのcommit SHAを起動直前に変更してlaunchReviewを実行する",
  async function () {
    const promise = launchReview(
      {
        root: this.launchRoot,
        scope: "issue-1425",
        coordinator: "a",
        implementer: "b",
        reviewer: "c",
        implementerContext: "b1",
        reviewerContext: "c1",
        promptFile: "review.txt",
      },
      {
        execute: async () => {
          // dispatch直前にHEADを進め、再検証で不一致を起こす
          git(
            ["commit", "-q", "-m", "mid-flight change", "--allow-empty"],
            this.launchRoot,
          );
          return { state: "succeeded", reason: "fake executor" };
        },
      },
    );
    this.launchResult = await promise;
  },
);

Then("launchReviewはdispatched trueを返す", function () {
  assert.ok(this.launchResult);
  assert.equal(this.launchResult.dispatched, true);
});

Then("launchReviewはrejected状態を返す", function () {
  assert.ok(this.launchResult);
  assert.equal(this.launchResult.state, "rejected");
});

Given(
  "ollamaをreplaceモードで正しく構成したtrusted policy fixtureがある",
  function () {
    this.launchRoot = fs.realpathSync(this.initRepo());
    writeTrustedReviewerFixture(this.launchRoot, {
      provider: "ollama",
      mode: "replace",
      endpoint: "http://127.0.0.1:11434",
      model: OLLAMA_MODEL,
      independence: { differentFrom: "implementer" },
    });
    fs.writeFileSync(
      path.join(this.launchRoot, "review.txt"),
      "review this diff for cross-file consistency",
    );
  },
);

Given("ローカルLLM未設定のtrusted policy fixtureがある", function () {
  this.launchRoot = fs.realpathSync(this.initRepo());
  writeTrustedReviewerFixture(this.launchRoot, {
    provider: "codex",
    logicalTier: "project_default",
    reasoningEffort: "high",
    speed: "standard",
    independence: { differentFrom: "implementer" },
  });
});

// --- E2E: CLI regression ---

Given("build済みCLIでreviewerがローカルLLM未設定のprojectがある", function () {
  this.launchRoot = fs.realpathSync(this.initRepo());
  writeTrustedReviewerFixture(this.launchRoot, {
    provider: "codex",
    logicalTier: "project_default",
    reasoningEffort: "high",
    speed: "standard",
    independence: { differentFrom: "implementer" },
  });
});

When("CLIでrouting review-resolveを実行する", function () {
  this.cliResult = spawnSync(
    process.execPath,
    [
      path.resolve("dist/bin/agent-skill-chain.js"),
      "routing",
      "review-resolve",
      `--root=${this.launchRoot}`,
      "--scope=issue-1425",
      "--coordinator=a",
      "--implementer=b",
      "--reviewer=c",
      "--implementer-context=b1",
      "--reviewer-context=c1",
    ],
    { cwd: this.launchRoot, encoding: "utf8" },
  );
});

When("CLIで既存のrouting resolveを実行する", function () {
  this.cliResult = spawnSync(
    process.execPath,
    [
      path.resolve("dist/bin/agent-skill-chain.js"),
      "routing",
      "resolve",
      "--help",
    ],
    { cwd: this.launchRoot, encoding: "utf8" },
  );
});

Then("CLIは非0かつrejected状態のJSONを返す", function () {
  assert.ok(this.cliResult);
  assert.notEqual(this.cliResult.status, 0);
  const parsed = JSON.parse(this.cliResult.stdout) as { state: string };
  assert.equal(parsed.state, "rejected");
});

Then("既存のroutingコマンドは変わらず利用できる", function () {
  assert.ok(this.cliResult);
  assert.equal(this.cliResult.status, 0);
});
