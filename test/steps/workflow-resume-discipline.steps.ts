import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ResumeDisciplineWorld extends WorkflowWorld {
  documents: Record<string, string> = {};
  checked = false;
}

const { Given, When, Then } = stepDefinitions<ResumeDisciplineWorld>();

const DOCUMENTS = {
  workflow: ".agent-skill-chain/docs/01_開発ワークフロー.md",
  adapter: ".agent-skill-chain/skills/asc-step/SKILL.md",
  agents: "AGENTS.md",
  step1: ".agent-skill-chain/skills/step-01-request/SKILL.md",
  step2: ".agent-skill-chain/skills/step-02-requirements/SKILL.md",
  step3: ".agent-skill-chain/skills/step-03-requirements-review/SKILL.md",
} as const;

/** 見出し行から次の同levelの見出しの直前までを返す。 */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `${heading}がありません`);
  const end = lines.findIndex(
    (line, index) => index > start && /^## /u.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function assertOrdered(text: string, markers: readonly string[]): void {
  let cursor = -1;
  for (const marker of markers) {
    const found = text.indexOf(marker, cursor + 1);
    assert.ok(found > cursor, `${marker}が順序どおりにありません`);
    cursor = found;
  }
}

Given("配布する正本・asc-step adapter・Step 1\\/2 skillがある", function () {
  this.documents = Object.fromEntries(
    Object.entries(DOCUMENTS).map(([key, file]) => [
      key,
      fs.readFileSync(path.resolve(file), "utf8"),
    ]),
  );
});

When("本文を検査する", function () {
  const { workflow, adapter, agents, step1, step2, step3 } = this.documents;
  const rule = section(workflow!, "## 読取と書込の量");
  assert.equal(rule.includes("1 Issueを1 sessionで扱い"), false);
  for (const marker of [
    "進行の正本はstagingの機械記録・Git・trackerであり、会話ではない。",
    "会話はいつ捨ててもよい。",
    "会話要約や手書きの引継ぎ文書を進行の正本にしない。",
    "finalize後にcontextを破棄する。",
    "fullではStep 8の記録後を実行context境界とする。",
    "Step 9の実装とStep 10のreviewは、会話を持たない新しいcontext（subagent等）へIssue番号・worktree・stagingのpointerだけで渡す。",
    "進行役は成果物本文を自分のcontextへ入れず",
    "review前の比較基点は封印済み`03_実装計画.md`の基点欄から取る。",
    "`resume`はadvisoryであり、各gateはHEADと記録を独自に照合する。",
  ])
    assert.ok(rule.includes(marker), `読取規律に「${marker}」がありません`);
  const order = rule.split("\n").find((line) => line.includes("再開は次の順"));
  assert.ok(order, "再開の読取順がありません");
  assertOrdered(order, [
    "Issue",
    "worktree",
    "staging",
    "`resume`",
    "Step skill",
    "`impact`の影響集合",
    "計画の必要節",
  ]);
  const widen = rule.split("\n").find((line) => line.includes("範囲を広げる"));
  assert.ok(widen, "拡大条件がありません");
  for (const condition of [
    "矛盾",
    "影響の分からない変更",
    "security・trust境界",
    "検証の失敗",
    "review finding",
    "`matches*`が`false`",
    "`errors`が空でない",
  ])
    assert.ok(widen.includes(condition), `拡大条件に${condition}がありません`);
  assert.equal(/全文を?読(?:む|み)/u.test(adapter!), false);
  for (const marker of ["`resume`（再開状態）を起点", "doctor", "hash一致"])
    assert.ok(adapter!.includes(marker), `adapterに${marker}がありません`);
  const entry = agents!.split("\n").find((line) => line.includes("正本"));
  assert.ok(entry);
  for (const marker of [
    "[00_運用ポリシー.md](.agent-skill-chain/docs/00_運用ポリシー.md)",
    "[01_開発ワークフロー.md](.agent-skill-chain/docs/01_開発ワークフロー.md)（全文でなく、同文書の「読取と書込の量」節に従い節単位で読む）",
    "[02_品質基準.md](.agent-skill-chain/docs/02_品質基準.md)を読む",
  ])
    assert.ok(entry.includes(marker), `AGENTS.mdに${marker}がありません`);
  for (const [name, skill] of [
    ["step-01", step1!],
    ["step-02", step2!],
    ["step-03", step3!],
  ] as const) {
    const glossary = skill
      .split("\n")
      .find((line) =>
        line.includes(
          "[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)",
        ),
      );
    assert.ok(glossary, `${name}に用語台帳の読取指示がありません`);
    assert.ok(
      glossary.includes("変更に関わる語・既存IDを検索して該当行だけ読"),
      `${name}が用語台帳の該当行読取を指示していません`,
    );
    const fullRead = glossary.indexOf("作業開始前に全文読");
    const fullReadTargets = fullRead === -1 ? "" : glossary.slice(0, fullRead);
    assert.equal(
      /既存|用語・略語\.md/u.test(fullReadTargets),
      false,
      `${name}が既存用語台帳の全文読みを指示しています`,
    );
  }
  this.checked = true;
});

Then(
  "context境界・再開順・拡大条件があり、adapterは全文読みを指示しない",
  function () {
    assert.equal(this.checked, true);
  },
);
