import assert from "node:assert/strict";

import {
  parseVerificationRuns,
  renderVerificationRun,
  renderVerificationRuns,
  sealVerificationRun,
  selectObservedVerification,
  verificationRecordErrors,
  verificationRunDigest,
  VERIFICATION_RUN_SCHEMA_VERSION,
  type VerificationRunBody,
  type VerificationRunRecord,
  type VerificationTarget,
} from "../../src/domain/verification-run.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface VerificationRunWorld extends WorkflowWorld {
  record: VerificationRunRecord;
  errors: string[];
  selected: string[];
}

const { Given, When, Then } = stepDefinitions<VerificationRunWorld>();

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const IMPACT = "a".repeat(64);
const FEATURE = "test/features/unit/sample.feature";

function body(change: Partial<VerificationRunBody> = {}): VerificationRunBody {
  return {
    schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
    baseSha: BASE,
    headSha: HEAD,
    command: ["npm", "test"],
    scope: "full",
    impactDigest: IMPACT,
    impactMode: "full",
    exitCode: 0,
    signal: null,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: "2026-09-26T00:00:01.000Z",
    stdoutDigest: "b".repeat(64),
    stderrDigest: "c".repeat(64),
    ...change,
  };
}

function rejectionOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

/** 値を検査せずdigestだけを付けた1行。parserの拒否を測る。 */
function unvalidatedLine(value: Record<string, unknown>): string {
  return `${JSON.stringify({
    ...value,
    recordDigest: verificationRunDigest(
      value as unknown as VerificationRunBody,
    ),
  })}\n`;
}

Given("合格した検証記録がある", function () {
  this.record = sealVerificationRun(body());
});

When("検証記録を1箇所ずつ壊して読む", function () {
  const canonical = `${renderVerificationRun(this.record)}\n`;
  const plain = JSON.parse(canonical) as Record<string, unknown>;
  const { recordDigest: _ignored, ...raw } = plain;
  void _ignored;
  this.errors = [
    rejectionOf(() =>
      parseVerificationRuns(canonical.replace("b".repeat(64), "e".repeat(64))),
    ),
    rejectionOf(() =>
      parseVerificationRuns(canonical.replace('"exitCode":0', '"exitCode":1')),
    ),
    rejectionOf(() =>
      parseVerificationRuns(
        `${JSON.stringify({ recordDigest: plain.recordDigest, ...raw })}\n`,
      ),
    ),
    rejectionOf(() => parseVerificationRuns(unvalidatedLine({ ...raw, x: 1 }))),
    rejectionOf(() =>
      parseVerificationRuns(unvalidatedLine({ ...raw, signal: "SIGKILL" })),
    ),
    rejectionOf(() =>
      parseVerificationRuns(unvalidatedLine({ ...raw, scope: "targeted" })),
    ),
    rejectionOf(() =>
      parseVerificationRuns(unvalidatedLine({ ...raw, command: [] })),
    ),
    rejectionOf(() =>
      parseVerificationRuns(unvalidatedLine({ ...raw, command: ["a\nb"] })),
    ),
    rejectionOf(() =>
      parseVerificationRuns(
        unvalidatedLine({ ...raw, command: ["npm", "test", "token=abc123"] }),
      ),
    ),
    rejectionOf(() => parseVerificationRuns(canonical.trimEnd())),
    rejectionOf(() => parseVerificationRuns(`${canonical}${canonical}`)),
    /** 対照。正規の記録は読み戻せる */
    rejectionOf(() =>
      assert.deepEqual(parseVerificationRuns(canonical), [this.record]),
    ),
  ];
});

Then(
  "改竄・再整形・未知field・終了値とsignalの不整合・fullへのtargeted・不正なargvをそれぞれ拒否する",
  function () {
    const expected = [
      /stdoutDigest|recordDigestが内容と一致しません/u,
      /recordDigestが内容と一致しません/u,
      /正規直列化と一致しません/u,
      /未知field.*x/u,
      /exitCodeとsignalのどちらか一方だけ/u,
      /scope=targetedは影響集合がfull/u,
      /command.*argv/u,
      /command\[0\].*制御文字/u,
      /command\[2\]に秘密情報らしき値/u,
      /改行で終わる/u,
      /recordDigestが重複/u,
    ];
    assert.equal(this.errors.length, expected.length + 1);
    for (const [index, pattern] of expected.entries())
      assert.match(this.errors[index]!, pattern, `mutation ${index}`);
    assert.equal(this.errors[expected.length], "", "対照は受理する");
  },
);

