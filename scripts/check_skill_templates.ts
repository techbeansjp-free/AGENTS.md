import fs from "node:fs";
import path from "node:path";

import { DEVELOPMENT_CONSIDERATION_IDS } from "../src/domain/conformance.js";
import { issueRequiredHeadings } from "../src/domain/issue.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

const DEVELOPMENT_CONSIDERATION_TEMPLATES = [
  "issue/00_要求定義_full.md",
  "issue/00_要求定義_quick.md",
  "issue/00_要求定義_poc.md",
  "issue/01_要件定義.md",
  "issue/02_設計.md",
  "issue/03_実装計画.md",
  "issue/04_レビュー.md",
];

const ARTIFACT_VOCABULARY_TERMS = [
  "要求",
  "要件",
  "制約",
  "前提",
  "対象外",
  "受け入れ条件",
  "設計",
  "設計判断",
  "実装計画",
  "実装",
  "システム仕様書",
  "検証証拠",
  "正本",
];

const ARTIFACT_VOCABULARY_TEMPLATES = [
  ...DEVELOPMENT_CONSIDERATION_TEMPLATES,
  "specs/00_利用案内.md",
  "specs/00_仕様書構成/00_仕様書索引.md",
  "specs/00_仕様書構成/01_記入・分割ルール.md",
  "specs/01_システム概要/02_用語・略語.md",
];

const ARTIFACT_VOCABULARY_SKILLS = new Set([
  "step-01-request",
  "step-02-requirements",
  "step-03-requirements-review",
  "step-05-design",
  "step-06-plan",
  "step-07-design-review",
  "step-09-implement",
  "step-10-review",
]);

const DOMAIN_GLOSSARY_TEMPLATE_MARKERS = new Map<string, string[]>([
  [
    "issue/00_要求定義_full.md",
    [
      "### 4.2 ドメイン用語台帳の候補差分",
      "| 用語ID | 候補語 | 変更種別 |",
      "### 4.3 business rule候補",
      "| ID | rule候補 | 関係する用語ID |",
    ],
  ],
  [
    "issue/00_要求定義_quick.md",
    ["ドメイン用語台帳の候補差分", "business rule候補と関係する用語ID"],
  ],
  [
    "issue/00_要求定義_poc.md",
    ["ドメイン用語台帳の候補差分", "business rule候補と関係する用語ID"],
  ],
  [
    "issue/01_要件定義.md",
    [
      "### 2.1 ドメイン用語台帳の確定差分",
      "| 用語ID | 標準語 | 定義 | 種別 | 境界づけられたコンテキスト | 成立例・反例 | 類義語・禁止表現 | 根拠ID・資料 | owner | 状態・適用版・置換先 |",
      "| ID | ルール | 関係する用語ID |",
    ],
  ],
  ["issue/02_設計.md", ["参照するドメイン用語IDと標準語"]],
  ["issue/03_実装計画.md", ["ドメイン用語台帳の追加・変更・廃止task"]],
  ["issue/04_レビュー.md", ["ドメイン用語台帳の候補・確定・現在有効な定義"]],
  [
    "specs/01_システム概要/02_用語・略語.md",
    [
      "現在有効なドメイン用語台帳の正本",
      "| 用語ID | 標準語 | 定義 | 種別 | 境界づけられたコンテキスト | 成立例・反例 | 類義語・禁止表現 | 根拠ID・資料 | owner | 状態・適用版・置換先 |",
      "## 更新規則",
    ],
  ],
  [
    "specs/15_要件追跡/01_変更履歴.md",
    ["| 日付 | 変更 | 要件・SCN | 用語ID |"],
  ],
]);

const DOMAIN_GLOSSARY_SKILLS = new Set([
  "step-01-request",
  "step-02-requirements",
  "step-03-requirements-review",
  "step-05-design",
  "step-06-plan",
  "step-07-design-review",
  "step-09-implement",
  "step-10-review",
]);

const ROUTING_INPUT_CONTRACT_ASSETS = [
  "skills/step-06-plan/SKILL.md",
  "skills/step-09-implement/SKILL.md",
  "skills/step-10-review/SKILL.md",
  "templates/issue/02_設計.md",
  "templates/issue/03_実装計画.md",
  "templates/issue/04_レビュー.md",
] as const;

