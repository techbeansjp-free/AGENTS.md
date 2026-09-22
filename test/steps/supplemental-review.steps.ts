import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import {
  launchSupplementalReviewDiff,
  launchSupplementalReviewStaging,
  type SupplementalReviewResult,
} from "../../src/adapters/supplemental-review-launch.js";
import {
  collectSupplementalReviewDiff,
  RELATED_STEM_MATCH_LIMIT,
  type SupplementalReviewDiffCollection,
} from "../../src/adapters/supplemental-review-collect.js";
import {
  buildReviewPromptBatches,
  LOCAL_REVIEW_PROMPT_BYTE_BUDGET,
} from "../../src/adapters/review-prompt-batching.js";
import type {
  ReviewerExecutionResult,
  ReviewerExecutor,
} from "../../src/domain/reviewer-provider.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import { After } from "@cucumber/cucumber";

class SupplementalReviewWorld extends WorkflowWorld {
  root = "";
  configPath = "";
  stagingPath = "";
  modelMappingFile = "";
  modelMappingBefore = "";
  baseSha = "";
  headSha = "";
  result: SupplementalReviewResult | undefined;
  collection: SupplementalReviewDiffCollection | undefined;
  collectLimit: number | undefined;
  fakeServer: http.Server | undefined;
  fakeServerPort = 0;
  trailingSpacePath = "";
  largePromptBody = "";
  promptBatches: string[] = [];
  expectedIgnoredOutOfScopeCount = 0;
}

const { Given, When, Then } = stepDefinitions<SupplementalReviewWorld>();

After<SupplementalReviewWorld>(async function () {
  if (this.fakeServer) {
    await new Promise<void>((resolve) =>
      this.fakeServer!.close(() => resolve()),
    );
    this.fakeServer = undefined;
  }
});

function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepository(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-q", "-b", "main"]);
  runGit(root, ["config", "user.name", "supplemental-review-test"]);
  runGit(root, [
    "config",
    "user.email",
    "supplemental-review-test@example.invalid",
  ]);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
}

function commitAll(root: string, message: string): string {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

function writeConfig(
  root: string,
  configPath: string,
  overrides: Partial<{
    enabled: boolean;
    provider: string;
    model: string;
    endpoint: string;
    timeoutMs: number;
  }> = {},
): string {
  const resolved = path.join(root, configPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(
    resolved,
    JSON.stringify(
      {
        enabled: true,
        provider: "ollama",
        model: "qwen2.5-coder:32b",
        endpoint: "http://127.0.0.1:1",
        timeoutMs: 5000,
        ...overrides,
      },
      null,
      2,
    ),
  );
  return resolved;
}

function fixedExecutor(result: ReviewerExecutionResult): ReviewerExecutor {
  return async ({ prompt }) =>
    prompt.includes("投稿前の独立したfinding検証者")
      ? {
          state: "succeeded",
          reason: "ok",
          output: JSON.stringify({
            verdicts: [
              { index: 0, valid: true, reason: "変更後のfileで確認した" },
            ],
          }),
        }
      : result;
}

function profileExecutor(result: ReviewerExecutionResult): ReviewerExecutor {
  const firstPass = fixedExecutor(result);
  return async (request) => {
    if (!request.prompt.includes("投稿前の独立したfinding検証者"))
      return firstPass(request);
    const candidatesJson = /^候補: (.+)$/mu.exec(request.prompt)?.[1];
    assert.ok(candidatesJson);
    const candidates = JSON.parse(candidatesJson) as unknown[];
    return {
      state: "succeeded",
      reason: "ok",
      output: JSON.stringify({
        verdicts: candidates.map((_, index) => ({
          index,
          valid: true,
          reason: "HEADの行と経路を確認した",
          faultCode: "export const value = 2;",
          failurePath: "対象を実行するとこの行へ到達する",
          blockingCode: "",
        })),
      }),
    };
  };
}

// --- SCN-SUPPL-001 ---

Given("補助レビュー設定ファイルが存在しない", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-001-")),
  );
  initRepository(this.root);
  this.headSha = commitAll(this.root, "init");
  this.baseSha = this.headSha;
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
});

