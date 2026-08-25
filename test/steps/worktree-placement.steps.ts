import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createWorktree,
  matchesTargetWorktree,
  validateWorktreePlacement,
} from "../../src/domain/worktree.js";
import { validateProjectPolicyManifest } from "../../src/domain/policy.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

type PlacementResult = ReturnType<typeof validateWorktreePlacement>;

interface WorktreePlacementWorld extends WorkflowWorld {
  cleanupMatches?: boolean[];
  cliResult?: { status: number | null; stdout: string; stderr: string };
  remoteDefaultSha?: string;
  placementInput?: Parameters<typeof validateWorktreePlacement>[0];
  placementResult?: PlacementResult;
  placementResults?: PlacementResult[];
  policyValidationResults?: Array<{ valid: boolean; errors: string[] }>;
  sourceStatusBefore?: string;
  symlinkFixtures?: Array<{
    root: string;
    destination: string;
    sha: string;
  }>;
  worktreeDestination?: string;
  worktreeError?: unknown;
  root?: string;
}

const { Given, When, Then } = stepDefinitions<WorktreePlacementWorld>();
const VALID_NAME = "20260825_093000-831-worktree-placement";
const VALID_PATH = `.worktrees/${VALID_NAME}`;
const VALID_BRANCH = "feature/831-worktree-placement";
const CLI_BRANCH = "fix/831-worktree-placement";

function requireRoot(world: WorktreePlacementWorld): string {
  assert.ok(world.root, "隔離repositoryが未設定です");
  return world.root;
}

function requireSha(world: WorktreePlacementWorld): string {
  assert.ok(world.remoteDefaultSha, "remote default SHAが未設定です");
  return world.remoteDefaultSha;
}

function basePlacement(
  overrides: Partial<Parameters<typeof validateWorktreePlacement>[0]> = {},
): Parameters<typeof validateWorktreePlacement>[0] {
  return {
    repoRoot: "/tmp/asc-placement-repository",
    worktreePath: VALID_PATH,
    branch: VALID_BRANCH,
    issueNumber: 831,
    slug: "worktree-placement",
    existing: [],
    ...overrides,
  };
}

function configureRemoteDefault(root: string): string {
  fs.appendFileSync(
    path.join(root, ".git", "info", "exclude"),
    ".worktrees/\n",
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/example/fixture.git"],
    { cwd: root },
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
    cwd: root,
  });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  return sha;
}

function createValidWorktree(world: WorktreePlacementWorld): void {
  const root = requireRoot(world);
  const sha = requireSha(world);
  world.worktreeDestination = path.join(root, VALID_PATH);
  createWorktree({
    repoRoot: root,
    worktreePath: VALID_PATH,
    branch: VALID_BRANCH,
    base: sha,
    issueNumber: 831,
    slug: "worktree-placement",
    remoteDefaultBranch: "main",
    remoteDefaultSha: sha,
  });
}

Given("規定root直下の正しいworktree配置がある", function () {
  this.placementInput = basePlacement();
});

When("worktree配置の純粋検証を実行する", function () {
  assert.ok(this.placementInput);
  this.placementResult = validateWorktreePlacement(this.placementInput);
});

Then("worktree配置は有効である", function () {
  assert.deepEqual(this.placementResult, { valid: true, errors: [] });
});

Given("nested pathと絶対pathと親参照のworktree配置がある", function () {
  this.value = [
    `${VALID_PATH}/nested`,
    `/tmp/asc-placement-repository/${VALID_PATH}`,
    `../${VALID_PATH}`,
  ];
});

When("不正なworktree path群を純粋検証する", function () {
  assert.ok(Array.isArray(this.value));
  this.placementResults = this.value.map((worktreePath) =>
    validateWorktreePlacement(
      basePlacement({ worktreePath: String(worktreePath) }),
    ),
  );
});

Then("全ての不正なworktree pathが拒否される", function () {
  assert.equal(
    this.placementResults?.every((result) => !result.valid),
    true,
  );
  assert.equal(
    this.placementResults?.some((result) =>
      result.errors.some((error) => error.includes("repository相対path")),
    ),
    true,
  );
  assert.equal(
    this.placementResults?.some((result) =>
      result.errors.some((error) => error.includes("親参照")),
    ),
    true,
  );
});

