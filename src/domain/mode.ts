const QUESTIONS = Array.from(
  { length: 8 },
  (_, index) => `Q-${String(index + 1).padStart(2, "0")}`,
);

export const POC_HIGH_RISK_IDS = [
  "public-api",
  "personal-data",
  "confidential-data",
  "external-exposure",
  "irreversible-operation",
] as const;

export type Mode = "quick" | "full" | "poc";

export type ModeAnswer = { answer?: boolean | "unknown"; evidence?: string };

export interface PocDeclaration {
  purpose: string;
  period: { from: string; to: string };
  outOfScope: string;
  successCriteria: string;
  abortCriteria: string;
  owner: string;
  highRisk: Array<{ id: string; present: boolean; evidence: string }>;
}

export interface ModeOptions {
  requestedMode?: string;
  poc?: PocDeclaration;
  changedFiles?: string[];
  currentMode?: Mode;
}

const knownHighRiskIds = new Set<string>(POC_HIGH_RISK_IDS);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function quickReasons(answers: Record<string, ModeAnswer>): string[] {
  const reasons: string[] = [];
  for (const id of QUESTIONS) {
    const item = answers?.[id];
    if (!item) reasons.push(`${id}: 未回答`);
    else if (item.answer !== true)
      reasons.push(
        `${id}: ${item.answer === "unknown" || item.answer == null ? "不明" : String(item.answer)}`,
      );
    else if (!nonEmpty(item.evidence)) reasons.push(`${id}: 根拠なし`);
  }
  return reasons;
}

function pocReasons(declaration: PocDeclaration | undefined): string[] {
  if (!declaration) return ["PoC宣言がありません"];

  const reasons: string[] = [];
  const requiredFields: Array<[string, unknown]> = [
    ["目的", declaration.purpose],
    ["対象期間の開始", declaration.period?.from],
    ["対象期間の終了", declaration.period?.to],
    ["非対象", declaration.outOfScope],
    ["成功条件", declaration.successCriteria],
    ["中止条件", declaration.abortCriteria],
    ["責任者", declaration.owner],
  ];
  for (const [label, value] of requiredFields)
    if (!nonEmpty(value))
      reasons.push(`PoC宣言の${label}が未記入または不明です`);

  const riskEntries = Array.isArray(declaration.highRisk)
    ? declaration.highRisk
    : [];
  for (const id of POC_HIGH_RISK_IDS) {
    const entries = riskEntries.filter((entry) => entry?.id === id);
    if (entries.length !== 1) {
      reasons.push(`PoC high risk条件 ${id} が未確認または重複しています`);
      continue;
    }
    const entry = entries[0];
    if (!entry || typeof entry.present !== "boolean")
      reasons.push(`PoC high risk条件 ${id} の有無が不明です`);
    else if (entry.present)
      reasons.push(
        `PoC high risk条件 ${id} が存在するためfullへの昇格が必要です`,
      );
    if (!entry || !nonEmpty(entry.evidence))
      reasons.push(`PoC high risk条件 ${id} の根拠がありません`);
  }
  for (const entry of riskEntries) {
    if (!entry || !nonEmpty(entry.id)) {
      reasons.push("PoC high risk条件に識別子がありません");
      continue;
    }
    if (entry.present === true && !knownHighRiskIds.has(entry.id))
      reasons.push(
        `PoC high risk条件 ${entry.id} が存在するためfullへの昇格が必要です`,
      );
    if (typeof entry.present !== "boolean")
      reasons.push(`PoC high risk条件 ${entry.id} の有無が不明です`);
    if (!nonEmpty(entry.evidence))
      reasons.push(`PoC high risk条件 ${entry.id} の根拠がありません`);
  }
  return [...new Set(reasons)];
}

export function classifyMode(
  answers: Record<string, ModeAnswer>,
  options: ModeOptions = {},
): {
  mode: Mode;
  reasons: string[];
} {
  if (
    options.requestedMode !== undefined &&
    !["quick", "full", "poc"].includes(options.requestedMode)
  )
    return {
      mode: "full",
      reasons: [`要求されたモード ${options.requestedMode} は不明です`],
    };
  if (options.requestedMode !== "poc") {
    const reasons = quickReasons(answers);
    if (options.requestedMode === "full" || options.currentMode === "full") {
      if (reasons.length === 0)
        reasons.push("fullからquickまたはpocへ途中降格しません");
      return { mode: "full", reasons };
    }
    return { mode: reasons.length === 0 ? "quick" : "full", reasons };
  }

  const reasons = pocReasons(options.poc);
  if (options.currentMode === "full")
    reasons.push("fullからpocへ途中降格しません");
  for (const disqualifier of detectQuickDisqualifiers(
    options.changedFiles ?? [],
  ))
    reasons.push(
      `変更fileのhigh risk条件 ${disqualifier} を検出したためfullへの昇格が必要です`,
    );
  return { mode: reasons.length === 0 ? "poc" : "full", reasons };
}

export function detectQuickDisqualifiers(changedFiles: string[]): string[] {
  const reasons = new Set<string>();
  for (const file of changedFiles) {
    const normalized = file.replaceAll("\\", "/");
    if (
      /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.toml)$/.test(
        normalized,
      )
    )
      reasons.add("dependency");
    if (
      /(^|\/)(public-api|api\/|openapi|contracts?\/|exports?\.)/i.test(
        normalized,
      )
    )
      reasons.add("public-api");
    if (/(^|\/)(migrations?|schema\/)/i.test(normalized))
      reasons.add("data-migration");
    if (/(^|\/)(auth|security|secrets?)(\/|\.)/i.test(normalized))
      reasons.add("security-boundary");
    if (
      /(^|\/)(\.github\/workflows|infra\/|Dockerfile|terraform)/i.test(
        normalized,
      )
    )
      reasons.add("infrastructure");
  }
  return [...reasons];
}

export { QUESTIONS };
