import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  EVIDENCE_REANCHOR_FILE,
  appendEvidenceReanchor,
  evaluateEvidenceReanchor,
  readEvidenceReanchorChain,
} from "../../src/adapters/evidence-reanchor.js";
import {
  deriveEffectiveHead,
  observeReachability,
  type EvidenceReanchorRecord,
} from "../../src/domain/evidence-reanchor.js";
import {
  bindStoredPullRequest,
  deliveryStateTransactionPath,
  prepareStoredPullRequestCreation,
  recordStoredStep11,
} from "../../src/adapters/delivery-state.js";
import {
  closingContractDigest,
  pullRequestContentDigest,
} from "../../src/domain/delivery-state.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import {
  calculateStagingDigest,
  refreshStoredStagingDigest,
} from "../../src/domain/staging.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
import {
  observeReviewDiff,
  readStoredReviewSession,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  appendWorkflowJournalEntry,
  readWorkflowJournal,
} from "../../src/adapters/workflow-journal.js";
import { WORKFLOW_STEPS } from "../../src/domain/workflow.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import {
  assertBoundPullRequestObservation,
  assertCurrentReviewJournalBinding,
  main,
} from "../../src/cli.js";
import { readStoredDeliveryState } from "../../src/adapters/delivery-state.js";
import { github } from "../../src/adapters/github.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

class ReanchorWorld extends WorkflowWorld {
  root = "";
  staging = "";
  baseSha = "";
  oldHeadSha = "";
  newBaseSha = "";
  newHeadSha = "";
  chain: EvidenceReanchorRecord[] = [];
  /** 最後に成立した再固定の記録時刻（Issue #969）。 */
  effectiveRecordedAt: string | undefined = undefined;
  effectiveHead = "";
  reachability = "";
  override error: unknown = undefined;
  applied = false;
  before: Record<string, string> = {};
  providerCalls = 0;
  unconverged = false;
  bindingPassed = false;
  reanchorCliResults: Array<{
    status: number | null;
    output: Record<string, unknown>;
  }> = [];
  reanchorCliCases: Array<
    Array<{ status: number | null; output: Record<string, unknown> }>
  > = [];
  observableBefore = "";
  observableAfter = "";
  invalidBaselineChainLength = 0;
  intakeIdempotent = false;
  mergeDispatchHead = "";
}

const { Given, When, Then } = stepDefinitions<ReanchorWorld>();

const INSTANT = new Date("2026-09-01T00:00:00.000Z");
const REVIEWED = "src/domain/reviewed.ts";
const GENERATED = "dist/src/domain/reviewed.js";

function runReanchorCli(
  world: ReanchorWorld,
  mode: "--dry-run" | "--apply",
  options: {
    layer?: "pr" | "review";
    root?: string;
    staging?: string;
    newHeadSha?: string;
    newBaseSha?: string;
    reason?: string;
  } = {},
): { status: number | null; output: Record<string, unknown> } {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "bin/agent-skill-chain.ts",
      options.layer ?? "pr",
      "reanchor",
      `--staging=${options.staging ?? world.staging}`,
      `--root=${options.root ?? world.root}`,
      `--new-head=${options.newHeadSha ?? world.newHeadSha}`,
      `--new-base=${options.newBaseSha ?? world.newBaseSha}`,
      `--reason=${options.reason ?? "既定branchが動いたためrebaseした"}`,
      mode,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return {
    status: result.status,
    output: JSON.parse(result.stdout) as Record<string, unknown>,
  };
}

/** staging、親directory、Gitの永続観測値だけをsnapshotする。 */
function observableSnapshot(world: ReanchorWorld): string {
  const entries: Array<Record<string, unknown>> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(world.staging, absolute);
      const stat = fs.lstatSync(absolute);
      entries.push({
        relative,
        kind: entry.isDirectory() ? "directory" : "file",
        mode: stat.mode,
        ...(entry.isFile()
          ? { content: fs.readFileSync(absolute).toString("base64") }
          : {}),
      });
      if (entry.isDirectory()) visit(absolute);
    }
  };
  visit(world.staging);
  const parent = path.dirname(world.staging);
  return JSON.stringify({
    entries,
    parentEntries: fs.readdirSync(parent).sort(),
    parentMtimeNs: fs.statSync(parent, { bigint: true }).mtimeNs.toString(),
    head: git(world.root, ["rev-parse", "HEAD"]),
    refs: git(world.root, ["show-ref", "--head"]),
  });
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commit(root: string, body: string, message: string): string {
  const file = path.join(root, REVIEWED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  execFileSync("git", ["add", REVIEWED], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return git(root, ["rev-parse", "HEAD"]);
}

function makeStaging(world: ReanchorWorld): string {
  return createIssueStaging(world.root, {
    title: "evidence-reanchor",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: `${id}の固定証拠` },
      ]),
    ),
    now: INSTANT,
    requestedMode: "quick",
  }).path;
}

/**
 * 旧baseから旧headまでの差分を、新baseの上へ同じ内容で載せ直す。
 *
 * **`git rebase`を使わず、新baseから同じ内容のcommitを作る。** fixtureの意図は
 * 「内容が等価な新しいhead」を作ることであり、rebaseの実行手順そのものではない。
 */
