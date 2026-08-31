import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { main } from "../../src/cli.js";
import { loadProjectPolicySet } from "../../src/domain/policy.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CandidateOutcome {
  valid: boolean;
  errors: string[];
  setHash?: string;
}

class PolicyFileTargetWorld extends WorkflowWorld {
  policyRoot = "";
  candidateManifests: string[] = [];
  outcomes: CandidateOutcome[] = [];
  workspaceSetHash = "";
  cliStatus: number | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<PolicyFileTargetWorld>();

function copyPolicySet(root: string): void {
  fs.mkdirSync(path.join(root, ".agent-skill-chain"), { recursive: true });
  fs.copyFileSync(
    ".agent-skill-chain/project-policy.json",
    path.join(root, ".agent-skill-chain/project-policy.json"),
  );
  fs.cpSync(
    ".agent-skill-chain/project",
    path.join(root, ".agent-skill-chain/project"),
    { recursive: true },
  );
}

function readManifest(root: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.join(root, ".agent-skill-chain/project-policy.json"),
    "utf8",
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * 候補manifestの生textを種別ごとに作る。
 *
 * **`schemaVersion`はmanifest v1のまま壊す。** `schemaVersion`自体を壊すと
 * legacy分岐へ入り、不正fieldを名指ししない診断が返る。
 */
function candidateTexts(root: string, kind: string): string[] {
  const manifest = readManifest(root);
  if (kind === "同一内容")
    return [
      fs.readFileSync(
        path.join(root, ".agent-skill-chain/project-policy.json"),
        "utf8",
      ),
    ];
  if (kind === "契約違反") {
    const policy = { ...(manifest.policy as Record<string, unknown>) };
    policy.merge = { mode: "NOT_A_MODE", branches: 123 };
    return [JSON.stringify({ ...manifest, policy }, undefined, 2)];
  }
  if (kind === "inventory不一致") {
    const ruleFiles = [
      ...(manifest.ruleFiles as string[]),
      "project/rules/absent.json",
    ];
    return [JSON.stringify({ ...manifest, ruleFiles }, undefined, 2)];
  }
  if (kind === "有効な3件") {
    const original = fs.readFileSync(
      path.join(root, ".agent-skill-chain/project-policy.json"),
      "utf8",
    );
    const policy = manifest.policy as Record<string, unknown>;
    const budgets = policy.budgets as Record<string, unknown>;
    const second = JSON.stringify(
      {
        ...manifest,
        policy: {
          ...policy,
          budgets: { ...budgets, localFeedbackMs: 111000 },
        },
      },
      undefined,
      2,
    );
    const third = JSON.stringify(
      {
        ...manifest,
        policy: {
          ...policy,
          budgets: { ...budgets, localFeedbackMs: 112000 },
        },
      },
      undefined,
      2,
    );
    return [original, second, third];
  }
  throw new Error(`未知の候補manifest種別です: ${kind}`);
}

Given(
  "実project policy setのrootと{string}の候補manifestがある",
  function (kind: string) {
    this.policyRoot = this.temp("asc-policy-file-target-");
    copyPolicySet(this.policyRoot);
    this.workspaceSetHash = loadProjectPolicySet(this.policyRoot).setHash;
    this.candidateManifests = candidateTexts(this.policyRoot, kind);
  },
);

Given(
  "trusted originを持つ隔離repositoryと{string}の候補manifestがある",
  function (kind: string) {
    this.policyRoot = this.initRepo();
    copyPolicySet(this.policyRoot);
    fs.mkdirSync(path.join(this.policyRoot, ".agent-skill-chain/policy"), {
      recursive: true,
    });
    fs.copyFileSync(
      ".agent-skill-chain/policy/default.json",
      path.join(this.policyRoot, ".agent-skill-chain/policy/default.json"),
    );
    for (const args of [
      ["add", "-A"],
      ["commit", "-q", "-m", "policy fixture"],
      ["update-ref", "refs/remotes/origin/main", "HEAD"],
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    ])
      spawnSync("git", args, { cwd: this.policyRoot });
    this.candidateManifests = candidateTexts(this.policyRoot, kind);
  },
);

When("候補manifestを与えてproject policy setを検証する", function () {
  this.outcomes = this.candidateManifests.map((manifestRaw) => {
    try {
      const set = loadProjectPolicySet(this.policyRoot, {
        manifest: JSON.parse(manifestRaw) as unknown,
        manifestRaw,
      });
      return { valid: true, errors: [], setHash: set.setHash };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  });
});

When("候補manifestへpolicy validate CLIを実行する", async function () {
  const candidate = path.join(this.policyRoot, "candidate.json");
  fs.writeFileSync(candidate, this.candidateManifests[0] ?? "");
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    this.cliStatus = await main([
      "policy",
      "validate",
      `--file=${candidate}`,
      `--root=${this.policyRoot}`,
    ]);
  } finally {
    process.stdout.write = write;
  }
});

Then("候補manifestの検証結果は{string}である", function (expected: string) {
  const outcome = this.outcomes[0];
  assert.ok(outcome);
  assert.equal(
    outcome.valid ? "合格" : "不合格",
    expected,
    outcome.errors.join("; "),
  );
});

Then("候補manifestの診断は{string}を含む", function (fragment: string) {
  const outcome = this.outcomes[0];
  assert.ok(outcome);
  assert.ok(
    outcome.errors.some((error) => error.includes(fragment)),
    `診断が${fragment}を含みません: ${outcome.errors.join("; ")}`,
  );
});

Then("候補setのhashは{string}", function (expectation: string) {
  const hashes = this.outcomes.map((outcome) => outcome.setHash);
  if (expectation === "3件とも互いに異なる") {
    assert.equal(hashes.length, 3);
    assert.ok(hashes.every((hash) => typeof hash === "string"));
    assert.equal(new Set(hashes).size, 3, hashes.join(", "));
    return;
  }
  if (expectation === "作業treeのsetと一致する") {
    assert.equal(hashes[0], this.workspaceSetHash);
    return;
  }
  if (expectation === "作業treeのsetと一致しない") {
    assert.notEqual(hashes[0], this.workspaceSetHash);
    return;
  }
  throw new Error(`未知のhash期待値です: ${expectation}`);
});

Then(
  "policy validate CLIの終了値は{string}である",
  function (expected: string) {
    assert.equal(typeof this.cliStatus, "number");
    if (expected === "0") assert.equal(this.cliStatus, 0);
    else assert.notEqual(this.cliStatus, 0);
  },
);
