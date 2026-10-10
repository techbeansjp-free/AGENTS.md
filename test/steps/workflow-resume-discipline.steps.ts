import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  observeWorkflowHandoff,
  workflowAgentDispatch,
} from "../../src/adapters/workflow-handoff.js";
import type { WorkflowResume } from "../../src/domain/workflow-resume.js";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";

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
    "finalize後はcontextを破棄してもよい。",
    "fullではStep 8の記録後にfresh contextへの移行を推奨する。",
    "会話がなくても復旧できることを保証し、mainの継続・resumeは禁止しない。",
    "Step 10のreviewer独立性は引き続き必須とする。",
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

Then(
  "advanceのpreviewは計画本文を読まずapplyはlock前後の変更を拒否する",
  async function () {
    const root = this.initRepo();
    const staging = createIssueStaging(root, {
      title: "preview-read-boundary",
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
      requestedMode: "full",
      now: new Date("2026-08-25T12:00:00Z"),
    }).path;
    const documents = [
      "00_要求定義.md",
      "01_要件定義.md",
      "02_設計.md",
      "03_実装計画.md",
    ].map((name) => path.join(staging, name));
    const reads: string[] = [];
    const originalRead = fs.readFileSync;
    const originalLink = fs.linkSync;
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    let mutated = false;
    fs.readFileSync = new Proxy(originalRead, {
      apply(
        target,
        thisArg: unknown,
        args: Parameters<typeof fs.readFileSync>,
      ) {
        if (typeof args[0] === "string" && documents.includes(args[0]))
          reads.push(args[0]);
        return Reflect.apply(target, thisArg, args) as ReturnType<
          typeof fs.readFileSync
        >;
      },
    });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      assert.equal(
        await main(["workflow", "advance", `--staging=${staging}`]),
        0,
      );
      assert.equal(
        (JSON.parse(output) as { targetStep: number }).targetStep,
        1,
      );
      const preview = JSON.parse(output) as { resume: WorkflowResume };
      const previousMode = process.env.ASC_EXECUTION_CONTEXT_MODE;
      process.env.ASC_EXECUTION_CONTEXT_MODE = "short-lived";
      try {
        const requirements = observeWorkflowHandoff(staging, 2, preview.resume);
        const implementation = observeWorkflowHandoff(
          staging,
          9,
          preview.resume,
        );
        assert.ok(requirements && "kind" in requirements);
        assert.ok(implementation && "kind" in implementation);
        assert.deepEqual(requirements.read?.staging, ["00_要求定義.md"]);
        assert.deepEqual(implementation.read?.staging, [
          "00_要求定義.md",
          "01_要件定義.md",
          "02_設計.md",
          "03_実装計画.md",
          "05_計画変更.md",
        ]);
        assert.match(
          implementation.read!.skill,
          /step-09-implement\/SKILL.md$/u,
        );
        const quickStaging = createIssueStaging(root, {
          title: "quick-read-boundary",
          answers: Object.fromEntries(
            QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
          ),
          requestedMode: "quick",
          now: new Date("2026-08-25T12:01:00Z"),
        }).path;
        const quick = observeWorkflowHandoff(quickStaging, 9, {
          ...preview.resume,
          staging: quickStaging,
        });
        assert.ok(quick && "kind" in quick);
        assert.deepEqual(quick.read?.staging, [
          "00_要求定義.md",
          "05_計画変更.md",
        ]);
        assert.equal(quick.read?.skill, implementation.read?.skill);
        for (const inputStaging of [staging, quickStaging]) {
          const request = observeWorkflowHandoff(inputStaging, 1, {
            ...preview.resume,
            staging: inputStaging,
          });
          assert.ok(request && "kind" in request);
          assert.deepEqual(request.read?.staging, [
            "00_モード判定.json",
            "00_要求定義.md",
          ]);
          for (const input of request.read!.staging)
            assert.ok(fs.existsSync(path.join(inputStaging, input)));
          assert.equal(request.read?.skill, DOCUMENTS.step1);
          assert.equal(request.authority, "advisory");
          assert.equal(request.workUnit.freshContextRequired, true);
        }
        assert.ok(fs.existsSync(path.resolve(implementation.read!.skill)));
        assert.equal(implementation.authority, "advisory");
        const dispatch = workflowAgentDispatch(implementation);
        assert.ok(dispatch);
        assert.deepEqual(
          (JSON.parse(dispatch.prompt) as { handoff: unknown }).handoff,
          implementation,
        );
        assert.notEqual(
          requirements.workUnit!.workUnitId,
          implementation.workUnit.workUnitId,
        );
        assert.equal(implementation.workUnit.freshContextRequired, true);
        const otherHead = observeWorkflowHandoff(staging, 9, {
          ...preview.resume,
          headSha: "a".repeat(40),
        });
        assert.ok(otherHead && "kind" in otherHead);
        assert.notEqual(
          otherHead.workUnit!.workUnitId,
          implementation.workUnit.workUnitId,
        );
        const blocked = observeWorkflowHandoff(staging, 9, {
          ...preview.resume,
          errors: ["journal mismatch"],
        });
        assert.equal(workflowAgentDispatch(blocked), undefined);
      } finally {
        if (previousMode === undefined)
          delete process.env.ASC_EXECUTION_CONTEXT_MODE;
        else process.env.ASC_EXECUTION_CONTEXT_MODE = previousMode;
      }
      assert.equal(reads.length, 0);
      fs.linkSync = (existingPath, newPath) => {
        originalLink(existingPath, newPath);
        if (String(newPath).endsWith(".mutation.lock")) {
          fs.appendFileSync(documents[0]!, "\nconcurrent change\n");
          mutated = true;
        }
      };
      await assert.rejects(
        main(["workflow", "advance", `--staging=${staging}`, "--apply"]),
        /writer lock取得前にstagingまたはjournalが変更/,
      );
      assert.equal(mutated, true);
      for (const document of documents) assert.ok(reads.includes(document));
    } finally {
      fs.readFileSync = originalRead;
      fs.linkSync = originalLink;
      process.stdout.write = originalWrite;
    }
  },
);
