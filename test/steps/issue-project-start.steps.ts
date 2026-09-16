import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { QUESTIONS } from "../../src/domain/mode.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ProviderState {
  item: boolean;
  status: boolean;
  duplicateOption: boolean;
  duplicateItem: boolean;
  incompleteItems: boolean;
  failStatus: boolean;
  projectWritable: boolean;
  providerTip: string;
  inspectCount: number;
  raceItemOnSecondInspect: boolean;
  calls: string[];
}

interface IssueProjectWorld extends WorkflowWorld {
  root: string;
  staging: string;
  fixtureBin: string;
  stateFile: string;
  result: SpawnSyncReturns<string>;
  firstResult?: SpawnSyncReturns<string>;
}

const { Given, When, Then } = stepDefinitions<IssueProjectWorld>();

const policy = (configured: boolean) => ({
  schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
  delivery: { stopAt: "pull_request" },
  ...(configured
    ? {
        issueProject: {
          owner: "example",
          number: 8,
          statusField: "Status",
          startedStatus: "In progress",
        },
      }
    : {}),
  merge: {
    mode: "disabled",
    branches: ["feature/*"],
    methods: ["merge"],
    requiredChecks: [],
    requiredReviews: 0,
  },
  budgets: { localFeedbackMs: 1, prGateMs: 1 },
  rules: [],
});

function fixtureScript(stateFile: string): string {
  return `#!${process.execPath}
const fs=require('node:fs');
const stateFile=${JSON.stringify(stateFile)};
const args=process.argv.slice(2);
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
if(args[0]==='auth'){process.exit(0)}
if(args[0]==='repo'){
  process.stdout.write(JSON.stringify({nameWithOwner:'example/repository',viewerPermission:'ADMIN',defaultBranchRef:{name:'main'}}));
  process.exit(0);
}
if(args[0]==='api'&&String(args[1]).startsWith('repos/example/repository/commits/')){
  process.stdout.write(state.providerTip+'\\n'); process.exit(0);
}
if(args[0]!=='api'||args[1]!=='graphql'){process.exit(2)}
const query=(args.find(value=>value.startsWith('query='))||'').slice(6);
if(query.includes('addProjectV2ItemById')){
  state.calls.push('add-item'); state.item=true; save();
  process.stdout.write(JSON.stringify({data:{addProjectV2ItemById:{item:{id:'ITEM'}}}})); process.exit(0);
}
if(query.includes('updateProjectV2ItemFieldValue')){
  state.calls.push('set-status');
  if(state.failStatus){save(); process.stderr.write('fixture status failure'); process.exit(1)}
  state.status=true; save();
  process.stdout.write(JSON.stringify({data:{updateProjectV2ItemFieldValue:{projectV2Item:{id:'ITEM'}}}})); process.exit(0);
}
state.calls.push('inspect'); state.inspectCount++;
if(state.raceItemOnSecondInspect&&state.inspectCount===2) state.item=true;
save();
const options=state.duplicateOption
  ? [{id:'STARTED',name:'In progress'},{id:'STARTED2',name:'In progress'}]
  : [{id:'STARTED',name:'In progress'}];
const nodes=state.item ? [{
  id:'ITEM', project:{id:'PROJECT'},
  fieldValueByName:state.status ? {optionId:'STARTED',name:'In progress'} : {optionId:'BACKLOG',name:'Backlog'}
}] : [];
if(state.duplicateItem) nodes.push({
  id:'ITEM2', project:{id:'PROJECT'},
  fieldValueByName:{optionId:'BACKLOG',name:'Backlog'}
});
process.stdout.write(JSON.stringify({data:{
  organization:{projectV2:{id:'PROJECT',number:8,viewerCanUpdate:state.projectWritable,field:{id:'STATUS',name:'Status',options}}},
  repository:{nameWithOwner:'example/repository',issue:{id:'ISSUE',number:1404,repository:{nameWithOwner:'example/repository'},projectItems:{nodes,pageInfo:{hasNextPage:state.incompleteItems}}}}
}}));
`;
}