const ROUTING_INPUT_CONTRACT_MARKERS = [
  "role欄",
  "provider欄",
  "model設定欄",
  "fallback欄",
  "独立性証拠欄",
] as const;

const HOST_ADAPTER_SKILL = "asc-step";

const EXPECTED_TEMPLATE_LINKS = new Map<string, string[]>([
  ["step-00-stage", []],
  [
    "step-01-request",
    [
      "../../templates/issue/00_要求定義_full.md",
      "../../templates/issue/00_要求定義_quick.md",
      "../../templates/issue/00_要求定義_poc.md",
      "../../templates/specs/10_セキュリティ/00_セキュリティ方針・資産.md",
      "../../templates/specs/11_非機能/00_非機能要件一覧.md",
      "../../templates/specs/12_運用保守/00_運用設計.md",
      "../../templates/specs/17_デザイン/00_デザイントークン.md",
      "../../templates/specs/18_レイアウト/00_レイアウトトークン.md",
    ],
  ],
  [
    "step-02-requirements",
    [
      "../../templates/issue/01_要件定義.md",
      "../../templates/specs/10_セキュリティ/00_セキュリティ方針・資産.md",
      "../../templates/specs/11_非機能/00_非機能要件一覧.md",
      "../../templates/specs/12_運用保守/00_運用設計.md",
      "../../templates/specs/17_デザイン/00_デザイントークン.md",
      "../../templates/specs/18_レイアウト/00_レイアウトトークン.md",
    ],
  ],
  ["step-03-requirements-review", []],
  ["step-04-issue-sync", []],
  [
    "step-05-design",
    [
      "../../templates/issue/02_設計.md",
      "../../templates/specs/10_セキュリティ/01_信頼境界・認証認可.md",
      "../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md",
      "../../templates/specs/11_非機能/02_利用性・互換性・保守性.md",
      "../../templates/specs/12_運用保守/01_監視・障害対応.md",
      "../../templates/specs/17_デザイン/00_デザイントークン.md",
      "../../templates/specs/18_レイアウト/00_レイアウトトークン.md",
    ],
  ],
  [
    "step-06-plan",
    [
      "../../templates/issue/03_実装計画.md",
      "../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md",
      "../../templates/specs/11_非機能/00_非機能要件一覧.md",
      "../../templates/specs/12_運用保守/01_監視・障害対応.md",
      "../../templates/specs/14_開発・品質/01_コーディング標準.md",
      "../../templates/specs/14_開発・品質/02_テスト標準.md",
      "../../templates/specs/17_デザイン/00_デザイントークン.md",
      "../../templates/specs/18_レイアウト/00_レイアウトトークン.md",
    ],
  ],
  ["step-07-design-review", []],
  ["step-08-design-sync", []],
  [
    "step-09-implement",
    [
      "../../templates/specs/00_仕様書構成/00_仕様書索引.md",
      "../../templates/specs/00_仕様書構成/01_記入・分割ルール.md",
    ],
  ],
  [
    "step-10-review",
    [
      "../../templates/issue/04_レビュー.md",
      "../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md",
      "../../templates/specs/11_非機能/02_利用性・互換性・保守性.md",
      "../../templates/specs/12_運用保守/01_監視・障害対応.md",
      "../../templates/specs/14_開発・品質/01_コーディング標準.md",
      "../../templates/specs/14_開発・品質/02_テスト標準.md",
      "../../templates/specs/17_デザイン/00_デザイントークン.md",
      "../../templates/specs/18_レイアウト/00_レイアウトトークン.md",
    ],
  ],
  [
    "step-11-pr",
    [
      "../../templates/issue/11_プルリクエスト事前確認.md",
      "../../templates/issue/11_プルリクエスト本文.md",
    ],
  ],
]);

const EXPECTED_OUTPUT_MARKERS = new Map<string, string>([
  ["step-00-stage", ".agent-skill-chain/tmp/issues/"],
  ["step-01-request", "00_要求定義.md"],
  ["step-02-requirements", "01_要件定義.md"],
  ["step-03-requirements-review", "開始可能性"],
  ["step-04-issue-sync", "書き込み後読み取り検証"],
  ["step-05-design", "02_設計.md"],
  ["step-06-plan", "03_実装計画.md"],
  ["step-07-design-review", "開始可能性"],
  ["step-08-design-sync", "書き込み後読み取り検証"],
  ["step-09-implement", "docs/specs/"],
  ["step-10-review", "04_レビュー.md"],
  ["step-11-pr", "merge-queued"],
]);

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values)].sort();