function replay(
  world: ReanchorWorld,
  mutate?: (file: string) => void,
): { newBase: string; newHead: string } {
  const root = world.root;
  const content = fs.readFileSync(path.join(root, REVIEWED), "utf8");
  execFileSync("git", ["checkout", "-q", world.baseSha], { cwd: root });
  /**
   * **新baseは`REVIEWED`以外のpathだけを変える。**
   *
   * 新baseが`REVIEWED`へ触れると、新base→新headの差分が旧base→旧headと変わり、
   * fixture自身が等価でなくなる。fixtureの意図は「等価な新しいhead」を作ることである。
   */
  const upstream = path.join(root, "upstream.ts");
  fs.writeFileSync(upstream, "export const upstream = 1;\n");
  execFileSync("git", ["add", "upstream.ts"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "chore: 既定branchが進む"], {
    cwd: root,
  });
  const newBase = git(root, ["rev-parse", "HEAD"]);
  const file = path.join(root, REVIEWED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  mutate?.(file);
  execFileSync("git", ["add", REVIEWED], { cwd: root });
  execFileSync(
    "git",
    ["commit", "-q", "-m", "feat: 同じ内容を新baseの上へ載せ直す"],
    {
      cwd: root,
    },
  );
  return { newBase, newHead: git(root, ["rev-parse", "HEAD"]) };
}

function buildDelivery(world: ReanchorWorld, terminal = true): void {
  const issueUrl = "https://github.com/example/repository/issues/1093";
  prepareStoredPullRequestCreation(world.staging, {
    repository: "example/repository",
    issue: 1093,
    issueUrl,
    headRef: "bugfix/1093-evidence-reanchor",
    headSha: world.oldHeadSha,
    baseRef: "main",
    baseSha: world.baseSha,
    pullRequestDigest: pullRequestContentDigest({
      title: "証跡再固定",
      body: "Closes #1093",
    }),
    bodyClosingDigest: closingContractDigest({
      canonicalIssue: 1093,
      canonicalIssueUrl: issueUrl,
      closingIssueNumbers: [1093],
    }),
    preparedAt: INSTANT.toISOString(),
  });
  bindStoredPullRequest(world.staging, {
    number: 1093,
    url: "https://github.com/example/repository/pull/1093",
    boundAt: INSTANT.toISOString(),
  });
  if (terminal)
    recordStoredStep11(world.staging, {
      outcome: "pull-request",
      recordedAt: INSTANT.toISOString(),
      journalDigest: "c".repeat(64),
    });
}

function snapshot(world: ReanchorWorld): void {
  world.before = {};
  for (const relative of [
    "journal/delivery-state.json",
    "journal/steps.jsonl",
  ]) {
    const file = path.join(world.staging, relative);
    if (fs.existsSync(file))
      world.before[relative] = fs.readFileSync(file, "utf8");
  }
}

const REVIEW_ARTIFACT = "docs/reviews/99_課題1172再固定レビュー.md";
const INITIAL_FORWARD_ARTIFACT = "docs/reviews/209_課題1389初回レビュー.md";
const FORWARD_ARTIFACT = "docs/reviews/210_課題1389再固定レビュー.md";

/**
 * review artifactの配置variant（Issue #1433）。
 *
 * **正本はfile名規則を持たない。** `01_開発ワークフロー.md`はformal review成果物の
 * 配置を`docs/reviews/`と`.agent-skill-chain/reviews/`の2 directoryだけで定め、
 * `02_品質基準.md`は「汎用パッケージは特定runnerやfile名を強制しない」と定める。
 * ここではその2 directoryと、製品自身が`review artifact --init`の既定で出力する
 * `<Issue番号>_レビュー.md`を受理側のvariantとして持つ。
 *
 * **allowlist外のvariantは候補に数えない。** prefixの延長と短縮は区切り文字を
 * 跨ぐ前方一致の誤りを、backslashと制御文字は`isEvidenceOnlyPath`が拒否する
 * 安全条件を固定する。**後者2件はgitが実際に保持できるpathであり、旧実装の
 * 単純前方一致では候補として受理されていた（INV-05）。**
 */
const ARTIFACT_PLACEMENTS: Record<string, string> = {
  製品既定出力名: "docs/reviews/1433_レビュー.md",
  第2allowlist: ".agent-skill-chain/reviews/1433_レビュー.md",
  自repo慣習名: "docs/reviews/226_課題1433再固定レビュー.md",
  prefix延長: "docs/reviewsX/1433_レビュー.md",
  prefix短縮: "docs/review/1433_レビュー.md",
  backslash: "docs/reviews/1433\\レビュー.md",
  制御文字: "docs/reviews/1433\u0001レビュー.md",
};

function placement(name: string): string {
  const value = ARTIFACT_PLACEMENTS[name];
  assert.ok(value, `未知のartifact配置: ${name}`);
  return value;
}

/** 「レビュー識別情報」節を持つreview artifactを組み立てる。 */
function reviewArtifact(
  base: string,
  implementation: string,
  extra = "",
): string {
  return `# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 比較基点 | \`${base}\` |
| H_impl | \`${implementation}\` |
| 実施者 | reviewer |

## 1. 判定

approved${extra}
`;
}

function auditableReviewArtifact(
  base: string,
  implementation: string,
  includeGenerated = false,
): string {
  return `# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 比較基点 | \`${base}\` |
| H_impl | \`${implementation}\` |
| ラウンド数 | 1 |
| Step chain | 経由: fixture |

## 1. 入力証拠

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| \`${REVIEWED}\` | A | package owner | domain | fixture実装 | 循環なし | AC-1377-01 / SCN-1377-01 | revert可能 | pass |${includeGenerated ? `\n| \`${GENERATED}\` | A | package owner | 生成物 | 生成元${REVIEWED}と対応 | source → dist | AC-WF-005 / SCN-1389-01 | 配布影響確認済み、revert可能 | pass |` : ""}

## 2. 受け入れ条件の確認
合格。
## 3. 肯定的評価
成立。
## 4. 敵対的評価
| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 直接反例 | pass | 反例確認済み。 |
| 範囲漏れ | dist・文書・schema・test | pass | 22監査pathと生成物5 path |
## 5. 指摘
なし。
## 6. ラウンド固有の確認
収束。
## 7. テスト結果
合格。
## 8. 配布物影響
判断: 配布物を更新しない
根拠: fixtureのreview artifact検査だけで配布物を変更しない。
## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated（未宣言時の既定） |
| その要求を満たすこと | はい（fixture） |
| reviewerとimplementerのidentity・context比較 | reviewer-context != implementer-context |
| reviewerが対象差分を変更していないこと | はい。製品path変更0件 |

## 10. 仕様整合性
整合。
## 11. 総合判定と再開地点
- 未解決Critical/High: 0件
- 判定: approved
`;
}

function forwardReviewArtifact(
  base: string,
  implementation: string,
  includeGenerated = false,
): string {
  return auditableReviewArtifact(
    base,
    implementation,
    includeGenerated,
  ).replace(
    `| \`${REVIEWED}\` | A | package owner | domain | fixture実装 | 循環なし | AC-1377-01 / SCN-1377-01 | revert可能 | pass |`,
    `| \`${REVIEWED}\` | A | package owner | domain | fixture実装 | 循環なし | AC-1389-01 / SCN-1389-01 | revert可能 | pass |\n| \`${INITIAL_FORWARD_ARTIFACT}\` | A | package owner | documentation | 前round証跡を保持 | 循環なし | AC-1389-01 / SCN-1389-01 | revert可能 | pass |`,
  );
}

function recordForwardRound(
  world: ReanchorWorld,
  implementation: string,
  recordIntake: boolean,
  includeGenerated = false,
): void {
  const previous = readStoredReviewSession(world.staging);
  assert.ok(previous, "先行review sessionがありません");
  recordReviewRound({
    staging: world.staging,
    round: parseReviewRoundInput({
      round: 2,
      previousRoundDigest: previous.latestRoundDigest,
      anchor: previous.anchor,
      candidateHeadSha: implementation,
      focus: {
        previousBlocking: [],
        fixedDiff: [
          INITIAL_FORWARD_ARTIFACT,
          REVIEWED,
          ...(includeGenerated ? [GENERATED] : []),
        ].sort(),
        adjacentScope: [],
      },
      findings: [],
    }),
  });
  const session = readStoredReviewSession(world.staging);
  assert.ok(session, "更新後review sessionがありません");
  if (!recordIntake) return;
  const definition = WORKFLOW_STEPS.find((candidate) => candidate.step === 10);
  assert.ok(definition, "Step 10定義がありません");
  const intakeEntry = {
    step: 10,
    skillId: definition.skillId,
    mode: "quick" as const,
    recordedAt: INSTANT.toISOString(),
    artifacts: [FORWARD_ARTIFACT],
    evidence: "pr-bound後の外部review指摘を新roundで確認した",
    reviewSession: {
      sessionId: session.sessionId,
      roundDigest: session.latestRoundDigest,
      headSha: session.latestCandidateHeadSha,
    },
    postPrIntake: true as const,
  };
  const first = appendWorkflowJournalEntry({
    staging: world.staging,
    entry: intakeEntry,
    headSha: implementation,
  });
  const beforeCount = readWorkflowJournal(world.staging).entries.length;
  const repeated = appendWorkflowJournalEntry({
    staging: world.staging,
    entry: {
      ...intakeEntry,
      recordedAt: new Date(INSTANT.getTime() + 1000).toISOString(),
      evidence: "同じbindingを安全に再実行した",
    },
    headSha: implementation,
  });
  world.intakeIdempotent =
    repeated.journalDigest === first.journalDigest &&
    readWorkflowJournal(world.staging).entries.length === beforeCount;
}

function forwardFixture(
  world: ReanchorWorld,
  recordIntake: boolean,
  includeGenerated = false,
  forwardArtifactPath = FORWARD_ARTIFACT,
): void {
  world.root = world.initRepo();
  world.baseSha = git(world.root, ["rev-parse", "HEAD"]);
  let initialImplementation = commit(
    world.root,
    "export const reviewed = 1;\n",
    "feat: initial review対象",
  );
  if (includeGenerated)
    initialImplementation = commitPath(
      world.root,
      GENERATED,
      "export const reviewed = 1;\n",
      "build: initial generated review対象",
    );
  world.oldHeadSha = commitPath(
    world.root,
    INITIAL_FORWARD_ARTIFACT,
    auditableReviewArtifact(
      world.baseSha,
      initialImplementation,
      includeGenerated,
    ),
    "docs: initial review artifact",
  );
  world.staging = makeStaging(world);
  buildApprovedReviewBinding(world, initialImplementation);
  buildDelivery(world, false);
  execFileSync("git", ["checkout", "-q", world.oldHeadSha], {
    cwd: world.root,
  });
  let implementation = commit(
    world.root,
    "export const reviewed = 2;\n",
    "fix: external reviewer指摘を反映",
  );
  if (includeGenerated)
    implementation = commitPath(
      world.root,
      GENERATED,
      "export const reviewed = 2;\n",
      "build: generated review対象を同期",
    );
  recordForwardRound(world, implementation, recordIntake, includeGenerated);
  world.newHeadSha = commitPath(
    world.root,
    forwardArtifactPath,
    forwardReviewArtifact(world.baseSha, implementation, includeGenerated),
    "docs: post-PR review artifact",
  );
  world.newBaseSha = world.baseSha;
}

Given(
  "pr-bound後に前進した実装と明示済みpost-PR intakeのreview artifactがある",
  function () {
    /** 版管理下の生成物を含む監査表もreviewed-forwardで受理する。 */
    forwardFixture(this, true, true);
  },
);

Given(
  "pr-bound後に前進した実装と「{word}」へ置いたpost-PR intakeのreview artifactがある",
  function (name: string) {
    forwardFixture(this, true, true, placement(name));
  },
);

