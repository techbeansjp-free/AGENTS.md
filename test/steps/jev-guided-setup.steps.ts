import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { After, Before } from "@cucumber/cucumber";
import {
  configureJevProviderConfig,
  appendJevApiKeyToShellRc,
  detectShellRcFile,
  jevSecretSourceLine,
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
  secretFilePath = "";
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
  this.secretFilePath = "";
  this.appendError = undefined;
  this.secretValue = "sk-guided-setup-secret-must-not-leak";
  this.envVarName = "";
});

function secretFileIn(directory: string): string {
  return path.join(directory, ".config", "agent-skill-chain", "jev.env");
}

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
    this.secretFilePath = secretFileIn(directory);
    delete process.env[this.apiKeyEnvVar];
  },
);

Given(
  "env var設定済みでrc fileが存在しない",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    this.secretFilePath = secretFileIn(directory);
    setEnvVar(this, this.apiKeyEnvVar, this.secretValue);
  },
);

Given(
  "既に対象env varのexport行を含むrc fileがある",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    this.secretFilePath = secretFileIn(directory);
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
      secretFilePath: this.secretFilePath,
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
      secretFilePath: this.secretFilePath,
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
        secretFilePath: this.secretFilePath,
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
      secretFilePath: this.secretFilePath,
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
    assert.equal(fs.existsSync(this.secretFilePath), false);
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
  "秘密値は0600の専用fileへ書かれrc fileにはsource行だけが追記され戻り値に秘密値が含まれない",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, true);
    assert.equal(
      fs.readFileSync(this.secretFilePath, "utf8"),
      `export ${this.apiKeyEnvVar}='${this.secretValue}'\n`,
    );
    assert.equal(fs.statSync(this.secretFilePath).mode & 0o777, 0o600);
    assert.equal(
      fs.statSync(path.dirname(this.secretFilePath)).mode & 0o077,
      0,
    );
    const rcContent = fs.readFileSync(this.rcPath, "utf8");
    assert.equal(rcContent, `${jevSecretSourceLine(this.secretFilePath)}\n`);
    assert.ok(!rcContent.includes(this.secretValue));
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
    assert.equal(fs.existsSync(this.secretFilePath), false);
  },
);

// --- 独立security review M1/M2/L2 -------------------------------------------

Given(
  "shell metacharacterとquoteを含む値がenv varに設定されrc fileが存在しない",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    this.secretFilePath = secretFileIn(directory);
    const marker = path.join(directory, "pwned");
    this.secretValue = `sk-$(touch ${marker})\`touch ${marker}\`'x;#y z`;
    setEnvVar(this, this.apiKeyEnvVar, this.secretValue);
  },
);

Given(
  "改行を含む値がenv varに設定されrc fileが存在しない",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    this.rcPath = path.join(directory, ".bashrc");
    this.secretFilePath = secretFileIn(directory);
    this.secretValue = "sk-line-one\nexport INJECTED=1";
    setEnvVar(this, this.apiKeyEnvVar, this.secretValue);
  },
);

Given(
  "JEV_で始まらないapiKeyEnvVarを持つconfigure入力がある",
  function (this: JevGuidedSetupWorld) {
    this.root = this.temp("asc-jevsetup-015-");
    this.apiKeyEnvVar = "GITHUB_TOKEN";
  },
);

When(
  "confirmを指定してappendJevApiKeyToShellRcをapplyで2回実行する",
  function (this: JevGuidedSetupWorld) {
    const input = {
      apiKeyEnvVar: this.apiKeyEnvVar,
      rcPath: this.rcPath,
      secretFilePath: this.secretFilePath,
      apply: true,
      confirm: "APPEND",
    };
    appendJevApiKeyToShellRc(input);
    this.appendResult = appendJevApiKeyToShellRc(input);
  },
);

When(
  "confirmを指定してappendJevApiKeyToShellRcをapplyで実行し例外を捕捉する",
  function (this: JevGuidedSetupWorld) {
    try {
      this.appendResult = appendJevApiKeyToShellRc({
        apiKeyEnvVar: this.apiKeyEnvVar,
        rcPath: this.rcPath,
        secretFilePath: this.secretFilePath,
        apply: true,
        confirm: "APPEND",
      });
    } catch (error) {
      this.appendError = error;
    }
  },
);

Then(
  "専用fileの値はquoteされshellで読み込むと元の値に一致しコマンドは実行されない",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.applied, true);
    assert.equal(fs.statSync(this.secretFilePath).mode & 0o777, 0o600);
    const rcContent = fs.readFileSync(this.rcPath, "utf8");
    assert.equal(rcContent, `${jevSecretSourceLine(this.secretFilePath)}\n`);
    assert.ok(!rcContent.includes(this.secretValue));
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    const sourced = spawnSync(
      "sh",
      ["-c", `. "$1" && printf %s "$${this.apiKeyEnvVar}"`, "sh", this.rcPath],
      { encoding: "utf8", env },
    );
    assert.equal(sourced.status, 0, sourced.stderr);
    assert.equal(sourced.stdout, this.secretValue);
    const marker = path.join(path.dirname(this.rcPath), "pwned");
    assert.equal(fs.existsSync(marker), false);
    assert.ok(!JSON.stringify(this.appendResult).includes(this.secretValue));
  },
);

Then(
  "例外になりどのfileも書き込まれず例外messageに値が含まれない",
  function (this: JevGuidedSetupWorld) {
    assert.ok(this.appendError instanceof Error);
    assert.ok(!(this.appendError as Error).message.includes("sk-line-one"));
    assert.equal(fs.existsSync(this.rcPath), false);
    assert.equal(fs.existsSync(this.secretFilePath), false);
  },
);

Then(
  "2回目はalreadyPresentでrc fileのsource行は1行だけである",
  function (this: JevGuidedSetupWorld) {
    assert.equal(this.appendResult?.alreadyPresent, true);
    assert.equal(this.appendResult?.applied, false);
    const sourceLine = jevSecretSourceLine(this.secretFilePath);
    const rcLines = fs
      .readFileSync(this.rcPath, "utf8")
      .split("\n")
      .filter((line) => line === sourceLine);
    assert.equal(rcLines.length, 1);
    const secretLines = fs
      .readFileSync(this.secretFilePath, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(`export ${this.apiKeyEnvVar}=`));
    assert.equal(secretLines.length, 1);
  },
);

Then(
  "JEV_で始まらないenv var名ではappendJevApiKeyToShellRcが例外を投げる",
  function (this: JevGuidedSetupWorld) {
    const directory = this.temp("asc-jevsetup-rc-");
    assert.throws(
      () =>
        appendJevApiKeyToShellRc({
          apiKeyEnvVar: "GITHUB_TOKEN",
          rcPath: path.join(directory, ".bashrc"),
          secretFilePath: secretFileIn(directory),
          apply: true,
          confirm: "APPEND",
        }),
      /JEV_/u,
    );
    assert.equal(fs.existsSync(path.join(directory, ".bashrc")), false);
  },
);