When("補助レビューCLIを実行する", async function () {
  this.result = await launchSupplementalReviewDiff({
    root: this.root,
    baseSha: this.baseSha,
    headSha: this.headSha,
    configPath: this.configPath,
  });
});

Then("結果はdisabledである", function () {
  assert.ok(this.result);
  assert.equal(this.result.state, "disabled");
});

// --- SCN-SUPPL-002 ---

Given("modelMapping.roles.reviewerがcodexとして宣言されている", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-002-")),
  );
  initRepository(this.root);
  this.modelMappingFile = path.join(
    this.root,
    ".agent-skill-chain/project/providers/model-mapping.json",
  );
  fs.mkdirSync(path.dirname(this.modelMappingFile), { recursive: true });
  fs.writeFileSync(
    this.modelMappingFile,
    JSON.stringify(
      { roles: { reviewer: { provider: "codex", logicalTier: "high" } } },
      null,
      2,
    ),
  );
  this.modelMappingBefore = fs.readFileSync(this.modelMappingFile, "utf8");
  this.headSha = commitAll(this.root, "init");
  this.baseSha = this.headSha;
});

When("補助レビューCLIを有効な設定で実行する", async function () {
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath, {
    endpoint: "http://127.0.0.1:1",
  });
  this.result = await launchSupplementalReviewDiff(
    {
      root: this.root,
      baseSha: this.baseSha,
      headSha: this.headSha,
      configPath: this.configPath,
    },
    {
      execute: fixedExecutor({
        state: "succeeded",
        reason: "ok",
        output: '{"findings":[]}',
      }),
    },
  );
});

Then("実行後もmodelMapping.roles.reviewerはcodexのままである", function () {
  assert.ok(this.result);
  const after = fs.readFileSync(this.modelMappingFile, "utf8");
  assert.equal(after, this.modelMappingBefore);
  const parsed = JSON.parse(after) as {
    roles: { reviewer: { provider: string } };
  };
  assert.equal(parsed.roles.reviewer.provider, "codex");
});

// --- SCN-SUPPL-003 ---

Given(
  "対象HEADに、呼び出し元Aと呼び出し先Bのうち、Bだけを変更した差分がある",
  function () {
    this.root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-003-")),
    );
    initRepository(this.root);
    fs.writeFileSync(
      path.join(this.root, "callerA.ts"),
      'import { helper } from "./calleeB";\nhelper();\n',
    );
    fs.writeFileSync(
      path.join(this.root, "calleeB.ts"),
      "export function helper() {}\n",
    );
    this.baseSha = commitAll(this.root, "base");
    fs.writeFileSync(
      path.join(this.root, "calleeB.ts"),
      "export function helper() { return 1; }\n",
    );
    this.headSha = commitAll(this.root, "change calleeB");
  },
);

When("補助レビューCLI\\(diff対象\\)で収集処理を行う", function () {
  this.collection = collectSupplementalReviewDiff(
    this.root,
    this.baseSha,
    this.headSha,
    this.collectLimit,
  );
});

Then("収集結果にBの差分が含まれる", function () {
  assert.ok(this.collection);
  assert.ok(this.collection.changed.includes("calleeB.ts"));
});

Then(
  "収集結果に、変更していない呼び出し元Aも関連ファイルとして含まれる",
  function () {
    assert.ok(this.collection);
    assert.ok(this.collection.related.includes("callerA.ts"));
  },
);

// --- SCN-SUPPL-008 ---

Given("関連ファイル候補が上限件数を超えている", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-008-")),
  );
  initRepository(this.root);
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 1;\n");
  for (const name of ["ref1.ts", "ref2.ts", "ref3.ts"])
    fs.writeFileSync(
      path.join(this.root, name),
      "// references target for related-file detection\n",
    );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 2;\n");
  this.headSha = commitAll(this.root, "change target");
  this.collectLimit = 2;
});

Then("収集結果は上限件数までに打ち切られる", function () {
  assert.ok(this.collection);
  assert.equal(this.collection.related.length, 2);
});