Given("pr-bound後のreviewed-forward反例「{word}」がある", function (kind) {
  forwardFixture(this, true);
  if (kind === "未収束") {
    const sessionFile = path.join(this.staging, "review-session.json");
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as Record<
      string,
      unknown
    >;
    session.status = "active";
    fs.writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
    refreshStoredStagingDigest(this.staging);
  } else if (kind === "古いround") {
    const journalFile = path.join(this.staging, "journal/steps.jsonl");
    const entries = fs
      .readFileSync(journalFile, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const latest = entries.at(-1) as Record<string, unknown>;
    latest.reviewSession = {
      ...(latest.reviewSession as Record<string, unknown>),
      roundDigest: "0".repeat(64),
    };
    fs.writeFileSync(
      journalFile,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    refreshStoredStagingDigest(this.staging);
  } else if (kind === "artifact外差分") {
    this.newHeadSha = commit(
      this.root,
      "export const reviewed = 3;\n",
      "fix: unreviewed product change",
    );
  } else if (kind === "artifact二段") {
    const artifact = fs.readFileSync(
      path.join(this.root, FORWARD_ARTIFACT),
      "utf8",
    );
    this.newHeadSha = commitPath(
      this.root,
      FORWARD_ARTIFACT,
      `${artifact}\n`,
      "docs: mutate terminal artifact twice",
    );
  } else if (kind === "非ancestor") {
    const current = this.newHeadSha;
    execFileSync("git", ["checkout", "-q", this.baseSha], { cwd: this.root });
    const unrelated = commitPath(
      this.root,
      "unrelated.ts",
      "export const unrelated = true;\n",
      "feat: unrelated delivery head",
    );
    execFileSync("git", ["checkout", "-q", current], { cwd: this.root });
    const deliveryFile = path.join(this.staging, "journal/delivery-state.json");
    const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
      create: { headSha: string };
    };
    delivery.create.headSha = unrelated;
    fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
    refreshStoredStagingDigest(this.staging);
  } else assert.fail(`未知の反例: ${kind}`);
});

Given(
  "pr-bound後に前進した実装と未記録のpost-PR intakeのreview artifactがある",
  function () {
    forwardFixture(this, false);
  },
);

/** 旧命名時点から再生成される派生監査欄だけが異なる実運用相当artifact。 */
function legacyAuditableReviewArtifact(
  base: string,
  implementation: string,
): string {
  return auditableReviewArtifact(base, implementation)
    .replace("| Step chain | 経由: fixture |", "| Step chain | fixture |")
    .replace(
      "| `src/domain/reviewed.ts` | A | package owner | domain | fixture実装 | 循環なし | AC-1377-01 / SCN-1377-01 | revert可能 | pass |",
      "| `src/domain/reviewed.ts` | A | package owner | domain | fixture実装 | 循環なし | AC-1377-01 / SCN-1377-01 | revert可能 | pass |\n| `dist/src/domain/reviewed.js` | A | generated | distribution | fixture配布物 | 循環なし | AC-1377-01 / SCN-1377-01 | buildで再生成 | pass |",
    )
    .replace(
      "判断: 配布物を更新しない\n根拠: fixtureのreview artifact検査だけで配布物を変更しない。",
      "判断: 配布物を更新した\n根拠: sourceとdistを更新した。",
    )
    .replace(
      "| 範囲漏れ | dist・文書・schema・test | pass | 22監査pathと生成物5 path |",
      "| 範囲漏れ | dist・文書・schema・test | pass | 27 path監査 |",
    );
}

/** 4-backtick内の短いdelimiterを閉じ括弧と誤認すると判断行を隠せる反例。 */
function fenceAmbiguousReviewArtifact(
  artifact: string,
  coverageRow: string,
): string {
  return artifact.replace(
    "| 範囲漏れ | dist・文書・schema・test | pass | 22監査pathと生成物5 path |",
    `\`\`\`\`text
\`\`\`
### 1.1 変更ファイル個別監査
\`\`\`suffix
\`\`\`\`
${coverageRow}`,
  );
}

function buildApprovedReviewBinding(
  world: ReanchorWorld,
  implementation: string,
): void {
  const finalHead = world.oldHeadSha;
  const currentHead = git(world.root, ["rev-parse", "HEAD"]);
  world.oldHeadSha = implementation;
  execFileSync("git", ["checkout", "-q", implementation], { cwd: world.root });
  buildReviewSession(world, true);
  recordStep10Binding(world);
  execFileSync("git", ["checkout", "-q", currentHead], { cwd: world.root });
  world.oldHeadSha = finalHead;
}

Given(
  "pr-boundの旧artifactと同一実装を監査したevidence-only配置の新artifactがある",
  function () {
    this.root = this.initRepo();
    this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
    const implementation = commit(
      this.root,
      "export const reviewed = 1;\n",
      "feat: review対象",
    );
    this.oldHeadSha = commitPath(
      this.root,
      "docs/reviews/1377_レビュー.md",
      legacyAuditableReviewArtifact(this.baseSha, implementation),
      "docs: old artifact",
    );
    this.staging = makeStaging(this);
    buildApprovedReviewBinding(this, implementation);
    buildDelivery(this, false);
    snapshot(this);
    execFileSync("git", ["checkout", "-q", implementation], { cwd: this.root });
    this.newHeadSha = commitPath(
      this.root,
      "docs/reviews/209_課題1377成果物再固定レビュー.md",
      auditableReviewArtifact(this.baseSha, implementation),
      "docs: renamed artifact",
    );
    this.newBaseSha = this.baseSha;
  },
);

Given(
  "pr-boundの旧artifactと同一実装を監査した「{word}」の新artifactがある",
  function (name: string) {
    this.root = this.initRepo();
    this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
    const implementation = commit(
      this.root,
      "export const reviewed = 1;\n",
      "feat: review対象",
    );
    this.oldHeadSha = commitPath(
      this.root,
      "docs/reviews/1377_レビュー.md",
      legacyAuditableReviewArtifact(this.baseSha, implementation),
      "docs: old artifact",
    );
    this.staging = makeStaging(this);
    buildApprovedReviewBinding(this, implementation);
    buildDelivery(this, false);
    snapshot(this);
    execFileSync("git", ["checkout", "-q", implementation], { cwd: this.root });
    this.newHeadSha = commitPath(
      this.root,
      placement(name),
      auditableReviewArtifact(this.baseSha, implementation),
      "docs: relocated artifact",
    );
    this.newBaseSha = this.baseSha;
  },
);

Given(
  "固定済みPR identityを持つstagingと「{word}」へ置いた等価なrebaseがある",
  function (name: string) {
    artifactFixture(this, undefined, placement(name));
  },
);

/**
 * **候補が1件でない差分は同定できない（Issue #1433）。**
 *
 * allowlist配下のartifactを新head側だけ2件にする。`terminalArtifactPath`が
 * 1件へ絞れないことを要求する条件を、**変異試験B2（`length === 1`を`>= 1`へ
 * 緩める）が生存したため足した。** 緩めると先頭1件を任意に選んでしまい、
 * どのartifactをreview証跡とみなしたかが差分から決まらなくなる。
 */
Given(
  "固定済みPR identityを持つstagingとartifactが2件変わる等価なrebaseがある",
  function () {
    artifactFixture(this);
    this.newHeadSha = commitPath(
      this.root,
      "docs/reviews/227_課題1433二件目レビュー.md",
      reviewArtifact(this.newBaseSha, this.newHeadSha),
      "docs: 2件目のreview artifactを記録する",
    );
  },
);

Given("pr-boundの不正なartifact replacement「{word}」がある", function (kind) {
  this.root = this.initRepo();
  this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
  const implementation = commit(
    this.root,
    "export const reviewed = 1;\n",
    "feat: review対象",
  );
  const oldArtifact = auditableReviewArtifact(this.baseSha, implementation);
  this.oldHeadSha = commitPath(
    this.root,
    "docs/reviews/1377_レビュー.md",
    kind === "fence解釈差"
      ? fenceAmbiguousReviewArtifact(
          oldArtifact,
          "| 範囲漏れ | dist・文書・schema・test | pass | 22監査pathと生成物5 path |",
        )
      : oldArtifact,
    "docs: old artifact",
  );
  this.staging = makeStaging(this);
  buildApprovedReviewBinding(this, implementation);
  buildDelivery(this, false);
  const replacementImplementation =
    kind === "H_impl差替え"
      ? (() => {
          execFileSync("git", ["checkout", "-q", this.baseSha], {
            cwd: this.root,
          });
          return commit(
            this.root,
            "export const reviewed = 1;\n",
            "feat: alternate review対象",
          );
        })()
      : implementation;
  execFileSync("git", ["checkout", "-q", replacementImplementation], {
    cwd: this.root,
  });
  const artifact = auditableReviewArtifact(
    this.baseSha,
    replacementImplementation,
  );
  this.newHeadSha = commitPath(
    this.root,
    "docs/reviews/209_課題1377成果物再固定レビュー.md",
    kind === "監査不合格"
      ? artifact.replace("| pass |", "| fail |")
      : kind === "判定本文改変"
        ? artifact.replace("反例確認済み。", "反例を省略した。")
        : kind === "範囲漏れ判断改変"
          ? artifact.replace(
              "| 範囲漏れ | dist・文書・schema・test | pass | 22監査pathと生成物5 path |",
              "| 範囲漏れ | dist・文書・schema・test | finding | 未監査 |",
            )
          : kind === "fence解釈差"
            ? fenceAmbiguousReviewArtifact(
                artifact,
                "| 範囲漏れ | dist・文書・schema・test | finding | 未監査 |",
              )
            : artifact,
    "docs: invalid renamed artifact",
  );
  if (kind === "artifact外差分") {
    fs.writeFileSync(
      path.join(this.root, REVIEWED),
      "export const reviewed = 2;\n",
    );
    execFileSync("git", ["add", REVIEWED], { cwd: this.root });
    execFileSync("git", ["commit", "--amend", "--no-edit", "-q"], {
      cwd: this.root,
    });
    this.newHeadSha = git(this.root, ["rev-parse", "HEAD"]);
  }
  this.newBaseSha = this.baseSha;
  if (kind === "chain断裂") {
    const invalid: EvidenceReanchorRecord = {
      oldHeadSha: "a".repeat(40),
      newHeadSha: "b".repeat(40),
      oldBaseSha: this.baseSha,
      newBaseSha: this.baseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "連鎖しない記録",
      recordedAt: INSTANT.toISOString(),
    };
    const file = path.join(this.staging, EVIDENCE_REANCHOR_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(invalid)}\n`);
  }
  this.invalidBaselineChainLength = readEvidenceReanchorChain(
    this.staging,
  ).length;
});

function commitPath(
  root: string,
  relative: string,
  body: string,
  message: string,
): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  execFileSync("git", ["add", relative], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * ASCの規定するrebase手順を再現する。
 *
 * 実装commitとreview artifact commitの2 commit構造を作り、rebase後に
 * **artifactのSHA行だけを更新する**。`audit:check`はこの更新を要求し、
 * 従来の完全diff digestはこの更新を必ず拒否する（Issue #1172）。
 */
function artifactFixture(
  world: ReanchorWorld,
  mutateArtifact?: (base: string, implementation: string) => string,
  artifactPath = REVIEW_ARTIFACT,
): void {
  world.root = world.initRepo();
  world.baseSha = git(world.root, ["rev-parse", "HEAD"]);
  const implementation = commit(
    world.root,
    "export const reviewed = 1;\n",
    "feat: レビュー対象",
  );
  world.oldHeadSha = commitPath(
    world.root,
    artifactPath,
    reviewArtifact(world.baseSha, implementation),
    "docs: review artifactを記録する",
  );
  world.staging = makeStaging(world);
  buildDelivery(world);
  /** 新baseは対象pathへ触れない。 */
  execFileSync("git", ["checkout", "-q", world.baseSha], { cwd: world.root });
  const upstream = path.join(world.root, "upstream.ts");
  fs.writeFileSync(upstream, "export const upstream = 1;\n");
  execFileSync("git", ["add", "upstream.ts"], { cwd: world.root });
  execFileSync("git", ["commit", "-q", "-m", "chore: 既定branchが進む"], {
    cwd: world.root,
  });
  const newBase = git(world.root, ["rev-parse", "HEAD"]);
  const newImplementation = commit(
    world.root,
    "export const reviewed = 1;\n",
    "feat: レビュー対象",
  );
  const body = mutateArtifact
    ? mutateArtifact(newBase, newImplementation)
    : reviewArtifact(newBase, newImplementation);
  world.newHeadSha = commitPath(
    world.root,
    artifactPath,
    body,
    "docs: review artifactを記録する",
  );
  world.newBaseSha = newBase;
}

/** artifactの記述は保ったまま実装fileの内容だけを変えるrebase。 */
function artifactFixtureWithChangedImplementation(world: ReanchorWorld): void {
  artifactFixture(world);
  /** 新head側の実装内容を変えて2 commit構造を作り直す。 */
  execFileSync("git", ["checkout", "-q", world.newBaseSha], {
    cwd: world.root,
  });
  const implementation = commit(
    world.root,
    "export const reviewed = 2;\n",
    "feat: レビュー対象",
  );
  world.newHeadSha = commitPath(
    world.root,
    REVIEW_ARTIFACT,
    reviewArtifact(world.newBaseSha, implementation),
    "docs: review artifactを記録する",
  );
}

Given("実装の内容まで変わったrebase後のreview証跡がある", function () {
  artifactFixtureWithChangedImplementation(this);
});

Given("識別情報の節が2つあるrebase後のreview証跡がある", function () {
  artifactFixture(
    this,
    (base, implementation) =>
      `${reviewArtifact(base, implementation)}\n## 0. レビュー識別情報\n\n二重の節\n`,
  );
});

Given(
  "比較基点の宣言が再固定の基点と違うrebase後のreview証跡がある",
  function () {
    artifactFixture(this, (_base, implementation) =>
      reviewArtifact("0".repeat(40), implementation),
    );
  },
);

Given("artifactのpathが変わったrebase後のreview証跡がある", function () {
  artifactFixture(this);
  execFileSync("git", ["checkout", "-q", world_newBase(this)], {
    cwd: this.root,
  });
  const implementation = commit(
    this.root,
    "export const reviewed = 1;\n",
    "feat: レビュー対象",
  );
  this.newHeadSha = commitPath(
    this.root,
    "docs/reviews/98_課題1172別名レビュー.md",
    reviewArtifact(this.newBaseSha, implementation),
    "docs: review artifactを記録する",
  );
});

function world_newBase(world: ReanchorWorld): string {
  return world.newBaseSha;
}

Given(
  "識別情報の見出しが本文中にしかないrebase後のreview証跡がある",
  function () {
    artifactFixture(
      this,
      (base, implementation) =>
        `# 04 レビュー\n\n本文で ## 0. レビュー識別情報 と書くだけで見出しは無い。\n\n| 比較基点 | \`${base}\` |\n| H_impl | \`${implementation}\` |\n`,
    );
  },
);

Given("存在しないH_implを宣言したrebase後のreview証跡がある", function () {
  artifactFixture(this, (base) => reviewArtifact(base, "0".repeat(40)));
});

Given("SHA行だけを更新したrebase後のreview証跡がある", function () {
  artifactFixture(this);
});

Given("SHA行に加えて判定も書き換えたrebase後のreview証跡がある", function () {
  artifactFixture(this, (base, implementation) =>
    reviewArtifact(base, implementation).replace("approved", "rejected"),
  );
});

Given("識別情報の欄を重複させたrebase後のreview証跡がある", function () {
  artifactFixture(this, (base, implementation) =>
    reviewArtifact(
      base,
      implementation,
      `\n\n| H_impl | \`${"0".repeat(40)}\` |`,
    ).replace(
      "| 実施者 | reviewer |",
      `| 実施者 | reviewer |\n| H_impl | \`${"0".repeat(40)}\` |`,
    ),
  );
});

Given("H_implの宣言が構造と一致しないrebase後のreview証跡がある", function () {
  artifactFixture(this, (base) => reviewArtifact(base, base));
});

function baseFixture(world: ReanchorWorld): void {
  world.root = world.initRepo();
  world.baseSha = git(world.root, ["rev-parse", "HEAD"]);
  world.oldHeadSha = commit(
    world.root,
    "export const reviewed = 1;\n",
    "feat: レビュー対象",
  );
  world.staging = makeStaging(world);
}

function applyReanchor(
  world: ReanchorWorld,
  layer: "delivery" | "review",
): void {
  snapshot(world);
  try {
    const result = appendEvidenceReanchor({
      staging: world.staging,
      root: world.root,
      layer,
      newHeadSha: world.newHeadSha,
      newBaseSha: world.newBaseSha,
      reason: "既定branchが動いたためrebaseした",
      recordedAt: INSTANT.toISOString(),
    });
    world.chain = [...result.chain];
    world.effectiveHead = result.effectiveHeadSha;
    world.applied = true;
  } catch (error) {
    world.error = error;
    world.applied = false;
  }
}

/**
 * Step 1・4・9・10のjournal entryを実APIで書く。
 *
 * **Step 10 bindingは旧headを指す。** rebase前に記録された状態を再現するためである。
 * `assertCurrentReviewJournalBinding`が実効HEADで照合するようになっていなければ、
 * この状態から新headでの検査は必ず落ちる。
 */
function recordStep10Binding(world: ReanchorWorld): void {
  const session = readStoredReviewSession(world.staging);
  assert.ok(session, "review sessionがありません");
  for (const step of [10]) {
    const definition = WORKFLOW_STEPS.find(
      (candidate) => candidate.step === step,
    );
    assert.ok(definition, `step ${step}がありません`);
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: {
        step,
        skillId: definition.skillId,
        mode: "quick",
        recordedAt: INSTANT.toISOString(),
        artifacts: [`artifact-${step}`],
        evidence: `step ${step}の固定証拠`,
        ...(step === 10
          ? {
              reviewSession: {
                sessionId: session.sessionId,
                roundDigest: session.latestRoundDigest,
                headSha: session.latestCandidateHeadSha,
              },
            }
          : {}),
      },
    });
  }
}