Given(
  "directory名とbranch名がIssue番号またはslugと一致しない配置がある",
  function () {
    this.value = [
      basePlacement({
        worktreePath: ".worktrees/not-a-worktree-name",
      }),
      basePlacement({
        worktreePath: ".worktrees/20260825_093000-832-worktree-placement",
      }),
      basePlacement({ branch: "feature/832-worktree-placement" }),
      basePlacement({ branch: "feature/831-other-slug" }),
    ];
  },
);

When("命名不一致のworktree配置群を純粋検証する", function () {
  assert.ok(Array.isArray(this.value));
  this.placementResults = this.value.map((input) =>
    validateWorktreePlacement(
      input as Parameters<typeof validateWorktreePlacement>[0],
    ),
  );
});

Then("全ての命名不一致が拒否される", function () {
  assert.equal(
    this.placementResults?.every((result) => !result.valid),
    true,
  );
  const errors =
    this.placementResults?.flatMap((result) => result.errors) ?? [];
  assert.ok(errors.some((error) => error.includes("directory名")));
  assert.ok(errors.some((error) => error.includes("branch名のIssue番号")));
  assert.ok(errors.some((error) => error.includes("branch名のslug")));
});

Given("allowlist外のbranch typeを持つworktree配置がある", function () {
  this.placementInput = basePlacement({
    branch: "release/831-worktree-placement",
  });
});

Then("branch type違反が拒否される", function () {
  assert.equal(this.placementResult?.valid, false);
  assert.ok(
    this.placementResult?.errors.some((error) => error.includes("allowlist")),
  );
});

Given("制御文字と非NFC文字を含むworktree pathがある", function () {
  this.value = [
    `${VALID_PATH}\u0000`,
    ".worktrees/20260825_093000-831-cafe\u0301",
  ];
});

When("Unicode違反のworktree path群を純粋検証する", function () {
  assert.ok(Array.isArray(this.value));
  this.placementResults = this.value.map((worktreePath) =>
    validateWorktreePlacement(
      basePlacement({ worktreePath: String(worktreePath) }),
    ),
  );
});

Then("全てのUnicode違反が拒否される", function () {
  assert.equal(
    this.placementResults?.every((result) => !result.valid),
    true,
  );
  const errors =
    this.placementResults?.flatMap((result) => result.errors) ?? [];
  assert.ok(errors.some((error) => error.includes("Unicode制御文字")));
  assert.ok(errors.some((error) => error.includes("NFC")));
});

Given(
  "同一Issueとbranchとpathの重複およびcaseとUnicode衝突がある",
  function () {
    const candidate = path.resolve("/tmp/café/repository", VALID_PATH);
    const decomposed = candidate.replace("café", "cafe\u0301");
    this.value = [
      [{ path: candidate, branch: "fix/900-other" }],
      [{ path: "/tmp/other/20260825_093001-900-other", branch: VALID_BRANCH }],
      [
        {
          path: candidate.toUpperCase(),
          branch: "fix/901-other",
        },
      ],
      [{ path: decomposed, branch: "fix/902-other" }],
      [
        {
          path: "/tmp/other/20260825_093003-831-another",
          branch: "fix/831-another",
        },
      ],
    ];
  },
);

When("重複する登録済みworktree群を純粋検証する", function () {
  assert.ok(Array.isArray(this.value));
  this.placementResults = this.value.map((existing) =>
    validateWorktreePlacement(
      basePlacement({
        repoRoot: "/tmp/café/repository",
        existing: existing as Array<{ path: string; branch: string }>,
      }),
    ),
  );
});

Then("全ての重複と衝突が拒否される", function () {
  assert.equal(
    this.placementResults?.every((result) => !result.valid),
    true,
  );
  const errors =
    this.placementResults?.flatMap((result) => result.errors) ?? [];
  for (const expected of ["worktree path", "branch", "同じIssue番号"])
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected,
    );
});

Given("cleanup対象と候補worktreeの一致パターンがある", function () {
  const targetPath = "/tmp/repository/.worktrees/target";
  const targetBranch = "feature/831-target";
  this.value = [
    { candidatePath: targetPath, candidateBranch: targetBranch },
    { candidatePath: `${targetPath}-other`, candidateBranch: targetBranch },
    { candidatePath: targetPath.toUpperCase(), candidateBranch: targetBranch },
    { candidatePath: targetPath, candidateBranch: `${targetBranch}-other` },
  ].map((candidate) => ({ ...candidate, targetPath, targetBranch }));
});