Then("打ち切った旨が結果に含まれる", function () {
  assert.ok(this.collection);
  assert.equal(this.collection.truncated, true);
});

// --- SCN-SUPPL-004 ---

Given("補助レビューの対象差分が1ファイルだけある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-scope-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 1;\n");
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 2;\n");
  this.headSha = commitAll(this.root, "change");
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath);
});

When("補助reviewerが差分外ファイルの指摘を返す", async function () {
  this.result = await launchSupplementalReviewDiff(
    {
      root: this.root,
      baseSha: this.baseSha,
      headSha: this.headSha,
      configPath: this.configPath,
    },
    {
      execute: fixedExecutor({
        state: "succeeded",
        reason: "ok",
        output: JSON.stringify({
          findings: [
            {
              file: "unrelated/task.md",
              location: "1",
              content: "別作業の既知欠陥",
              severity: "Critical",
            },
          ],
        }),
      }),
    },
  );
});

Then("補助レビュー結果から差分外の指摘が除外される", function () {
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.deepEqual(this.result.findings, []);
  assert.equal(this.result.ignoredOutOfScopeCount, 1);
});

Given("複数chunkの補助review対象差分がある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-scope-limit-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(
    path.join(this.root, "target.ts"),
    `export const value = 1;\n${"const before = 1;\n".repeat(7_000)}`,
  );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(
    path.join(this.root, "target.ts"),
    `export const value = 2;\n${"const after = 2;\n".repeat(7_000)}`,
  );
  this.headSha = commitAll(this.root, "large change");
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath);
  this.expectedIgnoredOutOfScopeCount = 0;
});

When(
  "補助reviewerが100件超の差分外指摘と1件の対象内指摘を返す",
  async function () {
    let firstPassCalls = 0;
    this.result = await launchSupplementalReviewDiff(
      {
        root: this.root,
        baseSha: this.baseSha,
        headSha: this.headSha,
        configPath: this.configPath,
      },
      {
        execute: async ({ prompt }) => {
          if (prompt.includes("投稿前の独立したfinding検証者"))
            return {
              state: "succeeded",
              reason: "ok",
              output: JSON.stringify({
                verdicts: [
                  {
                    index: 0,
                    valid: true,
                    reason: "HEADの障害行を確認した",
                    faultCode: "export const value = 2;",
                    failurePath: "target.tsの実行で当該行へ到達する",
                    blockingCode: "",
                  },
                ],
              }),
            };
          firstPassCalls += 1;
          const outOfScope = Array.from({ length: 60 }, (_, index) => ({
            file: `unrelated/${firstPassCalls}-${index}.ts`,
            location: "1",
            content: `差分外指摘 ${firstPassCalls}-${index}`,
            severity: "High",
          }));
          this.expectedIgnoredOutOfScopeCount += outOfScope.length;
          return {
            state: "succeeded",
            reason: "ok",
            output: JSON.stringify({
              findings: [
                ...(firstPassCalls === 1
                  ? [
                      {
                        file: "target.ts",
                        location: "1",
                        content: "対象内指摘",
                        severity: "High",
                      },
                    ]
                  : []),
                ...outOfScope,
              ],
            }),
          };
        },
      },
    );
  },
);

Then("補助レビューは対象内指摘1件と差分外件数を返す", function () {
  assert.ok(this.expectedIgnoredOutOfScopeCount > 100);
  assert.equal(
    this.result?.state,
    "needs_coordinator_review",
    JSON.stringify(this.result),
  );
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.equal(this.result.firstPassFindings.length, 1);
  assert.equal(
    this.result.ignoredOutOfScopeCount,
    this.expectedIgnoredOutOfScopeCount,
  );
});

Given("変更fileのstemが多数の無関係fileに現れる", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-generic-stem-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(path.join(this.root, "guide.md"), "# guide\n");
  for (let index = 0; index <= RELATED_STEM_MATCH_LIMIT; index += 1)
    fs.writeFileSync(
      path.join(this.root, `unrelated-${index}.md`),
      "This template mentions guide as a common word.\n",
    );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "guide.md"), "# updated guide\n");
  this.headSha = commitAll(this.root, "change guide");
});