Given("固定済みPR identityを持つstagingと等価なrebaseがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given(
  "固定済みPR identityを持つstagingと内容が変わったrebaseがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    const replayed = replay(this, (file) => {
      fs.writeFileSync(file, "export const reviewed = 2;\n");
    });
    this.newBaseSha = replayed.newBase;
    this.newHeadSha = replayed.newHead;
  },
);

Given(
  "固定済みPR identityを持つstagingとfile modeだけが変わったrebaseがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    const replayed = replay(this, (file) => {
      fs.chmodSync(file, 0o755);
    });
    this.newBaseSha = replayed.newBase;
    this.newHeadSha = replayed.newHead;
  },
);

Given(
  "固定済みPR identityを持つstagingと移動していないheadがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    this.newBaseSha = this.baseSha;
    this.newHeadSha = this.oldHeadSha;
  },
);

Given("固定済みPR identityを持つstagingと解決できないSHAがある", function () {
  baseFixture(this);
  buildDelivery(this);
  this.newBaseSha = "f".repeat(40);
  this.newHeadSha = "e".repeat(40);
});

Given("delivery stateを持たないstagingがある", function () {
  baseFixture(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("delivery stateがstep11-recorded以外のstagingがある", function () {
  baseFixture(this);
  buildDelivery(this, false);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("連鎖条件を満たさない再固定chainがある", function () {
  baseFixture(this);
  this.chain = [
    {
      oldHeadSha: "a".repeat(40),
      newHeadSha: "b".repeat(40),
      oldBaseSha: this.baseSha,
      newBaseSha: this.baseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "連鎖しない記録",
      recordedAt: INSTANT.toISOString(),
    },
  ];
});

Given("再固定記録を持たないstagingがある", function () {
  baseFixture(this);
  this.chain = [];
});

Given("共通評価が成功した再固定fixtureがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
  const evaluation = evaluateEvidenceReanchor({
    staging: this.staging,
    root: this.root,
    layer: "delivery",
    newHeadSha: this.newHeadSha,
    newBaseSha: this.newBaseSha,
    reason: "共通評価の後にstateを変える",
  });
  assert.equal(evaluation.appended, true);
});

Given("実効HEADを持つstagingとproviderを観測できない環境がある", function () {
  baseFixture(this);
  this.effectiveHead = this.oldHeadSha;
});

Given("実効HEADがPR headの祖先でないstagingがある", function () {
  baseFixture(this);
  this.effectiveHead = this.oldHeadSha;
  /**
   * **前進commitではなく、baseから分岐した別系譜のheadを作る。**
   * 前進commitだと実効HEADが祖先になり`reachable`になってしまう。
   * force-pushでheadが書き換えられた状態を再現する。
   */
  execFileSync("git", ["checkout", "-q", this.baseSha], { cwd: this.root });
  this.newHeadSha = commit(
    this.root,
    "export const rewritten = 1;\n",
    "feat: 書き換えられたhead",
  );
});

When("再固定を適用する", function () {
  applyReanchor(this, "delivery");
});

When("delivery層の再固定を適用する", function () {
  applyReanchor(this, "delivery");
});

When("review層の再固定を適用する", function () {
  applyReanchor(this, "review");
});

When("両方の再固定を適用する", function () {
  applyReanchor(this, "delivery");
  const first = this.error;
  applyReanchor(this, "review");
  assert.ok(first, "delivery層が拒否していません");
});

When("再固定を二回適用する", function () {
  applyReanchor(this, "delivery");
  assert.equal(
    this.applied,
    true,
    `一回目が失敗しました: ${String(this.error)}`,
  );
  applyReanchor(this, "delivery");
});

When(
  "reanchor公開後かつstaging digest更新前の停止から同じ入力を再実行する",
  function () {
    const recordFile = path.join(this.staging, "staging-record.json");
    const beforeRecord = fs.readFileSync(recordFile, "utf8");
    applyReanchor(this, "delivery");
    assert.equal(this.applied, true, String(this.error));
    fs.writeFileSync(recordFile, beforeRecord);
    applyReanchor(this, "delivery");
  },
);

When("評価後に連鎖不正なchainを保存して再固定を適用する", function () {
  const invalid: EvidenceReanchorRecord = {
    oldHeadSha: "a".repeat(40),
    newHeadSha: "b".repeat(40),
    oldBaseSha: this.baseSha,
    newBaseSha: this.newBaseSha,
    diffDigest: "d".repeat(64),
    method: "rebase",
    reason: "評価後に保存された不正chain",
    recordedAt: INSTANT.toISOString(),
  };
  const file = path.join(this.staging, EVIDENCE_REANCHOR_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  this.observableBefore = `${JSON.stringify(invalid)}\n`;
  fs.writeFileSync(file, this.observableBefore);
  applyReanchor(this, "delivery");
});

When("実効HEADを導出する", function () {
  const derived = deriveEffectiveHead({
    records: this.chain,
    anchoredHeadSha: this.oldHeadSha,
  });
  this.effectiveHead = derived.effectiveHeadSha;
  /**
   * **実効HEADが動いたなら事象時刻も動く**（Issue #969）。CI配送判定は
   * この時刻からの経過で`pending`と`undelivered`を分ける。元の固定時刻の
   * ままだと、再固定直後の未生成を`undelivered`と誤分類する。
   */
  this.effectiveRecordedAt = derived.effectiveRecordedAt;
});

Given("成立する再固定chainがある", function () {
  baseFixture(this);
  this.chain = [
    {
      oldHeadSha: this.oldHeadSha,
      newHeadSha: "c".repeat(40),
      oldBaseSha: this.baseSha,
      newBaseSha: this.baseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "等価なrebase",
      recordedAt: "2026-09-05T12:00:00.000Z",
    },
  ];
});

Then("実効HEADの再固定時刻を返す", function () {
  assert.equal(this.effectiveRecordedAt, "2026-09-05T12:00:00.000Z");
});

Then("再固定時刻を返さない", function () {
  assert.equal(this.effectiveRecordedAt, undefined);
});

When("到達性を判定する", function () {
  this.reachability = observeReachability({
    effectiveHeadSha: this.effectiveHead,
    providerHeadSha: this.newHeadSha === "" ? undefined : this.newHeadSha,
    isAncestor:
      this.newHeadSha === ""
        ? undefined
        : (descendant: string) => {
            try {
              execFileSync(
                "git",
                ["merge-base", "--is-ancestor", this.effectiveHead, descendant],
                { cwd: this.root, stdio: "ignore" },
              );
              return true;
            } catch {
              return false;
            }
          },
  }).state;
});

When("再固定の入力契約を調べる", function () {
  this.applied = true;
});

Then("再固定chainは1件伸び実効HEADは新headになる", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.chain.length, 1);
  assert.equal(this.effectiveHead, this.newHeadSha);
  /**
   * **staging recordのartifact一覧とdigestが追記へ追随していることを測る。**
   * `refreshStoredStagingDigest`を呼ばない変異はここで落ちる。
   */
  const record = JSON.parse(
    fs.readFileSync(path.join(this.staging, "staging-record.json"), "utf8"),
  ) as { artifacts: string[] };
  assert.ok(
    record.artifacts.includes("journal/reanchor.jsonl"),
    `staging recordが追記へ追随していません: ${JSON.stringify(record.artifacts)}`,
  );
});

Then("再固定chainを重複させずstaging digestが新chainへ一致する", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(readEvidenceReanchorChain(this.staging).length, 1);
  const stored = JSON.parse(
    fs.readFileSync(path.join(this.staging, "staging-record.json"), "utf8"),
  ) as { artifacts: string[]; digest: string };
  assert.equal(
    stored.digest,
    calculateStagingDigest(this.staging, stored.artifacts),
  );
});

Then("delivery stateとjournalは1 byteも変わらない", function () {
  assert.equal(this.applied, true, String(this.error));
  for (const [relative, expected] of Object.entries(this.before)) {
    const actual = fs.readFileSync(path.join(this.staging, relative), "utf8");
    assert.equal(actual, expected, `${relative}が変化しました`);
  }
});

Then("再固定は{string}を理由に拒否される", function (reason: string) {
  assert.equal(this.applied, false, "拒否されていません");
  const message = String(this.error);
  /**
   * **理由まで検査する。** 拒否の有無だけを見ると、別の条件で落ちた場合も通る。
   * 実際、理由を1種類にしていたときは条件を外す変異が5件生存した（Issue #1172）。
   */
  assert.match(
    message,
    new RegExp(`再固定前後の内容が等価ではありません（${reason}）`, "u"),
  );
});

Then("新H_impl比較の診断に4 SHAとH_implが含まれる", function () {
  const message = String(this.error);
  assert.match(message, /役割=新H_impl→新head/u);
  for (const sha of [
    this.baseSha,
    this.oldHeadSha,
    this.newBaseSha,
    this.newHeadSha,
    "0".repeat(40),
  ])
    assert.match(message, new RegExp(sha, "u"));
});

Then("再固定は拒否され両側のdiff digestが理由に含まれる", function () {
  assert.equal(this.applied, false, "拒否されていません");
  const message = String(this.error);
  /**
   * **両側のdigestが揃って出ることを測る。** 1件だけの検査では、
   * `before`か`after`の一方を出力しない回帰を通してしまう。
   */
  assert.match(message, /before=[0-9a-f]{64}/u);
  assert.match(message, /after=[0-9a-f]{64}/u);
  const before = /before=([0-9a-f]{64})/u.exec(message)?.[1];
  const after = /after=([0-9a-f]{64})/u.exec(message)?.[1];
  assert.notEqual(before, after, "両側のdigestが同一です");
});

Then("実効HEADは固定済み記録headのままになる", function () {
  assert.equal(this.effectiveHead, this.oldHeadSha);
});

Then("再固定は拒否される", function () {
  assert.equal(this.applied, false, "拒否されていません");
  assert.equal(readEvidenceReanchorChain(this.staging).length, 0);
});

Then("収束判定は新headと一致する", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.effectiveHead, this.newHeadSha);
});

