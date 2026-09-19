import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchSupplementalReviewDiff,
  type SupplementalReviewResult,
} from "../../src/adapters/supplemental-review-launch.js";
import type { ReviewerExecutor } from "../../src/domain/reviewer-provider.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class VerificationWorld extends WorkflowWorld {
  root = "";
  baseSha = "";
  headSha = "";
  after = "";
  result: SupplementalReviewResult | undefined;
  verificationPrompt = "";
  reviewCalls = 0;
}

const { Given, When, Then } = stepDefinitions<VerificationWorld>();

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const cases: Record<string, [string, string]> = {
  SQLi修正: [
    "db.query(`SELECT * FROM users WHERE id = ${id}`);\n",
    "db.query('SELECT * FROM users WHERE id = ?', [id]);\n",
  ],
  nullガード追加: [
    "return user.name;\n",
    "if (user === null) return 'guest';\nreturn user.name;\n",
  ],
  "resource leak修正": [
    "const fd = fs.openSync(file, 'w');\nfs.writeSync(fd, data);\nfs.closeSync(fd);\n",
    "const fd = fs.openSync(file, 'w');\ntry { fs.writeSync(fd, data); } finally { fs.closeSync(fd); }\n",
  ],
  SQLi混入: [
    "db.query('SELECT * FROM users WHERE id = ?', [id]);\n",
    "db.query(`SELECT * FROM users WHERE id = ${id}`);\n",
  ],
  null未チェック: [
    "if (user === null) return 'guest';\nreturn user.name;\n",
    "return user.name;\n",
  ],
  "resource leak混入": [
    "const fd = fs.openSync(file, 'w');\ntry { fs.writeSync(fd, data); } finally { fs.closeSync(fd); }\n",
    "const fd = fs.openSync(file, 'w');\nfs.writeSync(fd, data);\nfs.closeSync(fd);\n",
  ],
  authz削除: [
    "if (!canEdit(user, resource)) throw new Error('forbidden');\nupdate(resource);\n",
    "update(resource);\n",
  ],
};

Given(
  "{string} の修正前後を持つ隔離Git repositoryがある",
  function (name: string) {
    const pair = cases[name];
    assert.ok(pair, name);
    this.reviewCalls = 0;
    this.root = fs.realpathSync(this.temp("asc-finding-verify-"));
    git(this.root, "init", "-q", "-b", "main");
    git(this.root, "config", "user.name", "Test");
    git(this.root, "config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(this.root, "target.ts"), pair[0]);
    git(this.root, "add", "target.ts");
    git(this.root, "commit", "-q", "-m", "base");
    this.baseSha = git(this.root, "rev-parse", "HEAD");
    this.after = pair[1];
    fs.writeFileSync(path.join(this.root, "target.ts"), this.after);
    git(this.root, "add", "target.ts");
    git(this.root, "commit", "-q", "-m", "change");
    this.headSha = git(this.root, "rev-parse", "HEAD");
    const config = path.join(
      this.root,
      ".agent-skill-chain/local/supplemental-review.json",
    );
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(
      config,
      JSON.stringify({
        enabled: true,
        provider: "ollama",
        model: "test",
        endpoint: "http://127.0.0.1:11434",
        timeoutMs: 5000,
      }),
    );
  },
);

async function review(world: VerificationWorld, valid: boolean | null) {
  const executor: ReviewerExecutor = async ({ prompt }) => {
    world.reviewCalls++;
    if (prompt.includes("投稿前の独立したfinding検証者")) {
      world.verificationPrompt = prompt;
      return {
        state: "succeeded",
        reason: "ok",
        output:
          valid === null
            ? "invalid"
            : JSON.stringify({
                verdicts: [
                  {
                    index: 0,
                    valid,
                    reason: valid
                      ? "現在も失敗経路がある"
                      : "修正後には成立しない",
                  },
                ],
              }),
      };
    }
    return {
      state: "succeeded",
      reason: "ok",
      output: JSON.stringify({
        findings: [
          {
            file: "target.ts",
            location: "1",
            content: "欠陥がある",
            severity: "High",
          },
        ],
      }),
    };
  };
  world.result = await launchSupplementalReviewDiff(
    { root: world.root, baseSha: world.baseSha, headSha: world.headSha },
    { execute: executor },
  );
}

When("初回reviewerが修正前の欠陥を再掲し検証者が却下する", async function () {
  await review(this, false);
});
When("初回reviewerが現在の欠陥を報告し検証者が確認する", async function () {
  await review(this, true);
});
When("検証者が不正な応答を返す", async function () {
  await review(this, null);
});

Then("補助レビューのfindingは空で検証入力に修正後fileが含まれる", function () {
  assert.equal(this.result?.state, "findings", JSON.stringify(this.result));
  if (this.result?.state !== "findings") return;
  assert.equal(this.result.findings.length, 0);
  assert.ok(this.verificationPrompt.includes(this.after));
  assert.equal(this.reviewCalls, 2);
});
Then("補助レビューにHigh findingが残る", function () {
  assert.equal(this.result?.state, "findings", JSON.stringify(this.result));
  if (this.result?.state !== "findings") return;
  assert.equal(this.result.findings.length, 1);
  assert.equal(this.result.findings[0]?.severity, "High");
  assert.equal(this.reviewCalls, 2);
});
Then("補助レビューはdegradedである", function () {
  assert.equal(this.result?.state, "degraded", JSON.stringify(this.result));
});
