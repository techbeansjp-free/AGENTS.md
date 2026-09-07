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

  /**
   * **省略時はSHA-1へ固定する。** `--object-format`を省略した`git init`はgitの既定に従い、
   * その既定は`GIT_DEFAULT_HASH`と`init.defaultObjectFormat`で変えられる。実測でも
   * `GIT_DEFAULT_HASH=sha256`のとき省略した`git init`は64桁のOIDを作った。**したがって
   * 「省略＝SHA-1」は成り立たない。** 固定しないと、開発者の環境設定やgitの将来の既定変更で
   * 既存fixtureのobject formatが無言で変わる（Issue #1255のラウンド1で独立reviewerが指摘）。
   *
   * **fixture生成経路を複製しない。** SHA-1側とSHA-256側で手順が分かれると両側が同じ向きに
   * ずれても検出できなくなるため、object formatだけを変数にする。
   */
  initRepo(objectFormat?: "sha1" | "sha256") {
    const directory = this.temp();
    execFileSync(
      "git",
      ["init", "-q", "-b", "main", `--object-format=${objectFormat ?? "sha1"}`],
      { cwd: directory },
    );
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
