import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import { STAGING_RECORD_FILE } from "../../src/domain/staging.js";
import {
  parseStepJournal,
  STEP_JOURNAL_FILE,
} from "../../src/domain/workflow.js";

/**
 * **Step 9のstaging binding（Issue #1566 OWN-03、REQ-WF-025）。**
 *
 * 実例: Step 0のstagingを主作業directory（HEAD=既定branch=基点）に置いたまま
 * 専用worktreeで実装し、cwdをworktreeにして`workflow record --step=9`を実行すると、
 * CLIはstaging pathからrepository rootを導出するため基点（実装commit 0件）を
 * `implementationHeadSha`へ束縛して記録に成功していた。**公開CLIを別processで
 * 起動し、cwdとstagingの置き場所を実例どおりに分ける。**
 */
interface BindingWorld extends WorkflowWorld {
  root: string;
  worktree: string;
  staging: string;
  baseSha: string;
  tipSha: string;
  result: { status: number | null; stdout: string; stderr: string };
  journalBefore: string;
  recordBefore: string;
}

const { Given, When, Then } = stepDefinitions<BindingWorld>();
const STAGING_PARENT = path.join(".agent-skill-chain", "tmp", "issues");
const SYNC_DIGEST = "1".repeat(64);

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の確認根拠` }]),
  );
}

function gitOut(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitIn(directory: string, file: string): string {
  fs.writeFileSync(path.join(directory, file), `${file}\n`);
  gitOut(["add", "--", file], directory);
  gitOut(["commit", "-q", "-m", `implement ${file}`], directory);
  return gitOut(["rev-parse", "HEAD"], directory);
}

function cli(args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.resolve("dist/bin/agent-skill-chain.js"), ...args],
    { cwd, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function record(world: BindingWorld, step: number, cwd: string) {
  return cli(
    [
      "workflow",
      "record",
      `--staging=${world.staging}`,
      `--step=${step}`,
      "--artifact=00_要求定義.md",
      `--evidence=${step === 4 ? `sync digest ${SYNC_DIGEST}` : `Step ${step}の証跡`}`,
    ],
    cwd,
  );
}

/** 主作業directory（既定branch・基点）と、そこから分岐した実装worktreeを作る。 */
function prepare(world: BindingWorld, stagingIn: "root" | "worktree"): void {
  world.root = fs.realpathSync(world.initRepo());
  world.baseSha = gitOut(["rev-parse", "HEAD"], world.root);
  world.worktree = path.join(
    fs.realpathSync(world.temp("asc-step9-wt-")),
    "wt",
  );
  gitOut(
    ["worktree", "add", "-q", "-b", "feature/1-impl", world.worktree],
    world.root,
  );
  const owner = stagingIn === "root" ? world.root : world.worktree;
  fs.mkdirSync(path.join(owner, STAGING_PARENT), { recursive: true });
  world.staging = createIssueStaging(owner, {
    title: "step9-binding",
    answers: answers(),
    now: new Date("2026-10-08T00:00:00Z"),
    requestedMode: "quick",
  }).path;
  for (const step of [1, 4]) {
    const result = record(world, step, owner);
    assert.equal(
      result.status,
      0,
      `Step ${step}: ${result.stdout}${result.stderr}`,
    );
  }
  commitIn(world.worktree, "implementation.txt");
}

function snapshot(world: BindingWorld): void {
  world.journalBefore = fs.readFileSync(
    path.join(world.staging, STEP_JOURNAL_FILE),
    "utf8",
  );
  world.recordBefore = fs.readFileSync(
    path.join(world.staging, STAGING_RECORD_FILE),
    "utf8",
  );
}

Given(
  "主作業directoryにStep 4まで記録したquick stagingがあり別worktreeに実装commitがある",
  function (this: BindingWorld) {
    prepare(this, "root");
    snapshot(this);
  },
);

Given(
  "実装worktreeにStep 4まで記録したquick stagingがあり他worktreeも並行して実装commitを持つ",
  function (this: BindingWorld) {
    prepare(this, "worktree");
    const other = path.join(path.dirname(this.worktree), "other");
    gitOut(
      ["worktree", "add", "-q", "-b", "feature/2-other", other],
      this.root,
    );
    commitIn(other, "other.txt");
    assert.equal(
      gitOut(["worktree", "list", "--porcelain"], this.root)
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      3,
      "主作業directory・実装worktree・他worktreeの3件が並行して存在しません",
    );
  },
);

Given(
  "主作業directoryにStep 4まで記録したquick stagingがあり既定branch tipだけが先へ進んでいる",
  function (this: BindingWorld) {
    prepare(this, "root");
    /** 主作業directoryのHEADを動かさず、取得済み既定branch tipだけを子commitへ進める。 */
    this.tipSha = gitOut(
      ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "upstream advanced"],
      this.root,
    );
    gitOut(["update-ref", "refs/remotes/origin/main", this.tipSha], this.root);
    assert.notEqual(this.tipSha, this.baseSha);
    assert.equal(gitOut(["rev-parse", "HEAD"], this.root), this.baseSha);
    snapshot(this);
  },
);

When(
  "別worktreeをcwdにして主作業directoryのstagingでStep 9を記録する",
  function (this: BindingWorld) {
    this.result = record(this, 9, this.worktree);
  },
);

When(
  "主作業directoryをcwdにして実装worktreeのstagingでStep 9を記録する",
  function (this: BindingWorld) {
    this.result = record(this, 9, this.root);
  },
);

When(
  "stagingを別worktreeの同じ相対pathへ移してStep 9を記録する",
  function (this: BindingWorld) {
    const relative = path.relative(this.root, this.staging);
    const moved = path.join(this.worktree, relative);
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(this.staging, moved);
    this.staging = moved;
    this.result = record(this, 9, this.root);
  },
);

When(
  "別worktreeで実装commitを足してStep 9を再記録する",
  function (this: BindingWorld) {
    commitIn(this.worktree, "implementation-2.txt");
    this.result = record(this, 9, this.root);
  },
);

Then(
  "Step 9記録は基点と次の操作を名指しして拒否されjournalとstaging記録は変わらない",
  function (this: BindingWorld) {
    const output = this.result.stdout + this.result.stderr;
    assert.notEqual(this.result.status, 0, output);
    assert.match(
      output,
      new RegExp(
        `Step 9の検証対象HEAD\\(${this.baseSha}\\)は計画の基点（既定branch origin/main ${this.baseSha}）から実装commitを1件も含みません`,
        "u",
      ),
    );
    assert.ok(
      output.includes("stagingが実装worktreeの外にある"),
      `原因を名指ししていません: ${output}`,
    );
    assert.ok(
      output.includes(
        "stagingを実装worktree内の同じpolicy解決済みpathへ移してから、そのstagingでworkflow record --step=9を再実行してください（自動では移しません）",
      ),
      `次の操作を名指ししていません: ${output}`,
    );
    assert.equal(
      fs.readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8"),
      this.journalBefore,
      "拒否したStep 9がjournalを変更しました",
    );
    assert.equal(
      fs.readFileSync(path.join(this.staging, STAGING_RECORD_FILE), "utf8"),
      this.recordBefore,
      "拒否したStep 9がstaging記録を変更しました",
    );
    assert.ok(fs.existsSync(this.staging), "拒否時にstagingが移動されました");
  },
);

Then(
  "Step 9記録は別worktreeの実装HEADへ束縛される",
  function (this: BindingWorld) {
    assert.equal(
      this.result.status,
      0,
      this.result.stdout + this.result.stderr,
    );
    const head = gitOut(["rev-parse", "HEAD"], this.worktree);
    assert.notEqual(head, this.baseSha);
    const last = parseStepJournal(
      fs.readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8"),
    ).entries.at(-1);
    assert.equal(last?.step, 9);
    assert.equal(last?.implementationHeadSha, head);
  },
);

Then(
  "Step 9記録は祖先のHEADを名指しして拒否されjournalとstaging記録は変わらない",
  function (this: BindingWorld) {
    const output = this.result.stdout + this.result.stderr;
    assert.notEqual(this.result.status, 0, output);
    assert.ok(
      output.includes(
        `Step 9の検証対象HEAD(${this.baseSha})は計画の基点（既定branch origin/main ${this.tipSha}）から実装commitを1件も含みません`,
      ),
      `祖先HEADの拒否理由を名指ししていません: ${output}`,
    );
    assert.equal(
      fs.readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8"),
      this.journalBefore,
      "拒否したStep 9がjournalを変更しました",
    );
    assert.equal(
      fs.readFileSync(path.join(this.staging, STAGING_RECORD_FILE), "utf8"),
      this.recordBefore,
      "拒否したStep 9がstaging記録を変更しました",
    );
  },
);
