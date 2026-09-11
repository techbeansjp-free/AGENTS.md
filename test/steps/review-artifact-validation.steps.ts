import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import {
  validateReviewArtifactStructure,
  type ReviewArtifactStructure,
} from "../../src/domain/review-artifact.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ReviewArtifactValidationWorld extends WorkflowWorld {
  markdown: string;
  structure: ReviewArtifactStructure;
  cliRoot: string;
  jsonResult: Record<string, unknown>;
  artifactResult: Record<string, unknown>;
  invalidArtifactResult: Record<string, unknown>;
  unsafeErrors: Error[];
}

const { Given, When, Then } = stepDefinitions<ReviewArtifactValidationWorld>();

const base = "1".repeat(40);
const implementation = "2".repeat(40);

function validArtifact(): string {
  return [
    "# Review",
    "## 0. レビュー識別情報",
    `| 比較基点 | \`${base}\` |`,
    `| H_impl | \`${implementation}\` |`,
    "| ラウンド数 | 2（修正確認を含む） |",
    "| Step chain | 経由: .agent-skill-chain/tmp/issues/1332 |",
    "## 1. 入力証拠",
    "### 1.1 変更ファイル個別監査",
    "| path | status | a | b | c | d | e | f | decision |",
    "|---|---|---|---|---|---|---|---|---|",
    "| `src/cli.ts` | M | ok | ok | ok | ok | ok | ok | pass |",
    "## 2. 受け入れ条件の確認",
    "## 3. 肯定的評価",
    "## 4. 敵対的評価",
    "## 5. 指摘",
    "## 6. ラウンド固有の確認",
    "## 7. テスト結果",
    "## 8. 配布物影響",
    "判断: 配布物を更新した",
    "根拠: CLI sourceとdistを更新したため。",
    "## 9. 独立reviewの成立",
    "## 10. 仕様整合性",
    "## 11. 総合判定と再開地点",
    "",
  ].join("\n");
}

async function captureCli(
  args: string[],
): Promise<{ output?: Record<string, unknown>; error?: Error }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await main(args);
    return { output: JSON.parse(stdout) as Record<string, unknown> };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("構造が正しいMarkdown review artifactがある", function () {
  this.markdown = validArtifact();
});

Given("不正形式と重複したidentity行を持つreview artifactがある", function () {
  this.markdown = validArtifact()
    .replace(`| 比較基点 | \`${base}\` |`, "| 比較基点 | `1234` |")
    .replace(
      `| H_impl | \`${implementation}\` |`,
      `| H_impl | \`${implementation}\` |\n| H_impl | \`${implementation}\` |`,
    );
});

Given("section不足と曖昧な配布物影響を持つreview artifactがある", function () {
  this.markdown = validArtifact()
    .replace("## 3. 肯定的評価\n", "")
    .replace(
      "判断: 配布物を更新した\n根拠: CLI sourceとdistを更新したため。",
      "判断: 配布物を更新した\n判断: 配布物を更新しない",
    );
});

When("Markdown review artifactの構造を検証する", function () {
  this.structure = validateReviewArtifactStructure(this.markdown);
});

Then("診断なしでartifact構造をvalidと判定する", function () {
  assert.equal(this.structure.diagnostics.length, 0);
  assert.equal(this.structure.base, base);
  assert.equal(this.structure.implementation, implementation);
  assert.equal(this.structure.rounds, 2);
  assert.equal(this.structure.auditEntries.length, 1);
});

Then("すべてのidentity診断に行番号と期待形式がある", function () {
  const identity = this.structure.diagnostics.filter((item) =>
    item.code.startsWith("identity-"),
  );
  assert.deepEqual(
    identity.map((item) => item.code),
    ["identity-base", "identity-implementation"],
  );
  assert.ok(identity.every((item) => item.line > 0 && item.expected !== ""));
});

Then("sectionと配布物影響の診断をまとめて返す", function () {
  const codes = this.structure.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("heading"));
  assert.ok(codes.includes("distribution-decision"));
  assert.ok(codes.includes("distribution-reason"));
  assert.ok(this.structure.diagnostics.every((item) => item.line > 0));
});

Given(
  "JSON review evidenceと正しいMarkdown artifactを持つrepositoryがある",
  function () {
    this.cliRoot = this.temp("asc-review-artifact-validation-");
    fs.writeFileSync(path.join(this.cliRoot, "review.json"), '{"round":1}\n');
    fs.writeFileSync(path.join(this.cliRoot, "artifact.md"), validArtifact());
    fs.writeFileSync(
      path.join(this.cliRoot, "invalid-artifact.md"),
      validArtifact().replace("## 3. 肯定的評価\n", ""),
    );
    fs.symlinkSync(
      path.join(this.cliRoot, "artifact.md"),
      path.join(this.cliRoot, "artifact-link.md"),
    );
  },
);

When(
  "JSONと安全でないMarkdown pathにreview validateを実行する",
  async function () {
    const json = await captureCli([
      "review",
      "validate",
      path.join(this.cliRoot, "review.json"),
    ]);
    assert.equal(json.error, undefined);
    this.jsonResult = json.output!;
    const artifact = await captureCli([
      "review",
      "validate",
      "--artifact=artifact.md",
      `--root=${this.cliRoot}`,
    ]);
    assert.equal(artifact.error, undefined);
    this.artifactResult = artifact.output!;
    const invalidArtifact = await captureCli([
      "review",
      "validate",
      "--artifact=invalid-artifact.md",
      `--root=${this.cliRoot}`,
    ]);
    assert.equal(invalidArtifact.error, undefined);
    this.invalidArtifactResult = invalidArtifact.output!;
    const escape = await captureCli([
      "review",
      "validate",
      "--artifact=../outside.md",
      `--root=${this.cliRoot}`,
    ]);
    const symlink = await captureCli([
      "review",
      "validate",
      "--artifact=artifact-link.md",
      `--root=${this.cliRoot}`,
    ]);
    this.unsafeErrors = [escape.error!, symlink.error!];
  },
);

Then("JSONは従来結果を返し安全でないartifact pathを拒否する", function () {
  assert.equal(this.jsonResult.approved, false);
  assert.ok(Array.isArray(this.jsonResult.errors));
  assert.equal(this.jsonResult.kind, undefined);
  assert.equal(this.artifactResult.valid, true);
  assert.equal(this.artifactResult.kind, "review-artifact");
  assert.equal(this.invalidArtifactResult.valid, false);
  const diagnostics = this.invalidArtifactResult.errors as Array<
    Record<string, unknown>
  >;
  assert.ok(diagnostics.length > 0);
  assert.ok(
    diagnostics.every(
      (item) =>
        typeof item.line === "number" && typeof item.expected === "string",
    ),
  );
  assert.ok(this.unsafeErrors.every((error) => error instanceof Error));
  assert.match(this.unsafeErrors[0]!.message, /パストラバーサル/u);
  assert.match(this.unsafeErrors[1]!.message, /通常file/u);
});
