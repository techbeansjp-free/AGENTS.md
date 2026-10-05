import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  releaseAuditException,
  recordReleaseAuditException,
} from "../../scripts/release_audit_exception.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class AuditExceptionWorld extends WorkflowWorld {
  exceptionEnvironment: NodeJS.ProcessEnv = {};
  exception: ReturnType<typeof releaseAuditException>;
}
const { Given, When, Then } = stepDefinitions<AuditExceptionWorld>();
Given("対象SHAと理由を指定した手動release環境がある", function () {
  this.exceptionEnvironment = environment();
});
When("手動releaseの工程監査例外を評価する", function () {
  this.exception = releaseAuditException(this.exceptionEnvironment, head);
});

const head = "a".repeat(40);
function environment(): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: head,
    GITHUB_ACTOR: "release-owner",
    GITHUB_RUN_ID: "123",
    GITHUB_STEP_SUMMARY: "summary.md",
    RELEASE_AUDIT_EXCEPTION_SHA: head,
    RELEASE_AUDIT_EXCEPTION_REASON: "承認済み緊急修正の工程省略",
  };
}

Then(
  "工程監査例外は手動実行の完全一致SHAと理由がある場合だけ成立する",
  function () {
    assert.equal(releaseAuditException({}, head), undefined);
    const allowed = this.exception;
    assert.equal(allowed?.sha, head);
    assert.equal(allowed?.actor, "release-owner");
    assert.equal(allowed?.run, "123");
    for (const [key, value] of Object.entries(environment())) {
      assert.throws(
        () => releaseAuditException({ ...environment(), [key]: "" }, head),
        key,
      );
      assert.ok(value);
    }
    for (const patch of [
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_SHA: "b".repeat(40) },
      { RELEASE_AUDIT_EXCEPTION_SHA: "a".repeat(7) },
      { RELEASE_AUDIT_EXCEPTION_REASON: "  " },
    ])
      assert.throws(() =>
        releaseAuditException({ ...environment(), ...patch }, head),
      );
    assert.throws(() => releaseAuditException(environment(), "b".repeat(40)));
  },
);

Then(
  "工程監査例外は元の不合格結果と実行者を保存し記録失敗を拒否する",
  function () {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "asc-audit-exception-"),
    );
    const previous = process.cwd();
    try {
      process.chdir(directory);
      const exception = releaseAuditException(environment(), head)!;
      const audit = { valid: false, errors: ["工程証跡なし"] };
      recordReleaseAuditException(exception, audit, "summary.md");
      const record = JSON.parse(
        fs.readFileSync("release-audit-exception.json", "utf8"),
      ) as Record<string, unknown>;
      assert.deepEqual(record.audit, audit);
      assert.equal(record.state, "audit-exception");
      assert.equal(record.actor, "release-owner");
      assert.equal(record.sha, head);
      assert.match(fs.readFileSync("summary.md", "utf8"), /工程証跡なし/u);
      assert.throws(() =>
        recordReleaseAuditException(exception, audit, "summary.md"),
      );
    } finally {
      process.chdir(previous);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

Then("releaseの品質gateは維持され工程監査だけに例外入力が渡る", function () {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
  const scripts = (
    JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  assert.match(
    workflow,
    /RELEASE_AUDIT_EXCEPTION_SHA: \$\{\{ inputs.audit_exception_sha \}\}/u,
  );
  assert.match(
    workflow,
    /RELEASE_AUDIT_EXCEPTION_REASON: \$\{\{ inputs.audit_exception_reason \}\}/u,
  );
  assert.match(workflow, /run: npm run verify:distribution/u);
  assert.match(
    workflow,
    /path: release-audit-exception.json\n\s+if-no-files-found: error/u,
  );
  assert.equal(
    scripts["verify:distribution"],
    "npm run project:quality && npm run quality && npm run build && npm run docs:format && npm run test:format && npm run trace:check && npm run architecture:check && npm run conformance:check && npm run audit:check && npm run package:check",
  );
  const entry = fs.readFileSync("scripts/check_file_audit.ts", "utf8");
  assert.match(entry, /else if \(!result.valid\) process.exitCode = 1/u);
});