When("記録の組み合わせごとに検証欄を導出する", function () {
  const target: VerificationTarget = {
    headSha: HEAD,
    impactDigest: IMPACT,
    impactMode: "full",
    impactFeatures: [],
  };
  const failed = sealVerificationRun(
    body({ exitCode: 1, finishedAt: "2026-09-26T00:00:02.000Z" }),
  );
  const passedAgain = sealVerificationRun(
    body({ finishedAt: "2026-09-26T00:00:03.000Z" }),
  );
  const targetedOnly = sealVerificationRun(
    body({
      scope: "targeted",
      impactMode: "targeted",
      command: ["cucumber", FEATURE],
    }),
  );
  const targetedPartial = sealVerificationRun(
    body({
      scope: "targeted",
      impactMode: "targeted",
      command: ["cucumber", "other.feature"],
    }),
  );
  const lint = sealVerificationRun(body({ command: ["npm", "run", "lint"] }));
  const select = (
    records: readonly VerificationRunRecord[],
    change: Partial<typeof target> = {},
  ) => selectObservedVerification(records, { ...target, ...change });
  this.errors = [
    rejectionOf(() => select([])),
    rejectionOf(() => select([this.record], { impactDigest: "d".repeat(64) })),
    rejectionOf(() => select([this.record, failed])),
    rejectionOf(() => select([targetedOnly])),
    rejectionOf(() =>
      select([targetedPartial], {
        impactMode: "targeted",
        impactFeatures: [FEATURE],
      }),
    ),
  ];
  this.selected = [
    JSON.stringify(
      select([this.record, failed, passedAgain, lint]).map((item) => [
        item.command,
        item.recordDigest,
      ]),
    ),
    JSON.stringify(
      select([targetedOnly], {
        impactMode: "targeted",
        impactFeatures: [FEATURE],
      }).map((item) => item.scope),
    ),
    JSON.stringify([
      [passedAgain.command, passedAgain.recordDigest],
      [lint.command, lint.recordDigest],
    ]),
  ];
});

Then(
  "記録なし・影響集合不一致・最新の不合格・scope=full欠落・targetedのfeature欠落を拒否し合格記録だけを導く",
  function () {
    const expected = [
      /検証記録がありません.*verify run/u,
      /現在の影響集合.*一致しません/u,
      /最新の実行が不合格/u,
      /scope=fullの合格した検証記録が必要/u,
      /featureを含みません: test\/features\/unit\/sample\.feature/u,
    ];
    assert.equal(this.errors.length, expected.length);
    for (const [index, pattern] of expected.entries())
      assert.match(this.errors[index]!, pattern, `case ${index}`);
    assert.equal(
      this.selected[0],
      this.selected[2],
      "同じargvは最新の合格記録だけを導く",
    );
    assert.equal(this.selected[1], JSON.stringify(["targeted"]));
  },
);

When("検証欄を記録の欠落・不一致・後続の不合格と照合する", function () {
  const [entry] = selectObservedVerification([this.record], {
    headSha: HEAD,
    impactDigest: IMPACT,
    impactMode: "full",
    impactFeatures: [],
  });
  const laterFailure = sealVerificationRun(
    body({ exitCode: 2, finishedAt: "2026-09-26T00:00:05.000Z" }),
  );
  const records = parseVerificationRuns(renderVerificationRuns([this.record]));
  this.errors = [
    verificationRecordErrors([entry!], []).join("; "),
    verificationRecordErrors(
      [{ ...entry!, finishedAt: "2026-09-26T00:00:09.000Z" }],
      records,
    ).join("; "),
    verificationRecordErrors([entry!], [this.record, laterFailure]).join("; "),
    verificationRecordErrors([entry!], records).join("; "),
  ];
});

Then("記録と一致する検証欄だけを受理する", function () {
  assert.match(this.errors[0]!, /観測記録にありません/u);
  assert.match(this.errors[1]!, /観測記録と一致しません/u);
  assert.match(this.errors[2]!, /後続実行が不合格/u);
  assert.equal(this.errors[3], "");
});