type IssueTemplateMode = "full" | "quick" | "poc";

const ISSUE_TEMPLATE_FILES: Readonly<Record<IssueTemplateMode, string>> = {
  full: "00_要求定義_full.md",
  quick: "00_要求定義_quick.md",
  poc: "00_要求定義_poc.md",
};

export function checkIssueTemplateHeadings(
  root = process.cwd(),
  modes: readonly IssueTemplateMode[] = ["full", "quick", "poc"],
) {
  const errors: string[] = [];
  const templatesRoot = path.resolve(
    root,
    ".agent-skill-chain/templates/issue",
  );
  for (const mode of modes) {
    const relative = ISSUE_TEMPLATE_FILES[mode];
    const template = path.join(templatesRoot, relative);
    if (!fs.existsSync(template)) {
      errors.push(`${mode}モードのIssue templateがありません: ${relative}`);
      continue;
    }
    const markdown = fs.readFileSync(template, "utf8");
    for (const heading of issueRequiredHeadings(mode))
      if (!markdown.includes(`## ${heading}`))
        errors.push(
          `${mode}モードのIssue templateに検証器の必須見出しがありません: ${heading}`,
        );
  }

  if (modes.includes("quick")) {
    const workflowFile = path.resolve(
      root,
      ".agent-skill-chain/docs/01_開発ワークフロー.md",
    );
    const quickTemplate = path.join(templatesRoot, ISSUE_TEMPLATE_FILES.quick);
    const term = "最小Gherkin";
    if (
      !fs.existsSync(workflowFile) ||
      !fs.readFileSync(workflowFile, "utf8").includes(term)
    )
      errors.push(`規範文書にIssue templateのkey term「${term}」がありません`);
    if (
      !issueRequiredHeadings("quick").some((heading) => heading.includes(term))
    )
      errors.push(`quickモードの検証器にkey term「${term}」がありません`);
    if (
      fs.existsSync(quickTemplate) &&
      !fs.readFileSync(quickTemplate, "utf8").includes(term)
    )
      errors.push(
        `quickモードのIssue templateにkey term「${term}」がありません`,
      );
  }
  return { valid: errors.length === 0, errors };
}