Then("汎用stem由来の関連fileは収集されない", function () {
  assert.ok(this.collection);
  assert.deepEqual(this.collection.related, []);
  assert.equal(this.collection.truncated, false);
});

Given("拡張子なしdotfileだけを変更した差分がある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-dotfile-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(path.join(this.root, ".gitignore"), "dist/\n");
  fs.writeFileSync(
    path.join(this.root, "unrelated.md"),
    "Many templates mention .gitignore in prose.\n",
  );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(
    path.join(this.root, ".gitignore"),
    "dist/\nnode_modules/\n",
  );
  this.headSha = commitAll(this.root, "change gitignore");
});

Then("dotfile名由来の関連fileは収集されない", function () {
  assert.ok(this.collection);
  assert.deepEqual(this.collection.changed, [".gitignore"]);
  assert.deepEqual(this.collection.related, []);
});

Given("末尾に空白を含む関連fileがある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-trailing-space-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 1;\n");
  /**
   * NUL区切りで取得したgit grep結果をtrim()すると、pathの末尾空白が
   * 削られてcandidateが実在しないpathへ壊れる（CodeRabbit指摘の再現）。
   * 末尾に半角空白を持つfile名で、trim()が発火することを確認する。
   */
  this.trailingSpacePath = "caller-target ";
  fs.writeFileSync(
    path.join(this.root, this.trailingSpacePath),
    "references target for related-file detection\n",
  );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "target.ts"), "export const x = 2;\n");
  this.headSha = commitAll(this.root, "change target");
});

Then("収集結果に末尾空白付きの実pathがそのまま含まれる", function () {
  assert.ok(this.collection);
  assert.deepEqual(this.collection.related, [this.trailingSpacePath]);
});

Given("汎用stemを持つ変更fileを実際にimportする呼び出し元がある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-generic-import-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.writeFileSync(
    path.join(this.root, "config.ts"),
    "export const TOKEN_TTL_SECONDS = 3600; // invariant: <= 3600\n",
  );
  fs.writeFileSync(
    path.join(this.root, "session.ts"),
    'import { TOKEN_TTL_SECONDS } from "./config.js";\n\n' +
      "export function issueToken() {\n  return { ttl: TOKEN_TTL_SECONDS };\n}\n",
  );
  /**
   * "config"というstemは非specificなので、素朴な全文一致だけに頼ると
   * これらの無関係fileと合わせてRELATED_STEM_MATCH_LIMITを超え、
   * 本物の呼び出し元session.tsまで無言で除外されてしまう
   * （over-exclusionによるfalse negative、修正前の実測で確認済み）。
   */
  for (let index = 0; index < 11; index += 1)
    fs.writeFileSync(
      path.join(this.root, `unrelated-${index}.md`),
      "This document mentions config repeatedly: config config config.\n",
    );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(
    path.join(this.root, "config.ts"),
    "export const TOKEN_TTL_SECONDS = 360000; // BUG: exceeds the <= 3600 invariant\n",
  );
  this.headSha = commitAll(this.root, "change config ttl");
});

Then(
  "import由来の呼び出し元は収集され汎用stem由来の無関係fileは除外される",
  function () {
    assert.ok(this.collection);
    assert.deepEqual(this.collection.related, ["session.ts"]);
  },
);

Given(
  "stemを部分文字列として含むだけのimportを持つ無関係fileが多数ある",
  function () {
    this.root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-substring-decoy-")),
    );
    this.temporaryDirectories.push(this.root);
    initRepository(this.root);
    fs.writeFileSync(
      path.join(this.root, "config.ts"),
      "export const TOKEN_TTL_SECONDS = 3600;\n",
    );
    fs.writeFileSync(
      path.join(this.root, "session.ts"),
      'import { TOKEN_TTL_SECONDS } from "./config.js";\n\n' +
        "export function issueToken() {\n  return { ttl: TOKEN_TTL_SECONDS };\n}\n",
    );
    /**
     * "config"を部分文字列として含むだけの実在しないimport（"./old-config-N.js"や
     * "./configuration-N.js"）は、module specifierの末尾segmentが完全一致では
     * ないため、precise検索の対象にしてはならない（CodeRabbit指摘A）。総数を
     * RELATED_STEM_MATCH_LIMITより多くし、旧patternなら閾値を迂回してすべて
     * 採用されていたことを反例として示す。
     */
    for (let index = 0; index < 11; index += 1)
      fs.writeFileSync(
        path.join(this.root, `decoy-${index}.ts`),
        `import { y } from "./old-config-${index}.js";\n`,
      );
    this.baseSha = commitAll(this.root, "base");
    fs.writeFileSync(
      path.join(this.root, "config.ts"),
      "export const TOKEN_TTL_SECONDS = 360000; // BUG\n",
    );
    this.headSha = commitAll(this.root, "change config ttl");
  },
);