function setup(
  world: IssueProjectWorld,
  options: Partial<ProviderState> & {
    configured?: boolean;
    candidateOnly?: boolean;
    invalidConfig?: boolean;
  } = {},
): void {
  world.root = world.initRepo();
  fs.mkdirSync(path.join(world.root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/policy/default.json"),
    path.join(world.root, ".agent-skill-chain", "policy", "default.json"),
  );
  const trustedPolicy = policy(
    options.configured !== false && !options.candidateOnly,
  );
  if (options.invalidConfig && trustedPolicy.issueProject)
    trustedPolicy.issueProject.owner = " invalid ";
  fs.writeFileSync(
    path.join(world.root, ".agent-skill-chain", "project-policy.json"),
    `${JSON.stringify(trustedPolicy)}\n`,
  );
  spawnSync(
    "git",
    [
      "add",
      ".agent-skill-chain/project-policy.json",
      ".agent-skill-chain/policy/default.json",
    ],
    { cwd: world.root },
  );
  if (options.candidateOnly) {
    fs.writeFileSync(
      path.join(world.root, ".agent-skill-chain", "project-policy.json"),
      `${JSON.stringify(policy(true))}\n`,
    );
  }
  spawnSync("git", ["commit", "-q", "-m", "trusted project policy"], {
    cwd: world.root,
  });
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: world.root,
  });
  spawnSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: world.root },
  );
  world.staging = createIssueStaging(world.root, {
    title: "issue-project-start",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [id, { answer: true, evidence: `${id} fixture` }]),
    ),
    requestedMode: "quick",
    now: new Date("2026-09-16T00:00:00.000Z"),
  }).path;
  recordStagingSync(world.staging, {
    tracker: "https://github.com/example/repository/issues/1404",
    checkpoint: 4,
    syncedAt: "2026-09-16T00:01:00.000Z",
    bodyDigest: "a".repeat(64),
    readBackDigest: "a".repeat(64),
  });
  world.fixtureBin = world.temp("asc-issue-project-bin-");
  world.stateFile = path.join(world.fixtureBin, "state.json");
  fs.writeFileSync(
    world.stateFile,
    JSON.stringify({
      item: options.item ?? false,
      status: options.status ?? false,
      duplicateOption: options.duplicateOption ?? false,
      duplicateItem: options.duplicateItem ?? false,
      incompleteItems: options.incompleteItems ?? false,
      failStatus: options.failStatus ?? false,
      projectWritable: options.projectWritable ?? true,
      providerTip:
        options.providerTip ??
        spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: world.root,
          encoding: "utf8",
        }).stdout.trim(),
      inspectCount: 0,
      raceItemOnSecondInspect: options.raceItemOnSecondInspect ?? false,
      calls: [],
    } satisfies ProviderState),
  );
  const executable = path.join(world.fixtureBin, "gh");
  fs.writeFileSync(executable, fixtureScript(world.stateFile), { mode: 0o755 });
}