Then("到達性はunverifiableになる", function () {
  assert.equal(this.reachability, "unverifiable");
});

Then("到達性はrewrittenになる", function () {
  assert.equal(this.reachability, "rewritten");
});

Then("どちらも拒否され復旧経路が案内される", function () {
  assert.equal(this.applied, false);
  assert.match(String(this.error), /pr reanchor|pr create/u);
});

Then("再固定chainは1件のままになる", function () {
  /**
   * **二回目が「成功して追記しない」ことを測る。**
   * 冪等判定を外すと二回目は同一head拒否で例外になる。chainの長さだけを見ると
   * どちらも1件で区別できない。終了の成否が唯一の観測点である。
   */
  assert.equal(
    this.applied,
    true,
    `二回目が成功していません: ${String(this.error)}`,
  );
  assert.equal(this.chain.length, 1);
  assert.equal(readEvidenceReanchorChain(this.staging).length, 1);
  /**
   * **file上の行数も測る。** 冪等判定を外した変異は、同じ記録を二重に積んでも
   * `deriveEffectiveHead`が2件目を連鎖違反として捨てるため、chainの長さだけでは
   * 検出できない。実fileの行数が唯一の観測点である。
   */
  const lines = fs
    .readFileSync(path.join(this.staging, "journal/reanchor.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, "同一記録が二重に積まれています");
});

Then("最新chainの不整合を拒否しchainへ追記しない", function () {
  assert.equal(this.applied, false, "不整合な最新chainを受理しました");
  assert.match(String(this.error), /既存の再固定chainが0件目/u);
  assert.equal(
    fs.readFileSync(path.join(this.staging, EVIDENCE_REANCHOR_FILE), "utf8"),
    this.observableBefore,
  );
});

Then("旧baseと旧headを受け取る引数が存在しない", function () {
  const source = fs.readFileSync("src/adapters/evidence-reanchor.ts", "utf8");
  const inputContract =
    /export function appendEvidenceReanchor\(input: \{(?<fields>[\s\S]*?)\n\}\): EvidenceReanchorResult/u.exec(
      source,
    )?.groups?.fields ?? "";
  assert.notEqual(
    inputContract,
    "",
    "appendEvidenceReanchorの入力契約を読めません",
  );
  assert.ok(
    !/oldHeadSha\s*[?:]/u.test(inputContract),
    "appendEvidenceReanchorが旧headを引数で受け取っています",
  );
  assert.ok(
    !/oldBaseSha\s*[?:]/u.test(inputContract),
    "appendEvidenceReanchorが旧baseを引数で受け取っています",
  );
});

/**
 * 収束済みまたは未収束のreview sessionを作る。
 *
 * **`recordReviewRound`を実際に通す。** session fileを手で書くと、round契約と
 * 実装の乖離を検査できない。
 */
function buildReviewSession(world: ReanchorWorld, converged: boolean): void {
  const observed = observeReviewDiff(
    world.root,
    world.baseSha,
    world.oldHeadSha,
  );
  for (const step of [1, 4, 9]) {
    const definition = WORKFLOW_STEPS.find(
      (candidate) => candidate.step === step,
    );
    assert.ok(definition, `step ${step}がありません`);
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: {
        step,
        skillId: definition.skillId,
        mode: "quick",
        recordedAt: INSTANT.toISOString(),
        artifacts: [`artifact-${step}`],
        evidence: `step ${step}の固定証拠`,
        ...(step === 9 ? { implementationHeadSha: world.oldHeadSha } : {}),
      },
    });
  }
  recordReviewRound({
    staging: world.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-1093"],
        acceptanceCriteriaIds: ["AC-1093-07"],
        invariantIds: ["INV-02"],
        diffBaseSha: world.baseSha,
        initialHeadSha: world.oldHeadSha,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: world.oldHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: converged
        ? []
        : [
            {
              id: "H-1093",
              severity: "High",
              status: "valid",
              source: "review",
              relation: "acceptance-violation",
              evidence: "収束していないsessionを作るための未解決finding",
              path: REVIEWED,
              contractId: "AC-1093-07",
              causedByFindingId: null,
            },
          ],
    }),
  });
}