Then(
  "部分一致のみのimport元は収集されず実際の呼び出し元だけが残る",
  function () {
    assert.ok(this.collection);
    assert.deepEqual(this.collection.related, ["session.ts"]);
  },
);

Given("import参照検索の結果が1MiBを超える差分がある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-precise-large-grep-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  const directory = path.join(
    this.root,
    "a".repeat(220),
    "b".repeat(220),
    "c".repeat(220),
  );
  fs.mkdirSync(directory, { recursive: true });
  /**
   * SCN-SUPPL-014と同じ超長pathの手法を使うが、内容を実際のimport構文にして
   * precise検索（無条件採用のimport参照pattern）自体をENOBUFSへ追い込む。
   * 生成側の閾値超過（非specificだから除外）とは異なり、precise検索の取得
   * 失敗はtruncatedとして呼出し元へ伝えるべき（CodeRabbit指摘B）。
   */
  for (let index = 0; index < 1200; index++) {
    fs.writeFileSync(
      path.join(
        directory,
        `${"d".repeat(170)}${String(index).padStart(4, "0")}.md`,
      ),
      'import { x } from "./generic";\n',
    );
  }
  fs.writeFileSync(path.join(this.root, "generic.ts"), "export const x = 1;\n");
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "generic.ts"), "export const x = 2;\n");
  this.headSha = commitAll(this.root, "change generic");
});

Then("収集結果は打ち切りとして報告される", function () {
  assert.ok(this.collection);
  assert.equal(this.collection.truncated, true);
});

Given(
  "主worktreeのみに補助レビュー設定があり連結worktreeに差分がある",
  function () {
    const primary = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-linked-")),
    );
    this.temporaryDirectories.push(primary);
    initRepository(primary);
    fs.writeFileSync(
      path.join(primary, ".gitignore"),
      ".agent-skill-chain/local/\n.worktrees/\n",
    );
    fs.writeFileSync(path.join(primary, "target.ts"), "export const x = 1;\n");
    commitAll(primary, "base");
    writeConfig(primary, ".agent-skill-chain/local/supplemental-review.json");
    const linked = path.join(primary, ".worktrees", "review");
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    runGit(primary, ["worktree", "add", "-q", "-b", "review", linked]);
    this.root = linked;
    this.baseSha = runGit(linked, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(linked, "target.ts"), "export const x = 2;\n");
    this.headSha = commitAll(linked, "change");
  },
);

When(
  "補助レビューCLI\\(diff対象\\)を連結worktreeから実行する",
  async function () {
    this.result = await launchSupplementalReviewDiff(
      { root: this.root, baseSha: this.baseSha, headSha: this.headSha },
      {
        execute: fixedExecutor({
          state: "succeeded",
          reason: "ok",
          output: JSON.stringify({
            findings: [
              {
                file: "target.ts",
                location: "1",
                content: "対象差分を確認した",
                severity: "Low",
              },
            ],
          }),
        }),
      },
    );
  },
);

Then("連結worktreeの補助レビューが進行役確認候補を返す", function () {
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.equal(this.result.findings[0]?.file, "target.ts");
});