function execute(
  world: IssueProjectWorld,
  apply: boolean,
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      path.resolve("dist/bin/agent-skill-chain.js"),
      "issue",
      "start",
      "--issue=1404",
      "--repo=example/repository",
      `--root=${world.root}`,
      `--staging-path=${world.staging}`,
      apply ? "--apply" : "--dry-run",
      ...(apply ? ["--authorize=approved"] : []),
    ],
    {
      cwd: world.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${world.fixtureBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
}

function state(world: IssueProjectWorld): ProviderState {
  return JSON.parse(fs.readFileSync(world.stateFile, "utf8")) as ProviderState;
}

function resultJson(result: SpawnSyncReturns<string>): Record<string, unknown> {
  const value: unknown = JSON.parse(result.stdout);
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

Given("trusted Issue Projectと未所属Issueのfixtureがある", function () {
  setup(this);
});

Given("trusted Issue Projectで既に着手済みのfixtureがある", function () {
  setup(this, { item: true, status: true });
});

Given("trusted Issue Projectが未構成のfixtureがある", function () {
  setup(this, { configured: false });
});

Given(
  "trusted Issue ProjectのStatus optionが重複したfixtureがある",
  function () {
    setup(this, { duplicateOption: true });
  },
);

Given(
  "trusted Issue ProjectでStatus更新が一度失敗するfixtureがある",
  function () {
    setup(this, { failStatus: true });
  },
);

Given("candidateだけにIssue Projectを設定したfixtureがある", function () {
  setup(this, { candidateOnly: true });
});

Given("trusted Issue Projectのitem観測が未完了なfixtureがある", function () {
  setup(this, { incompleteItems: true });
});

Given("trusted Issue Project設定が不正なfixtureがある", function () {
  setup(this, { invalidConfig: true });
});

Given("trusted Issue Projectのitemが重複したfixtureがある", function () {
  setup(this, { item: true, duplicateItem: true });
});

Given(
  "provider default tipがlocal trusted commitと不一致のfixtureがある",
  function () {
    setup(this, { providerTip: "b".repeat(40) });
  },
);

Given("trusted Issue Projectのwrite authorityがないfixtureがある", function () {
  setup(this, { projectWritable: false });
});

Given("Issue stagingではない入れ子directoryのfixtureがある", function () {
  setup(this);
  this.staging = path.join(this.staging, "nested");
  fs.mkdirSync(this.staging);
});

Given("Issue stagingの祖先がsymlinkのfixtureがある", function () {
  setup(this);
  const chain = path.join(this.root, ".agent-skill-chain");
  const realChain = path.join(this.root, ".agent-skill-chain-real");
  fs.renameSync(chain, realChain);
  fs.symlinkSync(realChain, chain, "dir");
});

Given("write直前の再観測でitemが出現するfixtureがある", function () {
  setup(this, { raceItemOnSecondInspect: true });
});

When("Issue着手を承認して実行する", function () {
  this.result = execute(this, true);
});

When("Issue着手をpreviewする", function () {
  this.result = execute(this, false);
});

When("Issue着手を承認して再開する", function () {
  this.firstResult = execute(this, true);
  const current = state(this);
  current.failStatus = false;
  fs.writeFileSync(this.stateFile, JSON.stringify(current));
  this.result = execute(this, true);
});

Then("Project追加とStatus更新が各1回行われstartedになる", function () {
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(resultJson(this.result).state, "started");
  assert.deepEqual(
    state(this).calls.filter((call) => call !== "inspect"),
    ["add-item", "set-status"],
  );
});

Then("mutationなしでstartedになる", function () {
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(resultJson(this.result).state, "started");
  assert.deepEqual(
    state(this).calls.filter((call) => call !== "inspect"),
    [],
  );
});

Then("providerを呼ばずnot-configuredになる", function () {
  assert.equal(
    this.result.status,
    0,
    `${this.result.stderr}\n${this.result.stdout}`,
  );
  assert.equal(resultJson(this.result).state, "not-configured");
  assert.deepEqual(state(this).calls, []);
});

Then("非0終了してProject writeは0回である", function () {
  assert.notEqual(this.result.status, 0);
  assert.deepEqual(
    state(this).calls.filter((call) => call !== "inspect"),
    [],
  );
});

Then("非0終了してprovider callは0回である", function () {
  assert.notEqual(this.result.status, 0);
  assert.deepEqual(state(this).calls, []);
});

Then("Project追加を再送せずStatusだけを完了する", function () {
  assert.notEqual(this.firstResult?.status, 0);
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(resultJson(this.result).state, "started");
  assert.equal(
    state(this).calls.filter((call) => call === "add-item").length,
    1,
  );
  assert.equal(
    state(this).calls.filter((call) => call === "set-status").length,
    2,
  );
});

Then("add-item予定を返してProject writeは0回である", function () {
  assert.equal(this.result.status, 0, this.result.stderr);
  const output = resultJson(this.result);
  assert.equal(output.state, "preview");
  assert.ok(output.plan !== null && typeof output.plan === "object");
  assert.deepEqual((output.plan as Record<string, unknown>).operations, [
    "add-item",
  ]);
  assert.deepEqual(
    state(this).calls.filter((call) => call !== "inspect"),
    [],
  );
});
