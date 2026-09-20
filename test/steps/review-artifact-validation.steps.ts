import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import {
  validateContextIsolatedApprovalRecord,
  validateReviewArtifactStructure,
  type ContextIsolatedApprovalRecord,
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
  artifactExitCode: number;
  invalidArtifactExitCode: number;
  unsafeErrors: Error[];
  approvalMarkdowns: string[];
  approvalRecords: ContextIsolatedApprovalRecord[];
  defaultTerminalResult?: Awaited<ReturnType<typeof captureCli>>;
  strictTerminalResult?: Awaited<ReturnType<typeof captureCli>>;
  validTerminalResult?: Awaited<ReturnType<typeof captureCli>>;
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
    "| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |",
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
  dependencies: Parameters<typeof main>[1] = {},
): Promise<{
  output?: Record<string, unknown>;
  error?: Error;
  exitCode?: number;
}> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    const exitCode = await main(args, dependencies);
    return {
      output: JSON.parse(stdout) as Record<string, unknown>,
      exitCode,
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("構造が正しいMarkdown review artifactがある", function () {
  this.markdown = validArtifact();
});

Given("構造は正しいがapproval記録が不正なterminal artifactがある", function () {
  this.cliRoot = this.temp("asc-review-terminal-");
  const invalid = validArtifact()
    .replace(
      "## 9. 独立reviewの成立\n",
      "```md\n| reviewerが対象差分を変更していないこと | はい |\n- 未解決Critical/High: なし\n```\n## 9. 独立reviewの成立\n",
    )
    .replace(
      "## 9. 独立reviewの成立\n",
      "## 9. 独立reviewの成立\n| 項目 | 内容 |\n|---|---|\n| 適用した独立性モード | context-isolated |\n| その要求を満たすこと | はい |\n| reviewerとimplementerのidentity・context比較 | 別session |\n| reviewerが対象差分を変更していないこと | はい。製品path変更0件 |\n",
    )
    .replace(
      "## 11. 総合判定と再開地点\n",
      "## 11. 総合判定と再開地点\n- 未解決Critical/High: 0件。High 2件は解決済み\n- 判定: approved\n",
    );
  fs.writeFileSync(path.join(this.cliRoot, "terminal.md"), invalid);
  fs.writeFileSync(
    path.join(this.cliRoot, "terminal-valid.md"),
    invalid
      .replace("はい。製品path変更0件", "はい（製品path変更0件）")
      .replace(
        "- 未解決Critical/High: 0件。High 2件は解決済み",
        "- 未解決Critical/High: なし",
      ),
  );
});

When("既定とterminalのreview validateを実行する", async function () {
  const args = [
    "review",
    "validate",
    "--artifact=terminal.md",
    `--root=${this.cliRoot}`,
  ];
  this.defaultTerminalResult = await captureCli(args);
  this.strictTerminalResult = await captureCli([...args, "--terminal"]);
  this.validTerminalResult = await captureCli([
    "review",
    "validate",
    "--artifact=terminal-valid.md",
    `--root=${this.cliRoot}`,
    "--terminal",
  ]);
});

Then("既定は構造validでterminalはapproval不備を報告する", function () {
  assert.equal(this.defaultTerminalResult?.exitCode, 0);
  assert.equal(this.defaultTerminalResult?.output?.valid, true);
  assert.equal(this.strictTerminalResult?.exitCode, 1);
  assert.equal(this.strictTerminalResult?.output?.valid, false);
  assert.deepEqual(this.strictTerminalResult?.output?.approvalErrors, [
    "reviewerが対象差分を変更していない記録が必要です",
    "未解決Critical/Highがない記録が必要です",
  ]);
  const diagnostics = this.strictTerminalResult?.output?.errors as Array<{
    code: string;
    line: number;
    expected: string;
    message: string;
  }>;
  assert.equal(diagnostics.length, 2);
  assert.ok(
    diagnostics.every(
      (item) =>
        item.code === "terminal-approval" &&
        item.line > 0 &&
        item.expected !== "" &&
        item.message !== "",
    ),
  );
  const artifactLines: string[] = fs
    .readFileSync(path.join(this.cliRoot, "terminal.md"), "utf8")
    .split("\n");
  assert.equal(
    diagnostics.find((item) => item.message.includes("reviewerが対象差分"))
      ?.line,
    artifactLines.reduce(
      (last, line, index) =>
        line.startsWith("| reviewerが対象差分を変更していないこと |")
          ? index
          : last,
      -1,
    ) + 1,
  );
  assert.equal(
    diagnostics.find((item) => item.message.includes("未解決Critical/High"))
      ?.line,
    artifactLines.reduce(
      (last, line, index) =>
        line.startsWith("- 未解決Critical/High:") ? index : last,
      -1,
    ) + 1,
  );
  assert.equal(this.validTerminalResult?.exitCode, 0);
  assert.equal(this.validTerminalResult?.output?.valid, true);
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
    )
    .replace(
      "| `src/cli.ts` | M | ok | ok | ok | ok | ok | ok | pass |",
      "| `src/cli.ts` | M | ok | ok | ok | ok | ok | ok | pass |\n| `src/cli.ts` | M | ok | ok | ok | ok | ok | ok | pass |\n| `broken` | X | short |",
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
  assert.ok(codes.includes("audit-row"));
  assert.ok(codes.includes("audit-duplicate"));
  assert.ok(this.structure.diagnostics.every((item) => item.line > 0));
});

Given("context-isolated formal approvalの正常例と反例がある", function () {
  const approved = validArtifact()
    .replace(
      "## 9. 独立reviewの成立\n",
      "## 9. 独立reviewの成立\n| 項目 | 内容 |\n|---|---|\n| 適用した独立性モード | context-isolated |\n| その要求を満たすこと | はい |\n| reviewerとimplementerのidentity・context比較 | reviewer-sessionとimplementer-sessionは別 |\n| reviewerが対象差分を変更していないこと | はい（変更pathなし） |\n",
    )
    .replace(
      "## 11. 総合判定と再開地点\n",
      "## 11. 総合判定と再開地点\n- 未解決Critical/High: なし\n- 判定: approved\n",
    );
  this.approvalMarkdowns = [
    approved,
    approved.replace("- 判定: approved", "- 判定: rejected"),
    approved.replace(
      "はい（変更pathなし）",
      "いいえ（reviewerがsrc/cli.tsを変更）",
    ),
    approved.replace(
      "reviewer-sessionとimplementer-sessionは別",
      "{実体の観測値}",
    ),
  ];
});

When("context-isolated formal approvalを検証する", function () {
  this.approvalRecords = this.approvalMarkdowns.map((markdown) =>
    validateContextIsolatedApprovalRecord(markdown),
  );
});

Then("正常例だけをformal approvalと判定する", function () {
  assert.deepEqual(
    this.approvalRecords.map((record) => record.valid),
    [true, false, false, false],
  );
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
    this.artifactExitCode = artifact.exitCode!;
    const invalidArtifact = await captureCli([
      "review",
      "validate",
      "--artifact=invalid-artifact.md",
      `--root=${this.cliRoot}`,
    ]);
    assert.equal(invalidArtifact.error, undefined);
    this.invalidArtifactResult = invalidArtifact.output!;
    this.invalidArtifactExitCode = invalidArtifact.exitCode!;
    const conflictingJson = await captureCli([
      "review",
      "validate",
      "--file=review.json",
      path.join(this.cliRoot, "review.json"),
    ]);
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
    const race = await captureCli(
      [
        "review",
        "validate",
        "--artifact=artifact.md",
        `--root=${this.cliRoot}`,
      ],
      {
        afterReviewArtifactStat: (file) => {
          fs.unlinkSync(file);
          fs.symlinkSync("/etc/passwd", file);
        },
      },
    );
    this.unsafeErrors = [
      escape.error!,
      symlink.error!,
      conflictingJson.error!,
      race.error!,
    ];
  },
);

Then("JSONは従来結果を返し安全でないartifact pathを拒否する", function () {
  assert.equal(this.jsonResult.approved, false);
  assert.ok(Array.isArray(this.jsonResult.errors));
  assert.equal(this.jsonResult.kind, undefined);
  assert.equal(this.artifactResult.valid, true);
  assert.equal(this.artifactResult.kind, "review-artifact");
  assert.equal(this.artifactExitCode, 0);
  assert.equal(this.invalidArtifactResult.valid, false);
  assert.equal(this.invalidArtifactExitCode, 1);
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
  assert.match(this.unsafeErrors[2]!.message, /同時に使用できません/u);
  assert.match(this.unsafeErrors[3]!.message, /ELOOP|変化しました/u);
});