Given("収束済みreview sessionと等価なrebaseがある", function () {
  baseFixture(this);
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  buildReviewSession(this, true);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("収束していないreview sessionと等価なrebaseがある", function () {
  baseFixture(this);
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  buildReviewSession(this, false);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
  this.unconverged = true;
});

Given("実git fixtureのstagingがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("旧baseが旧headの祖先でないdelivery stateがある", function () {
  baseFixture(this);
  const originalBase = this.baseSha;
  execFileSync("git", ["checkout", "-q", originalBase], { cwd: this.root });
  const sibling = path.join(this.root, "sibling.ts");
  fs.writeFileSync(sibling, "export const sibling = 1;\n");
  execFileSync("git", ["add", "sibling.ts"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "chore: sibling base"], {
    cwd: this.root,
  });
  this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
  buildDelivery(this);
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  this.newHeadSha = commit(
    this.root,
    "export const reviewed = 1;\nexport const next = 1;\n",
    "feat: new head",
  );
  this.newBaseSha = originalBase;
});

When("同じ再固定入力でpreviewとapplyをCLIから実行する", function () {
  const layer = readStoredDeliveryState(this.staging)?.create ? "pr" : "review";
  this.reanchorCliResults = ["--dry-run", "--apply"].map((mode) =>
    runReanchorCli(this, mode as "--dry-run" | "--apply", { layer }),
  );
});

Then("両方が同じruleIdと理由で拒否し旧側比較役割と4 SHAを示す", function () {
  assert.equal(this.reanchorCliResults.length, 2);
  for (const result of this.reanchorCliResults)
    assert.equal(result.status, 1, JSON.stringify(result.output));
  const [preview, apply] = this.reanchorCliResults.map((result) =>
    JSON.stringify(result.output),
  );
  assert.match(preview ?? "", /ASC-CLI-VALIDATION-001/u);
  assert.match(apply ?? "", /ASC-CLI-VALIDATION-001/u);
  assert.match(preview ?? "", /旧base→旧head/u);
  for (const sha of [
    this.baseSha,
    this.oldHeadSha,
    this.newBaseSha,
    this.newHeadSha,
  ]) {
    assert.match(preview ?? "", new RegExp(sha, "u"));
    assert.match(apply ?? "", new RegExp(sha, "u"));
  }
  assert.equal(preview, apply);
});

Given("新baseが新headの祖先でないdelivery stateがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const originalBase = this.baseSha;
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  this.newHeadSha = commit(
    this.root,
    "export const reviewed = 1;\nexport const next = 1;\n",
    "feat: new head",
  );
  execFileSync("git", ["checkout", "-q", originalBase], { cwd: this.root });
  const sibling = path.join(this.root, "new-base.ts");
  fs.writeFileSync(sibling, "export const newBase = 1;\n");
  execFileSync("git", ["add", "new-base.ts"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "chore: invalid new base"], {
    cwd: this.root,
  });
  this.newBaseSha = git(this.root, ["rev-parse", "HEAD"]);
});