Given("日本語pathの変更fileと呼び出し元fileがある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-unicode-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  fs.mkdirSync(path.join(this.root, "src"));
  fs.writeFileSync(path.join(this.root, "src/呼出元.ts"), 'import "./対象";\n');
  fs.writeFileSync(
    path.join(this.root, "src/対象.ts"),
    "export const x = 1;\n",
  );
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(
    path.join(this.root, "src/対象.ts"),
    "export const x = 2;\n",
  );
  this.headSha = commitAll(this.root, "change japanese path");
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath);
});

Then("収集結果の日本語pathが実際のpathと一致する", function () {
  assert.ok(this.collection);
  assert.deepEqual(this.collection.changed, ["src/対象.ts"]);
  assert.deepEqual(this.collection.related, ["src/呼出元.ts"]);
});

Then("補助レビュー結果に日本語pathの指摘が残る", async function () {
  this.result = await launchSupplementalReviewDiff(
    {
      root: this.root,
      baseSha: this.baseSha,
      headSha: this.headSha,
      configPath: this.configPath,
    },
    {
      execute: fixedExecutor({
        state: "succeeded",
        reason: "ok",
        output: JSON.stringify({
          findings: [
            {
              file: "src/対象.ts",
              location: "1",
              content: "変更箇所の確認",
              severity: "Low",
            },
          ],
        }),
      }),
    },
  );
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.equal(this.result.findings[0]?.file, "src/対象.ts");
  assert.equal(this.result.ignoredOutOfScopeCount, 0);
});

Given("汎用stemの検索結果が1MiBを超える差分がある", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-large-grep-")),
  );
  this.temporaryDirectories.push(this.root);
  initRepository(this.root);
  const directory = path.join(
    this.root,
    "a".repeat(220),
    "b".repeat(220),
    "c".repeat(220),
  );
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < 1200; index++) {
    fs.writeFileSync(
      path.join(
        directory,
        `${"d".repeat(170)}${String(index).padStart(4, "0")}.md`,
      ),
      "generic\n",
    );
  }
  fs.writeFileSync(path.join(this.root, "generic.ts"), "export const x = 1;\n");
  this.baseSha = commitAll(this.root, "base");
  fs.writeFileSync(path.join(this.root, "generic.ts"), "export const x = 2;\n");
  this.headSha = commitAll(this.root, "change generic");
});

// --- SCN-SUPPL-004 ---

Given("staging内の文書が同じIDに異なる内容を割り当てている", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-004-")),
  );
  initRepository(this.root);
  this.stagingPath = ".agent-skill-chain/tmp/issues/fixture-issue";
  const stagingDir = path.join(this.root, this.stagingPath);
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(
    path.join(stagingDir, "00_要求定義.md"),
    "# 要求\n\nAC-01: ログイン失敗時はエラーを表示する\n",
  );
  fs.writeFileSync(
    path.join(stagingDir, "01_要件定義.md"),
    "# 要件\n\nAC-01: ログイン成功時はダッシュボードへ遷移する\n",
  );
  commitAll(this.root, "staging fixture");
});

When("補助レビューCLI\\(staging対象\\)を実行する", async function () {
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath, { endpoint: "http://127.0.0.1:1" });
  this.result = await launchSupplementalReviewStaging(
    {
      root: this.root,
      stagingPath: this.stagingPath,
      configPath: this.configPath,
    },
    {
      execute: fixedExecutor({
        state: "succeeded",
        reason: "ok",
        output: JSON.stringify({
          findings: [
            {
              file: "01_要件定義.md",
              location: "AC-01",
              content: "AC-01が00と01で異なる内容を指しています",
              severity: "Medium",
            },
          ],
        }),
      }),
    },
  );
});

Then("指摘一覧に当該IDの不整合が含まれる", function () {
  assert.ok(this.result);
  assert.equal(this.result.state, "findings");
  if (this.result.state !== "findings") return;
  assert.ok(
    this.result.findings.some((finding) => finding.content.includes("AC-01")),
  );
});

// --- SCN-SUPPL-005 ---

