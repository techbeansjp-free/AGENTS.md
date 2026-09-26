import assert from "node:assert/strict";
import { After, Before } from "@cucumber/cucumber";
import {
  dispatchJevChoice,
  type JevDispatchResult,
  type JevTransport,
} from "../../src/adapters/jev-http-client.js";
import type { JevProviderConfig } from "../../src/domain/jev-provider-config.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * **クラスfield initializerに頼らない。** `test/support/world.ts`は
 * `setWorldConstructor(WorkflowWorld)`だけを登録しており、このfileの
 * `JevHttpClientWorld`は実行時に一切インスタンス化されない（`this`への
 * 型付けのためだけのTypeScript上の便宜）。したがってfield initializerの
 * 既定値は実行時には効かず、`Before`hookで明示的に初期化する必要がある
 * （既存`jev-provider-config.steps.ts`の`root = ""`等が動く理由は、
 * 各scenarioのGivenが必ず`this.root`へ代入しているからであり、
 * 初期値そのものには依存していない）。
 */
class JevHttpClientWorld extends WorkflowWorld {
  config!: JevProviderConfig;
  state!: Record<string, unknown>;
  transportCalls!: Array<{
    url: string;
    body: unknown;
    headers: Record<string, string>;
  }>;
  transport!: JevTransport;
  result: JevDispatchResult | undefined = undefined;
  envVarName = "";
  previousEnvValue: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<JevHttpClientWorld>();

Before<JevHttpClientWorld>(function () {
  this.config = {
    enabled: true,
    apiKeyEnvVar: "JEV_HTTP_TEST_KEY",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
  };
  this.state = { context: "test" };
  this.transportCalls = [];
  this.transport = async () => {
    throw new Error("transport not configured for this scenario");
  };
});

function setEnvVar(world: JevHttpClientWorld, name: string, value: string) {
  world.envVarName = name;
  world.previousEnvValue = process.env[name];
  process.env[name] = value;
}

After<JevHttpClientWorld>(function () {
  if (this.envVarName !== "") {
    if (this.previousEnvValue === undefined)
      delete process.env[this.envVarName];
    else process.env[this.envVarName] = this.previousEnvValue;
  }
});

function fakeJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

Given(
  "jev-latestのconfigとfakeなok transportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-test-not-real");
    this.transport = async (url, init) => {
      this.transportCalls.push({
        url,
        body: JSON.parse(init.body),
        headers: init.headers as Record<string, string>,
      });
      return fakeJsonResponse(200, {
        model: "jev-1.13.0",
        answers: {
          q: {
            type: "choice",
            choice: "a",
            confidence: 0.8,
            probabilities: { a: 0.8 },
          },
        },
        usage: { input_tokens: 5, output_tokens: 1 },
      });
    };
  },
);

Given(
  "env varが未設定のconfigとfakeなtransportがある",
  function (this: JevHttpClientWorld) {
    this.config = {
      ...this.config,
      apiKeyEnvVar: "JEV_HTTP_TEST_KEY_UNSET_002",
    };
    delete process.env[this.config.apiKeyEnvVar];
    this.transport = async () => {
      this.transportCalls.push({
        url: "should-not-be-called",
        body: null,
        headers: {},
      });
      return fakeJsonResponse(200, {});
    };
  },
);

Given(
  "egress違反のstateとfakeなtransportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-test-not-real");
    this.state = { apiKey: "should-not-be-sent" };
    this.transport = async () => {
      this.transportCalls.push({
        url: "should-not-be-called",
        body: null,
        headers: {},
      });
      return fakeJsonResponse(200, {});
    };
  },
);

Given("例外を投げるfakeなtransportがある", function (this: JevHttpClientWorld) {
  setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-test-not-real");
  this.transport = async () => {
    throw new Error("simulated network failure");
  };
});

Given("401を返すfakeなtransportがある", function (this: JevHttpClientWorld) {
  setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-test-not-real");
  this.transport = async () =>
    fakeJsonResponse(401, {
      detail: { error_type: "authentication_error", message: "bad key" },
    });
});

Given(
  "retry-after headerを持つ429を返すfakeなtransportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-test-not-real");
    this.transport = async () =>
      fakeJsonResponse(429, {}, { "retry-after": "5" });
  },
);