When("cleanup対象の一致を純粋判定する", function () {
  assert.ok(Array.isArray(this.value));
  this.cleanupMatches = this.value.map((input) =>
    matchesTargetWorktree(input as Parameters<typeof matchesTargetWorktree>[0]),
  );
});

Then("pathとbranchが完全一致する候補だけが対象になる", function () {
  assert.deepEqual(this.cleanupMatches, [true, false, false, false]);
});

Given("worktree policyありとなしのmanifestおよび不正値がある", function () {
  const manifest = {
    schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
    policy: {
      schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
      delivery: { stopAt: "pull_request" },
      merge: {
        mode: "disabled",
        branches: [],
        methods: [],
        requiredChecks: [],
        requiredReviews: 0,
      },
      budgets: { localFeedbackMs: 1, prGateMs: 1 },
    },
    choiceFiles: ["project/choices/development.json"],
    ruleFiles: ["project/rules/safety.json"],
    conformanceFiles: ["project/conformance/bindings.json"],
    conformanceDirectory: "project/conformance",
  };
  const worktree = {
    root: ".worktrees",
    namePattern: "{timestamp}-{issueNumber}-{slug}",
    branchPattern: "{type}/{issueNumber}-{slug}",
    allowedBranchTypes: ["feature", "fix"],
    base: "remote-default-branch",
    cleanup: "after-merge",
  };
  this.value = [
    manifest,
    { ...manifest, policy: { ...manifest.policy, worktree } },
    {
      ...manifest,
      policy: {
        ...manifest.policy,
        worktree: { ...worktree, allowedBranchTypes: ["feature", "feature"] },
      },
    },
  ];
});

When("worktree policyのschemaとruntime契約を検証する", function () {
  assert.ok(Array.isArray(this.value));
  this.policyValidationResults = this.value.map((manifest) =>
    validateProjectPolicyManifest(manifest),
  );
  const schema: unknown = JSON.parse(
    fs.readFileSync(
      ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
      "utf8",
    ),
  );
  assert.ok(schema !== null && typeof schema === "object");
  this.calls = [JSON.stringify(schema)];
});

Then("optionalの後方互換を保ち不正値だけを拒否する", function () {
  assert.deepEqual(
    this.policyValidationResults?.map((result) => result.valid),
    [true, true, false],
  );
  const schema = this.calls[0] ?? "";
  assert.match(schema, /"worktree"/u);
  assert.doesNotMatch(
    schema,
    /"required":\["schemaVersion","delivery","merge","budgets","worktree"\]/u,
  );
});

Given("remote default branchを固定した隔離repositoryがある", function () {
  this.root = this.initRepo();
  this.remoteDefaultSha = configureRemoteDefault(this.root);
});

When("規定名のworktreeを作成する", function () {
  createValidWorktree(this);
});

Then("規定root直下に指定branchのworktreeが作成される", function () {
  assert.equal(
    this.worktreeDestination,
    path.join(requireRoot(this), VALID_PATH),
  );
  assert.equal(fs.existsSync(this.worktreeDestination), true);
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: this.worktreeDestination,
    encoding: "utf8",
  }).trim();
  assert.equal(branch, VALID_BRANCH);
});

When("異なるremote default branch SHAでworktree作成を試みる", function () {
  const root = requireRoot(this);
  this.worktreeDestination = path.join(root, VALID_PATH);
  try {
    createWorktree({
      repoRoot: root,
      worktreePath: VALID_PATH,
      branch: VALID_BRANCH,
      base: requireSha(this),
      issueNumber: 831,
      slug: "worktree-placement",
      remoteDefaultBranch: "main",
      remoteDefaultSha: "0".repeat(40),
    });
  } catch (error) {
    this.worktreeError = error;
  }
});

Then("worktree作成は副作用前に拒否される", function () {
  assert.ok(this.worktreeError instanceof Error);
  assert.equal(fs.existsSync(this.worktreeDestination ?? ""), false);
  assert.equal(
    execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: requireRoot(this),
      encoding: "utf8",
    }).includes(VALID_NAME),
    false,
  );
});

