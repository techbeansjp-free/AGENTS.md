import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  After as cucumberAfter,
  Before as cucumberBefore,
  Given as cucumberGiven,
  Then as cucumberThen,
  When as cucumberWhen,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from "@cucumber/cucumber";
import { pullRequestRequiredHeadings } from "../../src/domain/issue.js";

type WorkflowParameters = Readonly<Record<string, unknown>>;

export class WorkflowWorld extends World<WorkflowParameters> {
  value: unknown = undefined;
  error: unknown = undefined;
  calls: string[] = [];
  validationOutcome: { valid: boolean } | undefined = undefined;
  temporaryDirectories: string[] = [];

  constructor(options: IWorldOptions<WorkflowParameters>) {
    super(options);
  }

  temp(prefix = "asc-v03-") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    this.temporaryDirectories.push(directory);
    return directory;
  }

  initRepo() {
    const directory = this.temp();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: directory });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], {
      cwd: directory,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: directory });
    fs.writeFileSync(path.join(directory, "README.md"), "# fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: directory });
    execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: directory });
    return directory;
  }
}

export function stepDefinitions<WorldType extends WorkflowWorld>() {
  return {
    Given: cucumberGiven<WorldType>,
    When: cucumberWhen<WorldType>,
    Then: cucumberThen<WorldType>,
  };
}

setWorldConstructor(WorkflowWorld);
cucumberBefore<WorkflowWorld>(function () {
  this.value = undefined;
  this.error = undefined;
  this.calls = [];
  this.validationOutcome = undefined;
});
cucumberAfter<WorkflowWorld>(function () {
  for (const directory of this.temporaryDirectories.reverse())
    // 大きなfixture treeの削除中に別processがまだ書いている場合、
    // 単発のrmSyncはENOTEMPTYで落ちる。再試行して後片付けを決定的にする。
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
});

/**
 * 配布templateの構造を満たすPR本文を組み立てる。
 *
 * **必須見出しを書き写さず`pullRequestRequiredHeadings`から導出する。** 書き写すと
 * templateと独立に古くなり、Issue #951が指摘した複製の型をtest側で再生産する。
 */
export function conformingPullRequestBody(input: {
  title: string;
  canonicalIssue: number;
  relatedIssues?: readonly number[];
}): string {
  const references = [
    `Closes #${input.canonicalIssue}`,
    ...(input.relatedIssues ?? []).map((issue) => `Relates to #${issue}`),
  ].join("\n\n");
  return [
    `# ${input.title}`,
    "",
    ...pullRequestRequiredHeadings().flatMap((heading) => [
      `## ${heading}`,
      "",
      heading === "概要" ? references : "確認済み。",
      "",
    ]),
  ].join("\n");
}
