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
    fs.rmSync(directory, { recursive: true, force: true });
});