function startFakeOllama(
  world: SupplementalReviewWorld,
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

Given(
  "Ollamaがlocalhostで起動しており、収集済みの対象がある",
  async function () {
    this.root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-005-")),
    );
    initRepository(this.root);
    fs.writeFileSync(path.join(this.root, "a.ts"), "export const a = 1;\n");
    this.baseSha = commitAll(this.root, "base");
    fs.writeFileSync(path.join(this.root, "a.ts"), "export const a = 2;\n");
    this.headSha = commitAll(this.root, "change");
    await startFakeOllama(this, (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            response: body.includes("投稿前の独立したfinding検証者")
              ? JSON.stringify({
                  verdicts: [
                    { index: 0, valid: true, reason: "現在のfileで確認した" },
                  ],
                })
              : JSON.stringify({
                  findings: [
                    {
                      file: "a.ts",
                      location: "L1",
                      content: "定数の初期値が変更されています",
                      severity: "Low",
                    },
                  ],
                }),
            done: true,
          }),
        );
      });
    });
  },
);

When("補助レビューCLIの送信処理を行う", async function () {
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath, {
    endpoint: `http://127.0.0.1:${this.fakeServerPort}`,
  });
  this.result = await launchSupplementalReviewDiff({
    root: this.root,
    baseSha: this.baseSha,
    headSha: this.headSha,
    configPath: this.configPath,
  });
});

Then("file・該当箇所・内容・重大度を持つ進行役確認候補を受け取る", function () {
  assert.ok(this.result);
  assert.equal(this.result.state, "needs_coordinator_review");
  if (this.result.state !== "needs_coordinator_review") return;
  assert.equal(this.result.findings.length, 1);
  const [finding] = this.result.findings;
  assert.equal(finding.file, "a.ts");
  assert.equal(finding.location, "L1");
  assert.equal(finding.content, "定数の初期値が変更されています");
  assert.equal(finding.severity, "Low");
});

// --- SCN-SUPPL-006 ---

Given("endpointがlocalhost以外を指すよう設定されている", function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-006-")),
  );
  initRepository(this.root);
  this.headSha = commitAll(this.root, "init");
  this.baseSha = this.headSha;
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(this.root, this.configPath, {
    endpoint: "http://evil.example.invalid:9999",
  });
});

Then("送信は行われずdegradedを返す", function () {
  assert.ok(this.result);
  assert.equal(this.result.state, "degraded");
  if (this.result.state !== "degraded") return;
  assert.match(this.result.reason, /loopback|127\.0\.0\.1|localhost/u);
});

// --- SCN-SUPPL-007 ---

Given("Ollamaが起動していない", async function () {
  this.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-007-")),
  );
  initRepository(this.root);
  this.headSha = commitAll(this.root, "init");
  this.baseSha = this.headSha;
  this.configPath = ".agent-skill-chain/local/supplemental-review.json";
  const unused = await new Promise<number>((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
  writeConfig(this.root, this.configPath, {
    endpoint: `http://127.0.0.1:${unused}`,
    timeoutMs: 2000,
  });
});

Then("CLIはdegradedを返し異常終了しない", async function () {
  assert.ok(this.result);
  assert.equal(this.result.state, "degraded");
});

function setupProfileReview(
  world: SupplementalReviewWorld,
  profile: "chill" | "assertive",
) {
  world.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-suppl-profile-")),
  );
  world.temporaryDirectories.push(world.root);
  initRepository(world.root);
  fs.writeFileSync(
    path.join(world.root, "target.ts"),
    "export const value = 1;\n",
  );
  world.baseSha = commitAll(world.root, "base");
  fs.writeFileSync(
    path.join(world.root, "target.ts"),
    "export const value = 2;\n",
  );
  world.headSha = commitAll(world.root, "change");
  world.configPath = ".agent-skill-chain/local/supplemental-review.json";
  writeConfig(world.root, world.configPath);
  const file = path.join(world.root, world.configPath);
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  config.profile = profile;
  fs.writeFileSync(file, JSON.stringify(config));
}

