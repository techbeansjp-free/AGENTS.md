import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { After, Before } from "@cucumber/cucumber";
import {
  configureJevProviderConfig,
  appendJevApiKeyToShellRc,
  detectShellRcFile,
  type AppendJevApiKeyResult,
  type ConfigureJevProviderResult,
  type ShellRcDetection,
} from "../../src/adapters/jev-guided-setup.js";
import { JEV_PROVIDER_CONFIG_PATH } from "../../src/domain/jev-provider-config.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * **クラスfield initializerに頼らない。** `jev-http-client.steps.ts`と同じ
 * 理由で、`Before`hookが明示的に初期化する。
 */
class JevGuidedSetupWorld extends WorkflowWorld {
  root = "";
  endpoint = "";
  model = "";
  apiKeyEnvVar = "";
  configureResult: ConfigureJevProviderResult | undefined = undefined;
  shellEnv: NodeJS.ProcessEnv = {};
  detection: ShellRcDetection | undefined = undefined;
  rcPath = "";
  secretValue = "";
  envVarName = "";
  previousEnvValue: string | undefined = undefined;
  appendResult: AppendJevApiKeyResult | undefined = undefined;
  appendError: unknown = undefined;
}

const { Given, When, Then } = stepDefinitions<JevGuidedSetupWorld>();

Before<JevGuidedSetupWorld>(function () {
  this.root = "";
  this.endpoint = "https://api.typesafe.ai/v1/systemone";
  this.model = "jev-latest";
  this.apiKeyEnvVar = "JEV_SETUP_TEST_KEY";
  this.shellEnv = {};
  this.rcPath = "";
  this.secretValue = "sk-guided-setup-secret-must-not-leak";
  this.envVarName = "";
});

function setEnvVar(world: JevGuidedSetupWorld, name: string, value: string) {
  world.envVarName = name;
  world.previousEnvValue = process.env[name];
  process.env[name] = value;
}

After<JevGuidedSetupWorld>(function () {
  if (this.envVarName !== "") {
    if (this.previousEnvValue === undefined)
      delete process.env[this.envVarName];
    else process.env[this.envVarName] = this.previousEnvValue;
  }
});

Given(
  "空のrootとenv var未設定のconfigure入力がある",
  function (this: JevGuidedSetupWorld) {
    this.root = this.temp("asc-jevsetup-001-");
    delete process.env[this.apiKeyEnvVar];
  },
);

Given("空のrootとconfigure入力がある", function (this: JevGuidedSetupWorld) {
  this.root = this.temp("asc-jevsetup-002-");
});

Given(
  "httpのendpointを持つconfigure入力がある",
  function (this: JevGuidedSetupWorld) {
    this.root = this.temp("asc-jevsetup-003-");
    this.endpoint = "http://api.typesafe.ai/v1/systemone";
  },
);

Given(
  "小文字のapiKeyEnvVarを持つconfigure入力がある",
  function (this: JevGuidedSetupWorld) {
    this.root = this.temp("asc-jevsetup-004-");
    this.apiKeyEnvVar = "jev_api_key";
  },
);

When(
  "configureJevProviderConfigをdry-runで実行する",
  function (this: JevGuidedSetupWorld) {
    this.configureResult = configureJevProviderConfig({
      root: this.root,
      endpoint: this.endpoint,
      model: this.model,
      apiKeyEnvVar: this.apiKeyEnvVar,
      apply: false,
    });
  },
);

When(
  "configureJevProviderConfigをapplyで実行する",
  function (this: JevGuidedSetupWorld) {
    this.configureResult = configureJevProviderConfig({
      root: this.root,
      endpoint: this.endpoint,
      model: this.model,
      apiKeyEnvVar: this.apiKeyEnvVar,
      apply: true,
    });
  },
);

Then(
  "configPathにfileが存在せずresolutionはinvalidである",
  function (this: JevGuidedSetupWorld) {
    assert.equal(fs.existsSync(this.configureResult?.configPath ?? ""), false);
    assert.equal(this.configureResult?.resolution.state, "invalid");
  },
);

Then(
  "configPathに正しい内容のfileが生成される",
  function (this: JevGuidedSetupWorld) {
    const configPath = path.join(this.root, JEV_PROVIDER_CONFIG_PATH);
    assert.equal(this.configureResult?.applied, true);
    assert.equal(fs.existsSync(configPath), true);
    const written: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(written, {
      enabled: true,
      apiKeyEnvVar: this.apiKeyEnvVar,
      endpoint: this.endpoint,
      model: this.model,
    });
  },
);