Given(
  "dirty状態とremote default branchを持つ隔離repositoryがある",
  function () {
    this.root = this.initRepo();
    this.remoteDefaultSha = configureRemoteDefault(this.root);
    fs.writeFileSync(path.join(this.root, "dirty.txt"), "保持する\n");
    this.sourceStatusBefore = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: this.root, encoding: "utf8" },
    );
  },
);

Then("作成元のdirty状態は作成前後で同一である", function () {
  const after = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: requireRoot(this), encoding: "utf8" },
  );
  assert.equal(after, this.sourceStatusBefore);
});

Given(
  "worktree rootがrepository外とGit内部を指す隔離repository群がある",
  function () {
    const outside = this.temp("asc-worktree-outside-");
    this.symlinkFixtures = [outside, "git-internal"].map((target, index) => {
      const root = this.initRepo();
      const sha = configureRemoteDefault(root);
      fs.symlinkSync(
        target === "git-internal" ? path.join(root, ".git") : target,
        path.join(root, ".worktrees"),
        "dir",
      );
      return {
        root,
        destination: `.worktrees/20260825_09300${index}-83${index + 1}-symlink-${index}`,
        sha,
      };
    });
  },
);

When("symlink経由で規定名のworktree作成を試みる", function () {
  assert.ok(this.symlinkFixtures);
  this.value = this.symlinkFixtures.map((fixture, index) => {
    try {
      createWorktree({
        repoRoot: fixture.root,
        worktreePath: fixture.destination,
        branch: `feature/83${index + 1}-symlink-${index}`,
        base: fixture.sha,
        issueNumber: Number(`83${index + 1}`),
        slug: `symlink-${index}`,
        remoteDefaultBranch: "main",
        remoteDefaultSha: fixture.sha,
      });
      return undefined;
    } catch (error) {
      return error;
    }
  });
});

Then("全てのsymlink経由作成が副作用前に拒否される", function () {
  assert.ok(Array.isArray(this.value));
  assert.equal(
    this.value.every((error) => error instanceof Error),
    true,
  );
  assert.equal(
    this.symlinkFixtures?.every(
      (fixture) =>
        !fs.existsSync(path.resolve(fixture.root, fixture.destination)),
    ),
    true,
  );
});

Given(
  "CLI用trusted policyとremote default branchを持つ隔離repositoryがある",
  function () {
    this.root = this.initRepo();
    fs.mkdirSync(path.join(this.root, ".agent-skill-chain", "policy"), {
      recursive: true,
    });
    fs.copyFileSync(
      ".agent-skill-chain/policy/default.json",
      path.join(this.root, ".agent-skill-chain", "policy", "default.json"),
    );
    fs.copyFileSync(
      ".agent-skill-chain/project-policy.json",
      path.join(this.root, ".agent-skill-chain", "project-policy.json"),
    );
    fs.cpSync(
      ".agent-skill-chain/project",
      path.join(this.root, ".agent-skill-chain", "project"),
      { recursive: true },
    );
    execFileSync("git", ["add", ".agent-skill-chain"], {
      cwd: this.root,
    });
    execFileSync("git", ["commit", "-q", "-m", "trusted policy fixture"], {
      cwd: this.root,
    });
    this.remoteDefaultSha = configureRemoteDefault(this.root);
    this.worktreeDestination = path.join(this.root, VALID_PATH);
  },
);

When("worktree create CLIを必須入力付きで実行する", function () {
  const root = requireRoot(this);
  const result = spawnSync(
    process.execPath,
    [
      path.resolve("dist", "bin", "agent-skill-chain.js"),
      "worktree",
      "create",
      `--root=${root}`,
      `--path=${VALID_PATH}`,
      `--branch=${CLI_BRANCH}`,
      `--base=${requireSha(this)}`,
      "--issue=831",
      "--slug=worktree-placement",
      "--remote-default-branch=main",
      `--remote-default-sha=${requireSha(this)}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  this.cliResult = {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
});

Then("CLIは規定worktreeを作成して成功JSONを返す", function () {
  assert.equal(this.cliResult?.status, 0, this.cliResult?.stdout);
  const parsed: unknown = JSON.parse(this.cliResult?.stdout ?? "");
  assert.ok(parsed !== null && typeof parsed === "object");
  assert.equal(fs.existsSync(this.worktreeDestination ?? ""), true);
  assert.match(this.cliResult?.stdout ?? "", /"sourceDirtyPreserved": true/u);
});