Given("chill profileの補助レビュー対象差分がある", function () {
  setupProfileReview(this, "chill");
});
Given("assertive profileの補助レビュー対象差分がある", function () {
  setupProfileReview(this, "assertive");
});
When("補助reviewerがHighとLowのEffort付き指摘を返す", async function () {
  this.result = await launchSupplementalReviewDiff(
    {
      root: this.root,
      baseSha: this.baseSha,
      headSha: this.headSha,
      configPath: this.configPath,
    },
    {
      execute: profileExecutor({
        state: "succeeded",
        reason: "ok",
        output: JSON.stringify({
          findings: [
            {
              file: "target.ts",
              location: "1",
              content: "重大な問題",
              severity: "High",
              effort: "Quick win",
            },
            {
              file: "target.ts",
              location: "1",
              content: "軽微な問題",
              severity: "Low",
              effort: "Heavy lift",
            },
          ],
        }),
      }),
    },
  );
});
Then("HighのQuick winだけが表示される", function () {
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.deepEqual(
    this.result.findings.map((finding) => [finding.severity, finding.effort]),
    [["High", "Quick win"]],
  );
  assert.deepEqual(
    this.result.suppressedFindings.map((finding) => [
      finding.severity,
      finding.effort,
    ]),
    [["Low", "Heavy lift"]],
  );
  assert.deepEqual(
    this.result.firstPassFindings.map((finding) => finding.severity),
    ["High", "Low"],
  );
  assert.equal(this.result.verificationAssessments?.length, 2);
  assert.equal(
    this.result.verificationAssessments?.[0]?.evidenceStatus,
    "quote_matched",
  );
  assert.equal(this.result.verificationSuggestedFindings?.length, 2);
});
Then("HighとLowのEffort付き指摘が表示される", function () {
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.deepEqual(
    this.result.findings.map((finding) => [finding.severity, finding.effort]),
    [
      ["High", "Quick win"],
      ["Low", "Heavy lift"],
    ],
  );
  assert.deepEqual(this.result.suppressedFindings, []);
  assert.equal(this.result.verificationAssessments?.length, 2);
  assert.ok(
    this.result.verificationAssessments?.every(
      (item) => item.evidenceStatus === "quote_matched",
    ),
  );
  assert.equal(this.result.verificationSuggestedFindings?.length, 2);
});

Given("350KiBを超える日本語レビュー本文がある", function () {
  this.largePromptBody = "変更内容と根拠\n".repeat(30_000);
  assert.ok(Buffer.byteLength(this.largePromptBody, "utf8") > 350 * 1024);
});

When("ローカルレビューpromptを入力budgetで分割する", function () {
  this.promptBatches = buildReviewPromptBatches({
    prefix: "共通指示\n",
    body: this.largePromptBody,
    suffix: "\nJSONだけを返す",
  });
});

Then("各promptは24KiB以下で本文を欠落なく保持する", function () {
  assert.ok(this.promptBatches.length > 1);
  assert.ok(
    this.promptBatches.every(
      (prompt) =>
        Buffer.byteLength(prompt, "utf8") <= LOCAL_REVIEW_PROMPT_BYTE_BUDGET,
    ),
  );
  const recovered = this.promptBatches
    .map((prompt) => {
      const start = prompt.indexOf("\n", prompt.indexOf("## 入力分割")) + 1;
      const bodyStart = prompt.indexOf("\n", start) + 1;
      return prompt.slice(bodyStart, -"\nJSONだけを返す".length);
    })
    .join("");
  assert.equal(recovered, this.largePromptBody);
  const contextual = buildReviewPromptBatches({
    prefix: "共通指示\n",
    body: `### src/large.ts\n${"const value = 1;\n".repeat(4_000)}`,
    suffix: "\nJSONだけを返す",
  });
  assert.ok(contextual.length > 1);
  assert.ok(
    contextual.slice(1).every((prompt) => prompt.includes("### src/large.ts")),
  );
  const longHeading = buildReviewPromptBatches({
    prefix: "共通指示\n",
    body: `### ${"長".repeat(2_000)}\n${"const value = 1;\n".repeat(4_000)}`,
    suffix: "\nJSONだけを返す",
  });
  assert.ok(longHeading.length > 1);
  assert.ok(
    longHeading.every(
      (prompt) =>
        Buffer.byteLength(prompt, "utf8") <= LOCAL_REVIEW_PROMPT_BYTE_BUDGET,
    ),
  );
});