export function checkSkillTemplateContracts(root = process.cwd()) {
  const errors: string[] = [...checkIssueTemplateHeadings(root).errors];
  const skillsRoot = path.resolve(root, ".agent-skill-chain/skills");
  const templatesRoot = path.resolve(root, ".agent-skill-chain/templates");
  const namespaceRoot = path.resolve(root, ".agent-skill-chain");
  const actualSkillDirectories = fs.existsSync(skillsRoot)
    ? fs
        .readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const actualSkills = actualSkillDirectories.filter((name) =>
    name.startsWith("step-"),
  );
  const expectedSkills = [...EXPECTED_TEMPLATE_LINKS.keys()].sort();
  const expectedSkillDirectories = [
    ...expectedSkills,
    HOST_ADAPTER_SKILL,
  ].sort();
  if (
    JSON.stringify(actualSkillDirectories) !==
    JSON.stringify(expectedSkillDirectories)
  )
    errors.push(
      `skill集合がStep 0〜11とhost adapterの正規集合に一致しません: ${actualSkillDirectories.join(",")}`,
    );
  if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills))
    errors.push(
      `Step skill集合が0〜11の正規集合と一致しません: ${actualSkills.join(",")}`,
    );
  const hostAdapter = path.join(skillsRoot, HOST_ADAPTER_SKILL, "SKILL.md");
  if (!fs.existsSync(hostAdapter))
    errors.push(`${HOST_ADAPTER_SKILL}/SKILL.mdがありません`);
  else {
    const markdown = fs.readFileSync(hostAdapter, "utf8");
    for (const marker of [
      "name: asc-step",
      "../../../.agent-skill-chain/docs/01_開発ワークフロー.md",
      ".agent-skill-chain/skills/step-NN-",
      "相対link",
    ])
      if (!markdown.includes(marker))
        errors.push(`${HOST_ADAPTER_SKILL}/SKILL.mdに${marker}がありません`);
  }
  for (const relative of ROUTING_INPUT_CONTRACT_ASSETS) {
    const file = path.join(namespaceRoot, relative);
    if (!fs.existsSync(file)) {
      errors.push(`routing入力契約資産がありません: ${relative}`);
      continue;
    }
    const markdown = fs.readFileSync(file, "utf8");
    for (const marker of ROUTING_INPUT_CONTRACT_MARKERS)
      if (!markdown.includes(marker))
        errors.push(`${relative}: routing入力契約の${marker}がありません`);
  }
  for (const relative of DEVELOPMENT_CONSIDERATION_TEMPLATES) {
    const template = path.join(templatesRoot, relative);
    if (!fs.existsSync(template)) {
      errors.push(`開発契約templateがありません: ${relative}`);
      continue;
    }
    const markdown = fs.readFileSync(template, "utf8");
    for (const id of DEVELOPMENT_CONSIDERATION_IDS) {
      const rows = markdown
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(`| ${id} |`));
      if (rows.length !== 1) {
        errors.push(`${relative}: ${id}は重複なく1行必要です`);
        continue;
      }
      const cells =
        rows[0]
          ?.split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()) ?? [];
      if (
        cells.length < 5 ||
        cells[2] !== "applicable / not-applicable" ||
        !cells[3] ||
        !cells[4]
      ) {
        errors.push(`${relative}: ${id}の判定・理由・証拠欄が不正です`);
      }
    }
  }
  const workflowFile = path.resolve(
    root,
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
  );
  if (!fs.existsSync(workflowFile))
    errors.push("01_開発ワークフロー.mdがありません");
  else {
    const workflow = fs.readFileSync(workflowFile, "utf8");
    if (!/各ステップの開始前[^。]*SKILL\.md[^。]*全文/u.test(workflow))
      errors.push(
        "開発ワークフローにStep skillの開始前全文読取義務がありません",
      );
    const workflowLinks = uniqueSorted(
      [...workflow.matchAll(/\]\(\.\.\/skills\/([^/]+)\/SKILL\.md\)/gu)].map(
        (match) => match[1],
      ),
    );
    if (JSON.stringify(workflowLinks) !== JSON.stringify(expectedSkills))
      errors.push(
        `開発ワークフローからStep skillへの対応が不正です: ${workflowLinks.join(",")}`,
      );
    if (!workflow.includes("## 成果物用語と責務境界"))
      errors.push("開発ワークフローに成果物用語と責務境界の正本がありません");
    for (const term of ARTIFACT_VOCABULARY_TERMS) {
      if (!workflow.includes(`| ${term} |`))
        errors.push(`成果物用語と責務境界に${term}の定義がありません`);
    }
    if (
      !workflow.includes(
        "要求 → 要件・受け入れ条件 → 設計・設計判断 → 実装計画 → 実装・検証証拠 → レビュー",
      ) ||
      !workflow.includes(
        "契約が変わる場合だけ所有する成果物の影響部分と追跡を再確定する",
      )
    )
      errors.push("成果物の正方向と影響範囲だけを再確定する契約がありません");
    if (!workflow.includes("## ドメイン用語台帳"))
      errors.push("開発ワークフローにドメイン用語台帳契約がありません");
    for (const marker of [
      "candidate / active / deprecated",
      "同じ表記でもコンテキストごとに意味が違う場合は別ID",
      "実装後は用語差分を耐久用語台帳と仕様変更履歴へ反映",
    ]) {
      if (!workflow.includes(marker))
        errors.push(`ドメイン用語台帳のlifecycle契約がありません: ${marker}`);
    }
  }

  for (const relative of ARTIFACT_VOCABULARY_TEMPLATES) {
    const template = path.join(templatesRoot, relative);
    if (!fs.existsSync(template)) {
      errors.push(`成果物用語を参照するtemplateがありません: ${relative}`);
      continue;
    }
    if (!fs.readFileSync(template, "utf8").includes("成果物用語と責務境界"))
      errors.push(`${relative}: 成果物用語と責務境界の正本参照がありません`);
  }
  const fullRequestTemplate = path.join(
    templatesRoot,
    "issue/00_要求定義_full.md",
  );
  if (fs.existsSync(fullRequestTemplate)) {
    const fullRequest = fs.readFileSync(fullRequestTemplate, "utf8");
    if (/^### 5\.[12] (?:機能要求|非機能要求)$/mu.test(fullRequest))
      errors.push("full要求templateへ要件のFR/NFR責務を混入できません");
    if (/^\| AC-[^|]+\|/mu.test(fullRequest))
      errors.push("full要求templateでACを採番せず要件定義へ分離してください");
  }
  for (const [relative, markers] of DOMAIN_GLOSSARY_TEMPLATE_MARKERS) {
    const template = path.join(templatesRoot, relative);
    if (!fs.existsSync(template)) {
      errors.push(`ドメイン用語台帳templateがありません: ${relative}`);
      continue;
    }
    const markdown = fs.readFileSync(template, "utf8");
    for (const marker of markers) {
      if (!markdown.includes(marker))
        errors.push(`${relative}: ドメイン用語台帳契約がありません: ${marker}`);
    }
  }

  for (const skill of expectedSkills) {
    const skillFile = path.join(skillsRoot, skill, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      errors.push(`${skill}/SKILL.mdがありません`);
      continue;
    }
    const markdown = fs.readFileSync(skillFile, "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(markdown)?.[1];
    if (!frontmatter)
      errors.push(`${skill}/SKILL.mdにYAML frontmatterがありません`);
    else {
      const declaredName = /^name:\s*(\S+)\s*$/mu.exec(frontmatter)?.[1];
      const description = /^description:\s*(.+)\s*$/mu.exec(frontmatter)?.[1];
      if (declaredName !== skill)
        errors.push(`${skill}/SKILL.mdのnameがdirectory名と一致しません`);
      if (!description || /^[>|][+-]?$/u.test(description))
        errors.push(
          `${skill}/SKILL.mdのdescriptionはblock scalarでない単一行が必要です`,
        );
    }
    if (!markdown.includes("## テンプレート契約"))
      errors.push(`${skill}/SKILL.mdにテンプレート契約がありません`);
    if (
      ARTIFACT_VOCABULARY_SKILLS.has(skill) &&
      !markdown.includes(
        "[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)",
      )
    )
      errors.push(`${skill}/SKILL.mdに成果物用語の開始前読取契約がありません`);
    if (
      DOMAIN_GLOSSARY_SKILLS.has(skill) &&
      !markdown.includes(
        "[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)",
      )
    )
      errors.push(
        `${skill}/SKILL.mdにドメイン用語台帳の開始前読取契約がありません`,
      );
    const links = uniqueSorted(
      [...markdown.matchAll(/\]\((\.\.\/\.\.\/templates\/[^)\s]+)\)/gu)].map(
        (match) => match[1],
      ),
    );
    const expectedLinks = uniqueSorted(
      EXPECTED_TEMPLATE_LINKS.get(skill) ?? [],
    );
    if (JSON.stringify(links) !== JSON.stringify(expectedLinks))
      errors.push(
        `${skill}/SKILL.mdのテンプレート対応が不正です: expected=${expectedLinks.join(",")} actual=${links.join(",")}`,
      );
    if (expectedLinks.length > 0 && !/作業開始前[^。]*全文/u.test(markdown))
      errors.push(`${skill}/SKILL.mdに作業開始前の全文読取義務がありません`);
    if (
      expectedLinks.length === 0 &&
      !markdown.includes("直接使用するテンプレートはない")
    )
      errors.push(`${skill}/SKILL.mdにテンプレート非適用理由がありません`);
    const outputMarker = EXPECTED_OUTPUT_MARKERS.get(skill);
    if (!outputMarker || !markdown.includes(outputMarker))
      errors.push(
        `${skill}/SKILL.mdに正規成果物${outputMarker ?? ""}がありません`,
      );

    for (const relativeLink of links) {
      const resolved = path.resolve(path.dirname(skillFile), relativeLink);
      if (!resolved.startsWith(`${templatesRoot}${path.sep}`)) {
        errors.push(
          `${skill}/SKILL.mdのリンクがtemplates境界外です: ${relativeLink}`,
        );
        continue;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        errors.push(`${skill}/SKILL.mdのリンク先がありません: ${relativeLink}`);
        continue;
      }
      const real = fs.realpathSync(resolved);
      if (!real.startsWith(`${fs.realpathSync(templatesRoot)}${path.sep}`))
        errors.push(
          `${skill}/SKILL.mdのリンク先がsymlinkでtemplates境界外です: ${relativeLink}`,
        );
    }
  }
  return { valid: errors.length === 0, errors, skills: expectedSkills.length };
}

if (isExecutionEntry(import.meta.url)) {
  const result = checkSkillTemplateContracts();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