Then("両方が同じruleIdと理由で拒否し新側比較役割と4 SHAを示す", function () {
  assert.equal(this.reanchorCliResults.length, 2);
  for (const result of this.reanchorCliResults)
    assert.equal(result.status, 1, JSON.stringify(result.output));
  const [preview, apply] = this.reanchorCliResults.map((result) =>
    JSON.stringify(result.output),
  );
  assert.equal(preview, apply);
  assert.match(preview ?? "", /ASC-CLI-VALIDATION-001/u);
  assert.match(preview ?? "", /新base→新head/u);
  for (const sha of [
    this.baseSha,
    this.oldHeadSha,
    this.newBaseSha,
    this.newHeadSha,
  ])
    assert.match(preview ?? "", new RegExp(sha, "u"));
});

Given("再固定できるdelivery stateがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

When("不正SHAと空理由とstate欠落をpreviewとapplyで評価する", function () {
  const deliveryRoot = this.root;
  this.root = this.initRepo();
  const missingState = makeStaging(this);
  this.root = deliveryRoot;
  const saved = {
    root: this.root,
    staging: this.staging,
    baseSha: this.baseSha,
    oldHeadSha: this.oldHeadSha,
    newBaseSha: this.newBaseSha,
    newHeadSha: this.newHeadSha,
  };
  const makeIndependentFixture = (): {
    root: string;
    staging: string;
    newBaseSha: string;
    newHeadSha: string;
  } => {
    baseFixture(this);
    buildDelivery(this);
    const replayed = replay(this);
    return {
      root: this.root,
      staging: this.staging,
      newBaseSha: replayed.newBase,
      newHeadSha: replayed.newHead,
    };
  };
  const unsafe = makeIndependentFixture();
  fs.linkSync(
    path.join(unsafe.staging, "journal/delivery-state.json"),
    path.join(unsafe.staging, "delivery-state-hardlink"),
  );
  const invalidTransaction = makeIndependentFixture();
  fs.writeFileSync(
    deliveryStateTransactionPath(invalidTransaction.staging),
    "{}\n",
  );
  Object.assign(this, saved);
  const cases = [
    { newHeadSha: "INVALID" },
    { reason: "" },
    { staging: missingState },
    unsafe,
    invalidTransaction,
  ];
  this.reanchorCliCases = cases.map((options) =>
    ["--dry-run", "--apply"].map((mode) =>
      runReanchorCli(this, mode as "--dry-run" | "--apply", options),
    ),
  );
});

Then("各入力のpreviewとapplyが同じ既存理由で拒否される", function () {
  const expected = [
    /小文字40桁のGit SHA/u,
    /--reason=\.\.\.が必要です/u,
    /pr reanchorには pr create/u,
    /delivery stateはsymlink・hardlinkでない/u,
    /delivery state transactionの構造またはdigestが不正です/u,
  ];
  assert.equal(this.reanchorCliCases.length, expected.length);
  this.reanchorCliCases.forEach((pair, index) => {
    assert.equal(pair.length, 2);
    for (const result of pair)
      assert.equal(result.status, 1, JSON.stringify(result.output));
    const preview = JSON.stringify(pair[0]?.output);
    const apply = JSON.stringify(pair[1]?.output);
    assert.equal(preview, apply);
    assert.match(preview, expected[index] as RegExp);
  });
});

When("stagingとGitを観測してpreviewの後にapplyする", function () {
  this.observableBefore = observableSnapshot(this);
  const preview = runReanchorCli(this, "--dry-run");
  this.observableAfter = observableSnapshot(this);
  const applied = runReanchorCli(this, "--apply");
  this.reanchorCliResults = [preview, applied];
});

Then(
  "previewはstaging親directoryとGitを変えずapplyだけが追記する",
  function () {
    assert.equal(this.reanchorCliResults[0]?.status, 0);
    assert.equal(this.observableAfter, this.observableBefore);
    assert.equal(this.reanchorCliResults[1]?.status, 0);
    assert.equal(readEvidenceReanchorChain(this.staging).length, 1);
  },
);

When("二層等価な入力をpreviewして二回applyする", function () {
  this.observableBefore = observableSnapshot(this);
  const preview = runReanchorCli(this, "--dry-run");
  this.observableAfter = observableSnapshot(this);
  const first = runReanchorCli(this, "--apply");
  const second = runReanchorCli(this, "--apply");
  this.reanchorCliResults = [preview, first, second];
});

Then("previewは成功し初回だけ追記して二回目はunchangedになる", function () {
  assert.deepEqual(
    this.reanchorCliResults.map((result) => result.status),
    [0, 0, 0],
  );
  assert.equal(this.observableAfter, this.observableBefore);
  assert.equal(readEvidenceReanchorChain(this.staging).length, 1);
  assert.equal(this.reanchorCliResults[0]?.output.willAppend, true);
  assert.equal(this.reanchorCliResults[1]?.output.state, "reanchored");
  assert.equal(this.reanchorCliResults[2]?.output.state, "unchanged");
});

Then("再固定recordは旧新artifactのpathとdigestを保持する", function () {
  const record = readEvidenceReanchorChain(this.staging)[0];
  assert.equal(record?.method, "artifact-replacement");
  assert.equal(
    record?.artifactReplacement?.oldPath,
    "docs/reviews/1377_レビュー.md",
  );
  assert.equal(
    record?.artifactReplacement?.newPath,
    "docs/reviews/209_課題1377成果物再固定レビュー.md",
  );
  assert.match(record?.artifactReplacement?.oldDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.match(record?.artifactReplacement?.newDigest ?? "", /^[a-f0-9]{64}$/u);
  for (const [relative, before] of Object.entries(this.before))
    assert.equal(
      fs.readFileSync(path.join(this.staging, relative), "utf8"),
      before,
    );
});

Then("再固定recordはexact post-PR review bindingを保持する", function () {
  const record = readEvidenceReanchorChain(this.staging)[0];
  const session = readStoredReviewSession(this.staging);
  assert.ok(session);
  assert.equal(record?.method, "reviewed-forward");
  assert.equal(record?.reviewedForward?.sessionId, session.sessionId);
  assert.equal(record?.reviewedForward?.roundDigest, session.latestRoundDigest);
  assert.equal(
    record?.reviewedForward?.implementationSha,
    session.latestCandidateHeadSha,
  );
  assert.equal(record?.reviewedForward?.artifactPath, FORWARD_ARTIFACT);
  assert.match(
    record?.reviewedForward?.artifactDigest ?? "",
    /^[a-f0-9]{64}$/u,
  );
});

/**
 * **記録したartifact pathが宣言した配置と一致することを測る（Issue #1433）。**
 *
 * 受理の成否だけを見ると、同定述語が別のpathを拾っても気付けない。methodと
 * pathの両方を名指しする。
 */
Then(
  "再固定recordのartifact pathは「{word}」と一致する",
  function (name: string) {
    const record = readEvidenceReanchorChain(this.staging)[0];
    assert.ok(record, "再固定recordがありません");
    const observed =
      record.method === "reviewed-forward"
        ? record.reviewedForward?.artifactPath
        : record.method === "artifact-replacement"
          ? record.artifactReplacement?.newPath
          : undefined;
    assert.equal(
      observed,
      placement(name),
      `method=${record.method}のartifact pathが一致しません: ${String(observed)}`,
    );
  },
);

Then("reviewed-forwardのpreviewとapplyは拒否され追記しない", function () {
  assert.deepEqual(
    this.reanchorCliResults.map((result) => result.status),
    [1, 1],
  );
  assert.equal(readEvidenceReanchorChain(this.staging).length, 0);
});

When(
  "reviewed-forward再固定後に新headでpr mergeのbinding検査を通す",
  function () {
    applyReanchor(this, "delivery");
    assert.equal(this.applied, true, String(this.error));
    observeBoundPullRequest(this, this.newHeadSha);
    const binaryDirectory = path.join(this.root, "fake-bin");
    const log = path.join(this.root, "merge-provider.log");
    fs.mkdirSync(binaryDirectory, { recursive: true });
    const executable = path.join(binaryDirectory, "gh");
    fs.writeFileSync(
      executable,
      `#!/usr/bin/env node\nconst fs=require("node:fs");const args=process.argv.slice(2);if(args[0]==="repo")process.stdout.write(JSON.stringify({nameWithOwner:"example/repository",viewerPermission:"WRITE"}));if(args[0]==="pr"&&args[1]==="merge")fs.writeFileSync(${JSON.stringify(log)},args.join(" ")+"\\n");\n`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${binaryDirectory}${path.delimiter}${originalPath ?? ""}`;
    try {
      github(
        "pr.merge",
        {
          repository: "example/repository",
          pr: 42,
          method: "merge",
          headSha: this.newHeadSha,
        },
        this.root,
      );
    } finally {
      process.env.PATH = originalPath;
    }
    const arguments_ = fs.readFileSync(log, "utf8").trim().split(" ");
    const headIndex = arguments_.indexOf("--match-head-commit");
    this.mergeDispatchHead = arguments_[headIndex + 1] ?? "";
  },
);

Then("merge providerは新H_finalをexact headとして受け取る", function () {
  assert.equal(this.mergeDispatchHead, this.newHeadSha);
});

Then("post-PR intakeの同一binding再実行はno-opになる", function () {
  assert.equal(this.intakeIdempotent, true);
});

Then("artifact replacementのpreviewとapplyは拒否され追記しない", function () {
  assert.deepEqual(
    this.reanchorCliResults.map((result) => result.status),
    [1, 1],
  );
  assert.equal(
    readEvidenceReanchorChain(this.staging).length,
    this.invalidBaselineChainLength,
  );
});

Then("内容非等価のpreviewとapplyが同じ既存理由で拒否される", function () {
  assert.equal(this.reanchorCliResults.length, 2);
  for (const result of this.reanchorCliResults)
    assert.equal(result.status, 1, JSON.stringify(result.output));
  const preview = JSON.stringify(this.reanchorCliResults[0]?.output);
  const apply = JSON.stringify(this.reanchorCliResults[1]?.output);
  assert.equal(preview, apply);
  assert.match(preview, /artifact-body-changed/u);
});

When("成功preview後にreview sessionを未収束へ変えてapplyする", function () {
  const preview = runReanchorCli(this, "--dry-run", { layer: "review" });
  assert.equal(preview.status, 0, JSON.stringify(preview.output));
  const sessionFile = path.join(this.staging, "review-session.json");
  const session = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as Record<
    string,
    unknown
  >;
  session.status = "active";
  fs.writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
  const applied = runReanchorCli(this, "--apply", { layer: "review" });
  this.reanchorCliResults = [preview, applied];
});

Then("applyは最新状態を拒否しchainを追記しない", function () {
  assert.equal(this.reanchorCliResults[0]?.status, 0);
  assert.equal(this.reanchorCliResults[1]?.status, 1);
  assert.match(
    JSON.stringify(this.reanchorCliResults[1]?.output),
    /review sessionのanchor、latestまたはstatusが再導出値と一致しません/u,
  );
  assert.equal(readEvidenceReanchorChain(this.staging).length, 0);
});

When("stagingとGitを観測して拒否previewを実行する", function () {
  this.observableBefore = observableSnapshot(this);
  const preview = runReanchorCli(this, "--dry-run");
  this.observableAfter = observableSnapshot(this);
  this.reanchorCliResults = [preview];
});

Then("拒否previewはstaging親directoryとGitを変えない", function () {
  assert.equal(this.reanchorCliResults[0]?.status, 1);
  assert.equal(this.observableAfter, this.observableBefore);
  assert.equal(readEvidenceReanchorChain(this.staging).length, 0);
});

When("再固定をCLIから適用する", async function () {
  this.providerCalls = 0;
  const status = await main([
    "pr",
    "reanchor",
    `--staging=${this.staging}`,
    `--root=${this.root}`,
    `--new-head=${this.newHeadSha}`,
    `--new-base=${this.newBaseSha}`,
    "--reason=既定branchが動いたためrebaseした",
    "--apply",
  ]);
  this.applied = status === 0;
});

/**
 * `pr merge`が再観測するPRを、固定済みdelivery identityと同じ内容で組み立てる。
 *
 * **headだけを引数で変える。** 他の項目を一致させておかないと、head照合を
 * 通過したのか別の理由で落ちたのかを区別できない（Issue #1101）。
 */
function observedPullRequest(headRefOid: string): Record<string, unknown> {
  return {
    number: 1093,
    url: "https://github.com/example/repository/pull/1093",
    title: "証跡再固定",
    body: "Closes #1093",
    headRefName: "bugfix/1093-evidence-reanchor",
    baseRefName: "main",
    headRefOid,
    headRepository: { nameWithOwner: "example/repository" },
    isCrossRepository: false,
    closingIssuesReferences: [
      {
        number: 1093,
        url: "https://github.com/example/repository/issues/1093",
      },
    ],
  };
}

function observeBoundPullRequest(
  world: ReanchorWorld,
  headRefOid: string,
): void {
  const state = readStoredDeliveryState(world.staging);
  assert.ok(state, "delivery stateがありません");
  try {
    assertBoundPullRequestObservation({
      staging: world.staging,
      state,
      observed: observedPullRequest(headRefOid) as never,
      tracker: "https://github.com/example/repository/issues/1093",
    });
    world.bindingPassed = true;
  } catch (error) {
    world.bindingPassed = false;
    world.error = error;
  }
}

When("delivery層の再固定のあとにpr mergeのbinding検査を通す", function () {
  applyReanchor(this, "delivery");
  assert.equal(
    this.applied,
    true,
    `再固定が失敗しました: ${String(this.error)}`,
  );
  observeBoundPullRequest(this, this.newHeadSha);
});

When("再固定せずに新headでpr mergeのbinding検査を通す", function () {
  observeBoundPullRequest(this, this.newHeadSha);
});

When("連鎖しない記録を積んで新headでpr mergeのbinding検査を通す", function () {
  /**
   * **先頭の`oldHeadSha`が固定済みheadと一致しない記録を直接置く。**
   * `pr reanchor`は等価性を要求するため、連鎖破綻はCLI経由では作れない。
   */
  fs.mkdirSync(path.join(this.staging, "journal"), { recursive: true });
  fs.writeFileSync(
    path.join(this.staging, EVIDENCE_REANCHOR_FILE),
    `${JSON.stringify({
      oldHeadSha: "a".repeat(40),
      newHeadSha: this.newHeadSha,
      oldBaseSha: this.baseSha,
      newBaseSha: this.newBaseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "連鎖しない記録",
      recordedAt: INSTANT.toISOString(),
    })}\n`,
  );
  observeBoundPullRequest(this, this.newHeadSha);
});

Then("pr mergeのbinding検査は通過する", function () {
  assert.equal(
    this.bindingPassed,
    true,
    `binding検査が停止しました: ${String(this.error)}`,
  );
});

Then("pr mergeのbinding検査は固定済みheadとの不一致で停止する", function () {
  assert.equal(this.bindingPassed, false, "binding検査が通過しました");
  assert.match(
    String((this.error as Error)?.message ?? ""),
    /PR再観測が固定済みrepository・PR・base ref・headと一致しません/u,
  );
});

When("到達性を観測する", function () {
  this.providerCalls = 0;
  const chain = readEvidenceReanchorChain(this.staging);
  const derived = deriveEffectiveHead({
    records: chain,
    anchoredHeadSha: this.oldHeadSha,
  });
  /**
   * **provider境界をfakeへ差し替えて実呼び出し数を数える。**
   * `observeReachability`はproviderの観測結果を引数で受け取る純関数であり、
   * 自分では呼ばない。数えるのは呼び出し側の責務である。
   */
  const providerHeadSha = ((): string => {
    this.providerCalls += 1;
    return this.newHeadSha;
  })();
  this.reachability = observeReachability({
    effectiveHeadSha: derived.effectiveHeadSha,
    providerHeadSha,
    isAncestor: (descendant: string) => {
      try {
        execFileSync(
          "git",
          ["merge-base", "--is-ancestor", derived.effectiveHeadSha, descendant],
          { cwd: this.root, stdio: "ignore" },
        );
        return true;
      } catch {
        return false;
      }
    },
  }).state;
});

When("review層の再固定のあとにpr createのbinding検査を通す", function () {
  applyReanchor(this, "review");
  assert.equal(
    this.applied,
    true,
    `再固定が失敗しました: ${String(this.error)}`,
  );
  /**
   * **製品の`assertCurrentReviewJournalBinding`を実際に呼ぶ。**
   * 再固定しただけで「通過した」と見なすと、`src/cli.ts:429`の照合を
   * 差し替え忘れた回帰を検出できない。
   */
  recordStep10Binding(this);
  try {
    assertCurrentReviewJournalBinding(this.staging, this.newHeadSha);
    this.bindingPassed = true;
  } catch (error) {
    this.bindingPassed = false;
    this.error = error;
  }
});

Then("provider呼び出しは0件になる", function () {
  assert.equal(this.applied, true);
  assert.equal(this.providerCalls, 0);
});

Then("到達性の三値が報告される", function () {
  assert.ok(
    ["reachable", "rewritten", "unverifiable"].includes(this.reachability),
    `三値でない: ${this.reachability}`,
  );
});

Then("provider観測は1回になる", function () {
  assert.equal(this.providerCalls, 1);
});

Then("binding検査は停止しない", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.effectiveHead, this.newHeadSha);
  assert.equal(
    this.bindingPassed,
    true,
    `binding検査が停止しました: ${String(this.error)}`,
  );
});