Then(
  "書き込まれずvalidationErrorsが空でない",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.configureResult?.applied, false);
    assert.equal(fs.existsSync(this.configureResult?.configPath ?? ""), false);
    assert.ok((this.configureResult?.validationErrors.length ?? 0) > 0);
  },
);

Given("SHELLがfishを指す環境がある", function (this: JevGuidedSetupWorld) {
  this.shellEnv = { SHELL: "/bin/fish" };
});

Given("SHELLがbashを指す環境がある", function (this: JevGuidedSetupWorld) {
  this.shellEnv = { SHELL: "/bin/bash" };
});

When("shell rc検出を実行する", function (this: JevGuidedSetupWorld) {
  this.detection = detectShellRcFile(this.shellEnv, "/home/fixture");
});

Then("shell rc検出はokがfalseである", function (this: JevGuidedSetupWorld) {
  assert.equal(this.detection?.ok, false);
});

Then("shell rc検出は.bashrcを指す", function (this: JevGuidedSetupWorld) {
  assert.ok(
    this.detection?.ok === true && this.detection.rcPath.endsWith(".bashrc"),
  );
});

Given(
  "env var未設定でrc fileが存在しない",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    delete process.env[this.apiKeyEnvVar];
  },
);

Given(
  "env var設定済みでrc fileが存在しない",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    setEnvVar(this, this.apiKeyEnvVar, this.secretValue);
  },
);

Given(
  "既に対象env varのexport行を含むrc fileがある",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    fs.writeFileSync(
      this.rcPath,
      `export ${this.apiKeyEnvVar}=already-there\n`,
    );
    setEnvVar(this, this.apiKeyEnvVar, this.secretValue);
  },
);

When(
  "appendJevApiKeyToShellRcをapplyで実行する",
  function (this: JevGuidedSetupWorld) {
    this.appendResult = appendJevApiKeyToShellRc({
      apiKeyEnvVar: this.apiKeyEnvVar,
      rcPath: this.rcPath,
      apply: true,
    });
  },
);

When(
  "appendJevApiKeyToShellRcをdry-runで実行する",
  function (this: JevGuidedSetupWorld) {
    this.appendResult = appendJevApiKeyToShellRc({
      apiKeyEnvVar: this.apiKeyEnvVar,
      rcPath: this.rcPath,
      apply: false,
    });
  },
);

When(
  "confirmを指定せずappendJevApiKeyToShellRcをapplyで実行する",
  function (this: JevGuidedSetupWorld) {
    try {
      this.appendResult = appendJevApiKeyToShellRc({
        apiKeyEnvVar: this.apiKeyEnvVar,
        rcPath: this.rcPath,
        apply: true,
      });
    } catch (error) {
      this.appendError = error;
    }
  },
);

When(
  "confirmを指定してappendJevApiKeyToShellRcをapplyで実行する",
  function (this: JevGuidedSetupWorld) {
    this.appendResult = appendJevApiKeyToShellRc({
      apiKeyEnvVar: this.apiKeyEnvVar,
      rcPath: this.rcPath,
      apply: true,
      confirm: "APPEND",
    });
  },
);

Then(
  "追記は行われずenvVarSetInCurrentShellはfalseである",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, false);
    assert.equal(this.appendResult?.envVarSetInCurrentShell, false);
    assert.equal(fs.existsSync(this.rcPath), false);
  },
);

Then(
  "追記は行われず戻り値に秘密値が含まれない",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, false);
    assert.equal(fs.existsSync(this.rcPath), false);
    assert.ok(!JSON.stringify(this.appendResult).includes(this.secretValue));
  },
);

Then("呼び出しは例外を投げる", function (this: JevGuidedSetupWorld) {
  assert.ok(this.appendError instanceof Error);
  assert.ok(
    !String((this.appendError as Error).message).includes(this.secretValue),
  );
});

Then(
  "rc fileに秘密値を含むexport行が書き込まれ戻り値に秘密値が含まれない",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, true);
    const content = fs.readFileSync(this.rcPath, "utf8");
    assert.equal(content, `export ${this.apiKeyEnvVar}=${this.secretValue}\n`);
    assert.ok(!JSON.stringify(this.appendResult).includes(this.secretValue));
  },
);

Then(
  "追記は行われずalreadyPresentがtrueである",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, false);
    assert.equal(this.appendResult?.alreadyPresent, true);
    const content = fs.readFileSync(this.rcPath, "utf8");
    assert.equal(content, `export ${this.apiKeyEnvVar}=already-there\n`);
  },
);