Given(
  "秘密値を持つconfigとfakeなok transportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-super-secret-must-not-leak-9f3c");
    this.transport = async (url, init) => {
      this.transportCalls.push({
        url,
        body: JSON.parse(init.body),
        headers: init.headers as Record<string, string>,
      });
      return fakeJsonResponse(200, {
        model: "jev-1.13.0",
        answers: {
          q: {
            type: "choice",
            choice: "a",
            confidence: 0.5,
            probabilities: { a: 0.5 },
          },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
  },
);

When("dispatchJevChoiceを実行する", async function (this: JevHttpClientWorld) {
  this.result = await dispatchJevChoice({
    config: this.config,
    question: { key: "q", options: ["a", "b"], criteria: { a: "x", b: "y" } },
    state: this.state,
    transport: this.transport,
  });
});

Then(
  "outcomeはokであり送信したbodyのmodelとquestion keyが正しい",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "ok");
    assert.equal(this.transportCalls.length, 1);
    const body = this.transportCalls[0].body as {
      model: string;
      questions: Record<string, unknown>;
    };
    assert.equal(body.model, "jev-latest");
    assert.deepEqual(Object.keys(body.questions), ["q"]);
  },
);

Then(
  "outcomeはauth-errorでtransportは呼ばれない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "auth-error");
    assert.equal(this.transportCalls.length, 0);
  },
);

Then(
  "outcomeはschema-errorでtransportは呼ばれない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "schema-error");
    assert.equal(this.transportCalls.length, 0);
  },
);

Then(
  "outcomeはnetwork-errorであり呼び出しは例外を投げない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "network-error");
  },
);

Then("dispatch outcomeはauth-errorである", function (this: JevHttpClientWorld) {
  assert.equal(this.result?.outcome.kind, "auth-error");
});

Then(
  "outcomeはrate-limitedでretryAfterMsが5000である",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "rate-limited");
    assert.ok(
      this.result?.outcome.kind === "rate-limited" &&
        this.result.outcome.retryAfterMs === 5000,
    );
  },
);

Then(
  "Authorization headerには秘密値のBearer tokenが渡り戻り値には秘密値が含まれない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.transportCalls.length, 1);
    assert.equal(
      this.transportCalls[0].headers.Authorization,
      "Bearer sk-super-secret-must-not-leak-9f3c",
    );
    assert.ok(
      !JSON.stringify(this.result).includes(
        "sk-super-secret-must-not-leak-9f3c",
      ),
    );
  },
);

// --- 独立security review L1 -------------------------------------------------

Given(
  "改行を含む秘密値を持つconfigとfakeなtransportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-newline-secret-7b21\nX: y");
    this.transport = async () => {
      this.transportCalls.push({
        url: "should-not-be-called",
        body: null,
        headers: {},
      });
      return fakeJsonResponse(200, {});
    };
  },
);

Given(
  "秘密値を含むmessageで例外を投げるfakeなtransportがある",
  function (this: JevHttpClientWorld) {
    setEnvVar(this, "JEV_HTTP_TEST_KEY", "sk-thrown-secret-4e8d");
    this.transport = async (_url, init) => {
      const error = new TypeError(
        `Headers.append: "${init.headers.Authorization}" is an invalid header value`,
      ) as TypeError & { code?: string };
      error.code = "ERR_INVALID_CHAR";
      throw error;
    };
  },
);

Then(
  "outcomeはauth-errorでtransportは呼ばれずdetailに秘密値が含まれない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "auth-error");
    assert.equal(this.transportCalls.length, 0);
    assert.ok(!JSON.stringify(this.result).includes("sk-newline-secret-7b21"));
  },
);

Then(
  "outcomeはnetwork-errorでdetailは固定文言でありmessageも秘密値も含まない",
  function (this: JevHttpClientWorld) {
    assert.equal(this.result?.outcome.kind, "network-error");
    assert.ok(
      this.result?.outcome.kind === "network-error" &&
        this.result.outcome.detail ===
          "transport error (TypeError/ERR_INVALID_CHAR)",
    );
    const serialized = JSON.stringify(this.result);
    assert.ok(!serialized.includes("sk-thrown-secret-4e8d"));
    assert.ok(!serialized.includes("Headers.append"));
  },
);
